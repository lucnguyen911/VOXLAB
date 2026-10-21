/**
 * Centralized Google Gemini API Key Pool & Quota Bucket Scheduler.
 *
 * Adapted from Audio-Factory's `ApiKeyScheduler` & `QuotaBucketState` principles for VoxLab:
 * - Manages primary + secondary Gemini API keys with stable IDs and live operational metrics.
 * - Least-in-flight + Round-Robin key selection safe under concurrent async requests.
 * - Per-(key, model) sliding-window RPM rate limiting + exponential backoff with jitter.
 * - Shared Google Cloud Project quota detection: pauses the request group when multiple keys
 *   hit 429 simultaneously instead of hammering remaining keys in a tight loop.
 * - Strict error classification for 429 (with Retry-After / retryDelay parsing), 401, 403, 5xx,
 *   timeout, and user cancellation.
 * - Zero raw API key leakage in logs, errors, or status snapshots.
 */

import { appHttpRequest } from "../http/nativeClient";
import {
  GeminiKeyHealthStatus,
  GeminiKeyRole,
  GeminiStoredKeyEntry,
  getActiveGeminiKeyEntriesSync,
  getGeminiKeyEntriesSync,
  maskGeminiApiKey,
  redactGeminiKeysFromText,
} from "./geminiKeyStore";

export interface GeminiKeyRuntimeState {
  id: string;
  role: GeminiKeyRole;
  label: string;
  maskedKey: string;
  status: GeminiKeyHealthStatus;
  inFlightCount: number;
  cooldownUntilMs: number;
  consecutiveRateLimits: number;
  successCount: number;
  failureCount: number;
  rateLimitCount: number;
  lastUsedAt: number | null;
  lastTestedAt: number | null;
  lastStatusMessage?: string;
}

export type GeminiErrorCategory =
  | "rate_limit_429"
  | "quota_exhausted"
  | "auth_invalid_401"
  | "permission_403"
  | "server_5xx"
  | "network_or_timeout"
  | "cancelled"
  | "bad_request";

export interface ClassifiedGeminiError {
  category: GeminiErrorCategory;
  httpStatus?: number;
  retryable: boolean;
  permanentlyDisableKey: boolean;
  targetKeyStatus: GeminiKeyHealthStatus;
  retryDelayMs: number;
  isSharedProjectQuotaLikely: boolean;
  sanitizedMessage: string;
}

export interface GeminiKeyLease {
  keyId: string;
  role: GeminiKeyRole;
  label: string;
  apiKey: string;
  maskedKey: string;
  modelName: string;
  releaseSuccess: (durationMs?: number) => void;
  releaseFailure: (classified: ClassifiedGeminiError, durationMs?: number) => void;
}

export interface GeminiConnectionTestItemResult {
  id: string;
  role: GeminiKeyRole;
  label: string;
  maskedKey: string;
  status: GeminiKeyHealthStatus;
  ok: boolean;
  message: string;
  httpStatus?: number;
}

export interface GeminiPoolConnectionTestSummary {
  totalConfigured: number;
  validCount: number;
  rateLimitedCount: number;
  invalidCount: number;
  untestedCount: number;
  summaryText: string;
  results: GeminiConnectionTestItemResult[];
}

export interface GeminiKeyPoolOptions {
  /** Per-key RPM limit (default 15 RPM for Gemini Flash free/standard tier) */
  maxRpmPerKey?: number;
  /** Minimum stagger delay (ms) between consecutive request launches (default 120ms) */
  minLaunchStaggerMs?: number;
  /** Base exponential backoff delay (ms) on 429 when Retry-After is absent (default 4000ms) */
  baseBackoffMs?: number;
  /** Maximum single cooldown wait (ms) before failing a request (default 45000ms) */
  maxCooldownWaitMs?: number;
  /** Time window (ms) to detect shared project-level 429 across multiple keys (default 6000ms) */
  sharedQuotaWindowMs?: number;
  /** Custom sleep function for deterministic unit testing */
  sleepFn?: (ms: number) => Promise<void>;
  /** Custom clock function for deterministic unit testing */
  nowFn?: () => number;
}

/**
 * Extracts explicit retry delay (in milliseconds) from HTTP `Retry-After` header
 * or Google Gemini error body (`retryDelay: "15s"`, `"Please retry in 12.5s"`).
 */
export function extractGeminiRetryDelayMs(
  retryAfterHeader?: string,
  errorBodyOrMessage?: string
): number | null {
  if (retryAfterHeader) {
    const trimmed = retryAfterHeader.trim();
    const seconds = Number(trimmed);
    if (!Number.isNaN(seconds) && seconds >= 0) {
      return Math.ceil(seconds * 1000);
    }
    const parsedDate = Date.parse(trimmed);
    if (!Number.isNaN(parsedDate)) {
      const delta = parsedDate - Date.now();
      if (delta > 0) return delta;
    }
  }

  if (errorBodyOrMessage) {
    const patterns = [
      /retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i,
      /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i,
      /retry_delay['"\s:=]+(\d+(?:\.\d+)?)\s*s/i,
      /retryAfter['"\s:=]+(\d+(?:\.\d+)?)\s*s/i,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(errorBodyOrMessage);
      if (match && match[1]) {
        const val = parseFloat(match[1]);
        if (!Number.isNaN(val) && val >= 0) {
          return Math.ceil(val * 1000);
        }
      }
    }
  }

  return null;
}

/**
 * Computes exponential backoff with random jitter (`±20%`).
 */
export function computeBackoffWithJitterMs(
  attempt: number,
  baseBackoffMs = 4000,
  maxBackoffMs = 40000
): number {
  const exp = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, Math.max(0, attempt - 1)));
  const jitterFactor = 0.85 + Math.random() * 0.3; // 0.85x to 1.15x
  return Math.min(maxBackoffMs, Math.max(250, Math.round(exp * jitterFactor)));
}

/**
 * Classifies an HTTP or runtime error from Google Gemini API.
 * Strictly distinguishes 429 rate limit, 401/400 invalid key, 403 permission vs quota,
 * 5xx transient server error, timeout/network error, and user cancellation.
 */
export function classifyGeminiError(params: {
  httpStatus?: number;
  bodyText?: string;
  errorMessage?: string;
  retryAfterHeader?: string;
  consecutiveRateLimits?: number;
  baseBackoffMs?: number;
  knownKeys?: string[];
}): ClassifiedGeminiError {
  const {
    httpStatus,
    bodyText = "",
    errorMessage = "",
    retryAfterHeader,
    consecutiveRateLimits = 1,
    baseBackoffMs = 4000,
    knownKeys = [],
  } = params;

  const combinedRaw = `${errorMessage} ${bodyText}`.trim();
  const sanitized = redactGeminiKeysFromText(combinedRaw, knownKeys);
  const lower = combinedRaw.toLowerCase();

  // 1. User cancellation / AbortError
  if (
    lower.includes("cancelled") ||
    lower.includes("aborted") ||
    lower.includes("aborterror")
  ) {
    return {
      category: "cancelled",
      httpStatus,
      retryable: false,
      permanentlyDisableKey: false,
      targetKeyStatus: "untested",
      retryDelayMs: 0,
      isSharedProjectQuotaLikely: false,
      sanitizedMessage: "Tác vụ dịch đã bị hủy.",
    };
  }

  // 2. HTTP 401 or HTTP 400 with API_KEY_INVALID
  if (
    httpStatus === 401 ||
    (httpStatus === 400 &&
      (lower.includes("api_key_invalid") ||
        lower.includes("api key not valid") ||
        lower.includes("api key expired")))
  ) {
    return {
      category: "auth_invalid_401",
      httpStatus: httpStatus || 401,
      retryable: false,
      permanentlyDisableKey: true,
      targetKeyStatus: "invalid",
      retryDelayMs: 0,
      isSharedProjectQuotaLikely: false,
      sanitizedMessage: `API Key không hợp lệ hoặc đã hết hạn (HTTP ${httpStatus || 401}). Vui lòng kiểm tra lại khóa trong Cài đặt.`,
    };
  }

  // 3. HTTP 403: Distinguish Permission/Auth vs Quota/Billing
  if (httpStatus === 403) {
    const isQuotaOrBilling =
      lower.includes("quota") ||
      lower.includes("billing") ||
      lower.includes("exceeded") ||
      lower.includes("resource_exhausted");

    if (isQuotaOrBilling) {
      return {
        category: "quota_exhausted",
        httpStatus: 403,
        retryable: false,
        permanentlyDisableKey: true,
        targetKeyStatus: "quota_exhausted",
        retryDelayMs: 0,
        isSharedProjectQuotaLikely: lower.includes("project"),
        sanitizedMessage:
          "API Key đã hết hạn mức (Quota/Billing HTTP 403). Vui lòng kiểm tra hạn mức Google Cloud Project.",
      };
    }

    return {
      category: "permission_403",
      httpStatus: 403,
      retryable: false,
      permanentlyDisableKey: true,
      targetKeyStatus: "invalid",
      retryDelayMs: 0,
      isSharedProjectQuotaLikely: false,
      sanitizedMessage:
        "API Key bị từ chối quyền truy cập (HTTP 403 Permission Denied). Vui lòng kiểm tra quyền của khóa.",
    };
  }

  // 4. HTTP 429: Rate limit or Daily Quota Exhaustion
  if (httpStatus === 429 || lower.includes("429") || lower.includes("resource_exhausted")) {
    const isDailyExhausted =
      lower.includes("perday") ||
      lower.includes("per_day") ||
      lower.includes("generaterequestsperday") ||
      lower.includes("daily limit");

    if (isDailyExhausted) {
      return {
        category: "quota_exhausted",
        httpStatus: 429,
        retryable: false,
        permanentlyDisableKey: true,
        targetKeyStatus: "quota_exhausted",
        retryDelayMs: 0,
        isSharedProjectQuotaLikely: lower.includes("project"),
        sanitizedMessage: "API Key đã chạm giới hạn request trong ngày (Daily Quota Exhausted).",
      };
    }

    const explicitDelayMs = extractGeminiRetryDelayMs(retryAfterHeader, combinedRaw);
    const computedDelayMs =
      explicitDelayMs !== null && explicitDelayMs > 0
        ? explicitDelayMs
        : computeBackoffWithJitterMs(consecutiveRateLimits, baseBackoffMs);

    const isSharedProject =
      lower.includes("perproject") ||
      lower.includes("per_project") ||
      lower.includes("project quota");

    return {
      category: "rate_limit_429",
      httpStatus: 429,
      retryable: true,
      permanentlyDisableKey: false,
      targetKeyStatus: "rate_limited",
      retryDelayMs: computedDelayMs,
      isSharedProjectQuotaLikely: isSharedProject,
      sanitizedMessage: `Đang bị giới hạn tốc độ (HTTP 429), tạm chờ ${(computedDelayMs / 1000).toFixed(1)}s.`,
    };
  }

  // 5. HTTP 5xx (500, 502, 503, 504)
  if (httpStatus !== undefined && httpStatus >= 500 && httpStatus < 600) {
    const delayMs = computeBackoffWithJitterMs(consecutiveRateLimits, Math.min(2000, baseBackoffMs));
    return {
      category: "server_5xx",
      httpStatus,
      retryable: true,
      permanentlyDisableKey: false,
      targetKeyStatus: "rate_limited",
      retryDelayMs: delayMs,
      isSharedProjectQuotaLikely: false,
      sanitizedMessage: `Máy chủ Gemini tạm thời quá tải (HTTP ${httpStatus}).`,
    };
  }

  // 6. Other 4xx Bad Request
  if (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500) {
    return {
      category: "bad_request",
      httpStatus,
      retryable: false,
      permanentlyDisableKey: false,
      targetKeyStatus: "valid",
      retryDelayMs: 0,
      isSharedProjectQuotaLikely: false,
      sanitizedMessage: `Yêu cầu Gemini không hợp lệ (HTTP ${httpStatus}): ${sanitized.slice(0, 160)}`,
    };
  }

  // 7. Network / Timeout error
  const delayMs = computeBackoffWithJitterMs(consecutiveRateLimits, Math.min(1500, baseBackoffMs));
  return {
    category: "network_or_timeout",
    httpStatus,
    retryable: true,
    permanentlyDisableKey: false,
    targetKeyStatus: "rate_limited",
    retryDelayMs: delayMs,
    isSharedProjectQuotaLikely: false,
    sanitizedMessage: `Lỗi mạng hoặc hết thời gian chờ khi gọi Gemini: ${sanitized.slice(0, 160)}`,
  };
}

interface InternalKeyBucket {
  entry: GeminiStoredKeyEntry;
  state: GeminiKeyRuntimeState;
  requestTimestampsMs: number[];
}

export class GeminiKeyPool {
  private static instance: GeminiKeyPool;

  private buckets: Map<string, InternalKeyBucket> = new Map();
  private rrCursor = 0;
  private lastLaunchAtMs = 0;
  private sharedProjectCooldownUntilMs = 0;
  private recent429Events: Array<{ keyId: string; timestampMs: number; delayMs: number }> = [];

  private maxRpmPerKey: number;
  private minLaunchStaggerMs: number;
  private baseBackoffMs: number;
  private maxCooldownWaitMs: number;
  private sharedQuotaWindowMs: number;
  private sleepFn: (ms: number) => Promise<void>;
  private nowFn: () => number;

  private explicitKeysOverride: GeminiStoredKeyEntry[] | null = null;

  constructor(options?: GeminiKeyPoolOptions) {
    this.maxRpmPerKey = options?.maxRpmPerKey ?? 15;
    this.minLaunchStaggerMs = options?.minLaunchStaggerMs ?? 120;
    this.baseBackoffMs = options?.baseBackoffMs ?? 4000;
    this.maxCooldownWaitMs = options?.maxCooldownWaitMs ?? 45000;
    this.sharedQuotaWindowMs = options?.sharedQuotaWindowMs ?? 6000;
    this.sleepFn =
      options?.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nowFn = options?.nowFn ?? (() => Date.now());
  }

  static getInstance(): GeminiKeyPool {
    if (!GeminiKeyPool.instance) {
      GeminiKeyPool.instance = new GeminiKeyPool();
    }
    return GeminiKeyPool.instance;
  }

  /**
   * Configures options or explicit keys (useful for unit tests & benchmarks).
   */
  configure(
    options?: GeminiKeyPoolOptions & {
      explicitKeys?: Array<{ id?: string; role?: GeminiKeyRole; label?: string; apiKey: string }>;
      resetStates?: boolean;
    }
  ): void {
    if (options?.maxRpmPerKey !== undefined) this.maxRpmPerKey = options.maxRpmPerKey;
    if (options?.minLaunchStaggerMs !== undefined)
      this.minLaunchStaggerMs = options.minLaunchStaggerMs;
    if (options?.baseBackoffMs !== undefined) this.baseBackoffMs = options.baseBackoffMs;
    if (options?.maxCooldownWaitMs !== undefined)
      this.maxCooldownWaitMs = options.maxCooldownWaitMs;
    if (options?.sharedQuotaWindowMs !== undefined)
      this.sharedQuotaWindowMs = options.sharedQuotaWindowMs;
    if (options?.sleepFn) this.sleepFn = options.sleepFn;
    if (options?.nowFn) this.nowFn = options.nowFn;

    if (options?.resetStates) {
      this.buckets.clear();
      this.rrCursor = 0;
      this.lastLaunchAtMs = 0;
      this.sharedProjectCooldownUntilMs = 0;
      this.recent429Events = [];
    }

    if (options?.explicitKeys !== undefined) {
      if (options.explicitKeys === null) {
        this.explicitKeysOverride = null;
      } else {
        const now = this.nowFn();
        this.explicitKeysOverride = options.explicitKeys.map((k, idx) => ({
          id: k.id || (idx === 0 ? "gemini_key_primary" : `gemini_key_sub_${idx}`),
          role: k.role || (idx === 0 ? "primary" : "secondary"),
          label: k.label || (idx === 0 ? "API Key chính" : `API Key phụ ${idx}`),
          apiKey: (k.apiKey || "").trim(),
          createdAt: now,
          updatedAt: now,
        }));
      }
      this.syncBucketsWithStore();
    }
  }

  /**
   * Synchronizes internal runtime buckets with `geminiKeyStore` (or `explicitKeysOverride`),
   * preserving runtime stats and statuses for keys whose raw `apiKey` value has not changed.
   */
  syncBucketsWithStore(fallbackSingleApiKey?: string): void {
    let sourceEntries =
      this.explicitKeysOverride !== null
        ? this.explicitKeysOverride
        : getActiveGeminiKeyEntriesSync();

    if (
      sourceEntries.length === 0 &&
      fallbackSingleApiKey &&
      fallbackSingleApiKey.trim().length > 0
    ) {
      const now = this.nowFn();
      sourceEntries = [
        {
          id: "gemini_key_primary",
          role: "primary",
          label: "API Key chính",
          apiKey: fallbackSingleApiKey.trim(),
          createdAt: now,
          updatedAt: now,
        },
      ];
    }

    const nextBuckets = new Map<string, InternalKeyBucket>();
    const seenApiKeys = new Set<string>();

    for (const entry of sourceEntries) {
      const trimmed = (entry.apiKey || "").trim();
      if (!trimmed || seenApiKeys.has(trimmed)) continue;
      seenApiKeys.add(trimmed);

      const existing = this.buckets.get(entry.id);
      if (existing && existing.entry.apiKey === trimmed) {
        existing.entry = { ...entry, apiKey: trimmed };
        existing.state.label = entry.label;
        existing.state.role = entry.role;
        existing.state.maskedKey = maskGeminiApiKey(trimmed);
        nextBuckets.set(entry.id, existing);
      } else {
        nextBuckets.set(entry.id, {
          entry: { ...entry, apiKey: trimmed },
          state: {
            id: entry.id,
            role: entry.role,
            label: entry.label,
            maskedKey: maskGeminiApiKey(trimmed),
            status: "untested",
            inFlightCount: 0,
            cooldownUntilMs: 0,
            consecutiveRateLimits: 0,
            successCount: 0,
            failureCount: 0,
            rateLimitCount: 0,
            lastUsedAt: null,
            lastTestedAt: null,
          },
          requestTimestampsMs: [],
        });
      }
    }

    this.buckets = nextBuckets;
    if (this.buckets.size > 0) {
      this.rrCursor = this.rrCursor % this.buckets.size;
    } else {
      this.rrCursor = 0;
    }
  }

  /**
   * Returns all known raw API keys (for redaction only).
   */
  getKnownRawKeysForRedaction(): string[] {
    const keys: string[] = [];
    for (const b of this.buckets.values()) {
      if (b.entry.apiKey) keys.push(b.entry.apiKey);
    }
    for (const e of getGeminiKeyEntriesSync()) {
      if (e.apiKey) keys.push(e.apiKey);
    }
    return keys;
  }

  /**
   * Returns a safe snapshot of all key states (never exposes raw `apiKey`).
   */
  getPoolStatesSnapshot(fallbackSingleApiKey?: string): GeminiKeyRuntimeState[] {
    this.syncBucketsWithStore(fallbackSingleApiKey);
    const now = this.nowFn();
    return Array.from(this.buckets.values()).map((b) => {
      // Auto-recover status display from rate_limited if cooldown has elapsed
      let effectiveStatus = b.state.status;
      if (
        effectiveStatus === "rate_limited" &&
        b.state.cooldownUntilMs > 0 &&
        now >= b.state.cooldownUntilMs
      ) {
        effectiveStatus = b.state.successCount > 0 ? "valid" : "untested";
      }
      return {
        ...b.state,
        status: effectiveStatus,
      };
    });
  }

  /**
   * Returns the number of configured keys that are not permanently disabled (`invalid` or `quota_exhausted`).
   */
  getUsableKeyCount(fallbackSingleApiKey?: string): number {
    this.syncBucketsWithStore(fallbackSingleApiKey);
    let count = 0;
    for (const b of this.buckets.values()) {
      if (b.state.status !== "invalid" && b.state.status !== "quota_exhausted") {
        count++;
      }
    }
    return count;
  }

  /**
   * Computes a conservative recommended concurrency level based on usable keys,
   * workload size, and shared quota health.
   * - Never blindly sets concurrency = key count.
   * - Defaults conservatively to 2 for multi-batch jobs when >= 1 healthy key is available,
   *   scaling up to at most 3 when >= 3 healthy keys are active and no shared 429 is active.
   */
  getRecommendedConcurrency(
    totalBatches: number,
    fallbackSingleApiKey?: string,
    requestedMaxConcurrency?: number
  ): number {
    if (totalBatches <= 1) return 1;
    this.syncBucketsWithStore(fallbackSingleApiKey);

    const usableKeys = this.getUsableKeyCount(fallbackSingleApiKey);
    if (usableKeys <= 0) return 1;

    const now = this.nowFn();
    // If shared project cooldown was recently triggered, throttle concurrency to 1-2
    const hasRecentSharedPressure =
      this.sharedProjectCooldownUntilMs > 0 &&
      now - this.sharedProjectCooldownUntilMs < 30000;

    if (hasRecentSharedPressure) {
      return Math.min(totalBatches, requestedMaxConcurrency ?? 1, 2);
    }

    const defaultCap = usableKeys >= 3 ? 3 : 2;
    const cap =
      requestedMaxConcurrency !== undefined
        ? Math.max(1, Math.min(4, requestedMaxConcurrency))
        : defaultCap;

    return Math.max(1, Math.min(totalBatches, cap));
  }

  private isBucketAvailableAt(bucket: InternalKeyBucket, now: number): {
    available: boolean;
    waitMs: number;
    permanentlyDisabled: boolean;
  } {
    if (
      bucket.state.status === "invalid" ||
      bucket.state.status === "quota_exhausted"
    ) {
      return { available: false, waitMs: Infinity, permanentlyDisabled: true };
    }

    // Prune sliding-window timestamps older than 60s
    bucket.requestTimestampsMs = bucket.requestTimestampsMs.filter(
      (ts) => now - ts < 60000
    );

    if (now < this.sharedProjectCooldownUntilMs) {
      return {
        available: false,
        waitMs: Math.max(50, this.sharedProjectCooldownUntilMs - now),
        permanentlyDisabled: false,
      };
    }

    if (now < bucket.state.cooldownUntilMs) {
      return {
        available: false,
        waitMs: Math.max(50, bucket.state.cooldownUntilMs - now),
        permanentlyDisabled: false,
      };
    }

    if (bucket.requestTimestampsMs.length >= this.maxRpmPerKey) {
      const oldest = bucket.requestTimestampsMs[0];
      const rpmWait = Math.max(50, 60000 - (now - oldest) + 25);
      return {
        available: false,
        waitMs: rpmWait,
        permanentlyDisabled: false,
      };
    }

    return { available: true, waitMs: 0, permanentlyDisabled: false };
  }

  /**
   * Acquires an API key lease for a Gemini request.
   * - Selects the healthiest available key with the lowest `inFlightCount`, rotating via Round-Robin.
   * - Waits out temporary 429 / RPM cooldowns (up to `maxCooldownWaitMs`) while respecting cancellation.
   * - Throws a descriptive error (with zero raw key leakage) if no keys are configured or all keys are unusable.
   */
  async acquireKeyLease(options?: {
    modelName?: string;
    fallbackSingleApiKey?: string;
    isCancelled?: () => boolean;
    isPaused?: () => boolean;
    signal?: AbortSignal;
  }): Promise<GeminiKeyLease> {
    const modelName = options?.modelName || "gemini-1.5-flash";
    const startedWaitAt = this.nowFn();

    while (true) {
      if (options?.isCancelled?.() || options?.signal?.aborted) {
        throw new Error("CANCELLED: Tác vụ dịch Gemini đã bị hủy.");
      }

      while (options?.isPaused?.() && !options?.isCancelled?.() && !options?.signal?.aborted) {
        await this.sleepFn(150);
      }

      if (options?.isCancelled?.() || options?.signal?.aborted) {
        throw new Error("CANCELLED: Tác vụ dịch Gemini đã bị hủy.");
      }

      this.syncBucketsWithStore(options?.fallbackSingleApiKey);
      const bucketList = Array.from(this.buckets.values());

      if (bucketList.length === 0) {
        throw new Error(
          "Chưa cấu hình Google Gemini API Key. Vui lòng thêm API Key trong Cài đặt → Nhà cung cấp AI → Google Gemini."
        );
      }

      const now = this.nowFn();
      const candidates: Array<{ idx: number; bucket: InternalKeyBucket }> = [];
      let minWaitMs = Infinity;
      let allPermanentlyDisabled = true;

      for (let offset = 0; offset < bucketList.length; offset++) {
        const idx = (this.rrCursor + offset) % bucketList.length;
        const bucket = bucketList[idx];
        const check = this.isBucketAvailableAt(bucket, now);

        if (!check.permanentlyDisabled) {
          allPermanentlyDisabled = false;
        }

        if (check.available) {
          candidates.push({ idx, bucket });
        } else if (check.waitMs < minWaitMs) {
          minWaitMs = check.waitMs;
        }
      }

      if (allPermanentlyDisabled) {
        const reasons = bucketList
          .map((b) => `${b.state.label} (${b.state.maskedKey}): ${b.state.lastStatusMessage || b.state.status}`)
          .join("; ");
        throw new Error(
          `Toàn bộ ${bucketList.length} Gemini API Key đều không khả dụng (lỗi xác thực hoặc hết hạn mức): ${reasons}`
        );
      }

      if (candidates.length > 0) {
        // Choose candidate with lowest inFlightCount (preferring 0 in-flight), preserving RR order on ties
        candidates.sort((a, b) => a.bucket.state.inFlightCount - b.bucket.state.inFlightCount);
        const chosen = candidates[0];

        // Advance round-robin cursor past the chosen index
        this.rrCursor = (chosen.idx + 1) % bucketList.length;

        // Enforce gentle launch stagger when firing concurrent requests
        const currentNow = this.nowFn();
        const nextAllowedLaunch = Math.max(
          currentNow,
          this.lastLaunchAtMs + this.minLaunchStaggerMs
        );
        const staggerWaitMs = nextAllowedLaunch - currentNow;
        this.lastLaunchAtMs = nextAllowedLaunch;

        // Lease slot immediately before awaiting stagger so concurrent callers see updated inFlightCount
        const targetBucket = chosen.bucket;
        targetBucket.state.inFlightCount += 1;
        targetBucket.state.lastUsedAt = nextAllowedLaunch;
        targetBucket.requestTimestampsMs.push(nextAllowedLaunch);
        if (
          targetBucket.state.status === "rate_limited" &&
          currentNow >= targetBucket.state.cooldownUntilMs
        ) {
          targetBucket.state.status =
            targetBucket.state.successCount > 0 ? "valid" : "untested";
        }

        if (staggerWaitMs > 0) {
          await this.sleepFn(staggerWaitMs);
        }

        let released = false;
        return {
          keyId: targetBucket.entry.id,
          role: targetBucket.entry.role,
          label: targetBucket.entry.label,
          apiKey: targetBucket.entry.apiKey,
          maskedKey: targetBucket.state.maskedKey,
          modelName,
          releaseSuccess: () => {
            if (released) return;
            released = true;
            this.handleReleaseSuccess(targetBucket.entry.id);
          },
          releaseFailure: (classified: ClassifiedGeminiError) => {
            if (released) return;
            released = true;
            this.handleReleaseFailure(targetBucket.entry.id, classified);
          },
        };
      }

      // All usable keys are currently cooling down (429 / RPM limit)
      const totalWaited = now - startedWaitAt;
      if (minWaitMs === Infinity || totalWaited + minWaitMs > this.maxCooldownWaitMs) {
        throw new Error(
          `Tất cả ${bucketList.length} Gemini API Key đang bị giới hạn tốc độ (HTTP 429) vượt quá thời gian chờ cho phép (${Math.round(
            this.maxCooldownWaitMs / 1000
          )}s). Vui lòng thử lại sau ít phút.`
        );
      }

      // Sleep in small increments so cancellation is responsive
      const sleepChunk = Math.min(minWaitMs, 500);
      await this.sleepFn(sleepChunk);
    }
  }

  private handleReleaseSuccess(keyId: string): void {
    const bucket = this.buckets.get(keyId);
    if (!bucket) return;
    bucket.state.inFlightCount = Math.max(0, bucket.state.inFlightCount - 1);
    bucket.state.successCount += 1;
    bucket.state.consecutiveRateLimits = 0;
    bucket.state.cooldownUntilMs = 0;
    bucket.state.status = "valid";
    bucket.state.lastStatusMessage = "Hợp lệ";
  }

  private handleReleaseFailure(keyId: string, classified: ClassifiedGeminiError): void {
    const bucket = this.buckets.get(keyId);
    if (!bucket) return;
    bucket.state.inFlightCount = Math.max(0, bucket.state.inFlightCount - 1);

    if (classified.category === "cancelled") {
      return;
    }

    bucket.state.failureCount += 1;
    bucket.state.lastStatusMessage = classified.sanitizedMessage;

    if (classified.permanentlyDisableKey) {
      bucket.state.status = classified.targetKeyStatus;
      return;
    }

    const now = this.nowFn();
    if (classified.category === "rate_limit_429") {
      bucket.state.rateLimitCount += 1;
      bucket.state.consecutiveRateLimits += 1;
      bucket.state.status = "rate_limited";

      const delayMs =
        classified.retryDelayMs > 0
          ? classified.retryDelayMs
          : computeBackoffWithJitterMs(
              bucket.state.consecutiveRateLimits,
              this.baseBackoffMs
            );

      bucket.state.cooldownUntilMs = Math.max(
        bucket.state.cooldownUntilMs,
        now + delayMs
      );

      // Shared project quota detection: track recent 429s across distinct keys
      this.recent429Events = this.recent429Events.filter(
        (ev) => now - ev.timestampMs <= this.sharedQuotaWindowMs
      );
      this.recent429Events.push({ keyId, timestampMs: now, delayMs });

      const distinctKeysHit429 = new Set(this.recent429Events.map((e) => e.keyId)).size;
      if (classified.isSharedProjectQuotaLikely || distinctKeysHit429 >= 2) {
        // Multiple keys hit 429 within the window -> shared project quota limit!
        // Pause the entire pool for the cooldown duration so we don't hammer remaining keys
        const sharedDelay = Math.max(
          delayMs,
          ...this.recent429Events.map((e) => e.delayMs)
        );
        this.sharedProjectCooldownUntilMs = Math.max(
          this.sharedProjectCooldownUntilMs,
          now + sharedDelay
        );
      }
    } else if (classified.retryDelayMs > 0) {
      bucket.state.cooldownUntilMs = Math.max(
        bucket.state.cooldownUntilMs,
        now + classified.retryDelayMs
      );
    }
  }

  /**
   * Tests a single Gemini API key against the specified model and updates its runtime status
   * if the key exists in the pool.
   */
  async testSingleKey(params: {
    id: string;
    role: GeminiKeyRole;
    label: string;
    apiKey: string;
    modelName?: string;
    timeoutSec?: number;
  }): Promise<GeminiConnectionTestItemResult> {
    const trimmed = (params.apiKey || "").trim();
    const masked = maskGeminiApiKey(trimmed);
    const modelId = (params.modelName || "gemini-1.5-flash").trim() || "gemini-1.5-flash";
    const timeoutSec = Math.max(5, params.timeoutSec || 30);

    if (!trimmed) {
      return {
        id: params.id,
        role: params.role,
        label: params.label,
        maskedKey: masked,
        status: "untested",
        ok: false,
        message: "Chưa nhập khóa API",
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelId
    )}`;

    try {
      const res = await appHttpRequest(url, {
        method: "GET",
        headers: {
          "x-goog-api-key": trimmed,
        },
        timeoutSec,
      });

      const now = this.nowFn();
      const bucket = this.buckets.get(params.id);

      if (res.ok) {
        if (bucket && bucket.entry.apiKey === trimmed) {
          bucket.state.status = "valid";
          bucket.state.lastTestedAt = now;
          bucket.state.cooldownUntilMs = 0;
          bucket.state.consecutiveRateLimits = 0;
          bucket.state.lastStatusMessage = "Hợp lệ";
        }
        return {
          id: params.id,
          role: params.role,
          label: params.label,
          maskedKey: masked,
          status: "valid",
          ok: true,
          httpStatus: res.status,
          message: "Hợp lệ",
        };
      }

      const classified = classifyGeminiError({
        httpStatus: res.status,
        bodyText: res.text,
        retryAfterHeader: res.retryAfter,
        knownKeys: [trimmed, ...this.getKnownRawKeysForRedaction()],
      });

      const mappedStatus: GeminiKeyHealthStatus =
        classified.category === "rate_limit_429" ||
        classified.category === "server_5xx" ||
        classified.category === "network_or_timeout"
          ? "rate_limited"
          : classified.category === "quota_exhausted"
          ? "quota_exhausted"
          : "invalid";

      if (bucket && bucket.entry.apiKey === trimmed) {
        bucket.state.status = mappedStatus;
        bucket.state.lastTestedAt = now;
        bucket.state.lastStatusMessage = classified.sanitizedMessage;
      }

      return {
        id: params.id,
        role: params.role,
        label: params.label,
        maskedKey: masked,
        status: mappedStatus,
        ok: false,
        httpStatus: res.status,
        message:
          mappedStatus === "rate_limited"
            ? "Đang bị giới hạn hoặc tạm thời không khả dụng"
            : mappedStatus === "quota_exhausted"
            ? "Đang bị giới hạn hạn mức (Quota)"
            : "Không hợp lệ",
      };
    } catch (err: any) {
      const classified = classifyGeminiError({
        errorMessage: err?.message || String(err),
        knownKeys: [trimmed, ...this.getKnownRawKeysForRedaction()],
      });
      const now = this.nowFn();
      const bucket = this.buckets.get(params.id);
      if (bucket && bucket.entry.apiKey === trimmed) {
        bucket.state.status = "rate_limited";
        bucket.state.lastTestedAt = now;
        bucket.state.lastStatusMessage = classified.sanitizedMessage;
      }
      return {
        id: params.id,
        role: params.role,
        label: params.label,
        maskedKey: masked,
        status: "rate_limited",
        ok: false,
        message: "Đang bị giới hạn hoặc tạm thời không khả dụng",
      };
    }
  }

  /**
   * Tests all non-empty Gemini keys individually and returns per-key statuses
   * plus the formatted aggregate summary string (e.g. `3 API Key | 2 hợp lệ | 1 lỗi`).
   */
  async testAllConfiguredKeys(params?: {
    entries?: Array<{ id: string; role: GeminiKeyRole; label: string; apiKey: string }>;
    modelName?: string;
    timeoutSec?: number;
  }): Promise<GeminiPoolConnectionTestSummary> {
    this.syncBucketsWithStore();
    const rawEntries =
      params?.entries ??
      getGeminiKeyEntriesSync().map((e) => ({
        id: e.id,
        role: e.role,
        label: e.label,
        apiKey: e.apiKey,
      }));

    const nonEmptyEntries = rawEntries.filter((e) => (e.apiKey || "").trim().length > 0);
    if (nonEmptyEntries.length === 0) {
      return {
        totalConfigured: 0,
        validCount: 0,
        rateLimitedCount: 0,
        invalidCount: 0,
        untestedCount: rawEntries.length,
        summaryText: "Chưa nhập Google Gemini API Key nào.",
        results: [],
      };
    }

    const results: GeminiConnectionTestItemResult[] = [];
    for (const entry of nonEmptyEntries) {
      const res = await this.testSingleKey({
        id: entry.id,
        role: entry.role,
        label: entry.label,
        apiKey: entry.apiKey,
        modelName: params?.modelName,
        timeoutSec: params?.timeoutSec,
      });
      results.push(res);
    }

    const validCount = results.filter((r) => r.status === "valid").length;
    const rateLimitedCount = results.filter(
      (r) => r.status === "rate_limited" || r.status === "quota_exhausted"
    ).length;
    const invalidCount = results.filter((r) => r.status === "invalid").length;
    const errorOrLimitedCount = invalidCount + rateLimitedCount;

    const summaryParts = [
      `${results.length} API Key`,
      `${validCount} hợp lệ`,
      `${errorOrLimitedCount} lỗi`,
    ];
    if (rateLimitedCount > 0 && invalidCount > 0) {
      summaryParts[2] = `${invalidCount} lỗi | ${rateLimitedCount} giới hạn`;
    } else if (rateLimitedCount > 0 && invalidCount === 0) {
      summaryParts[2] = `${rateLimitedCount} giới hạn (${errorOrLimitedCount} lỗi)`;
    }

    return {
      totalConfigured: results.length,
      validCount,
      rateLimitedCount,
      invalidCount,
      untestedCount: 0,
      summaryText: summaryParts.join(" | "),
      results,
    };
  }
}

export const geminiKeyPool = GeminiKeyPool.getInstance();

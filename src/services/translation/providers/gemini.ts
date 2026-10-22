import {
  TranslationProvider,
  TranslationConnectionResult,
  TranslationContext,
  TranslationStyle,
  BatchItem,
  BatchTranslationContext,
} from "../types";
import { buildCinemaPrompt } from "../cinemaAdaptation";
import { appHttpRequest } from "../../http/nativeClient";
import {
  buildBatchTranslationPrompt,
  parseBatchTranslationResponse,
  stripThinkingTags,
} from "../batchTranslationHelper";
import {
  ClassifiedGeminiError,
  classifyGeminiError,
  geminiKeyPool,
} from "../geminiKeyPool";
import {
  getActiveGeminiKeyEntriesSync,
  redactGeminiKeysFromText,
} from "../geminiKeyStore";

export class GeminiApiError extends Error {
  readonly classified: ClassifiedGeminiError;
  readonly keyId?: string;
  readonly maskedKey?: string;

  constructor(
    classified: ClassifiedGeminiError,
    keyId?: string,
    maskedKey?: string
  ) {
    super(classified.sanitizedMessage);
    this.name = "GeminiApiError";
    this.classified = classified;
    this.keyId = keyId;
    this.maskedKey = maskedKey;
  }
}

export class GeminiTranslateProvider implements TranslationProvider {
  readonly id = "gemini";
  readonly displayName = "Gemini";
  readonly type = "gemini" as const;
  readonly badge = "API";
  description = "Google Gemini Flash (Cloud API)";
  apiKey = "";
  model = "gemini-1.5-flash";
  timeout = 60;
  maxTokens = 4096;
  private explicitSingleKeyOnly = false;

  constructor(apiKey?: string, model?: string, timeout?: number, maxTokens?: number) {
    if (apiKey !== undefined) {
      this.apiKey = apiKey;
      this.explicitSingleKeyOnly = true;
    }
    if (model) this.model = model;
    if (timeout !== undefined) this.timeout = timeout;
    if (maxTokens !== undefined) this.maxTokens = maxTokens;
  }

  private hasAnyConfiguredKey(): boolean {
    if (this.apiKey && this.apiKey.trim().length > 0) return true;
    if (!this.explicitSingleKeyOnly) {
      return getActiveGeminiKeyEntriesSync().length > 0 || geminiKeyPool.getUsableKeyCount() > 0;
    }
    return false;
  }

  /**
   * Executes a single text translation using `GeminiKeyPool` with automatic key rotation
   * on retryable errors (429 / 5xx / transient network error).
   * When `strict` is true, throws `GeminiApiError` after retries are exhausted instead of returning source text.
   */
  async translateWithKeyPool(
    text: string,
    targetLang: string,
    _sourceLang = "auto",
    context?: TranslationContext,
    options?: {
      strict?: boolean;
      maxAttempts?: number;
      isCancelled?: () => boolean;
      isPaused?: () => boolean;
      signal?: AbortSignal;
    }
  ): Promise<string> {
    const trimmed = text.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
    if (!trimmed) return "";

    if (!this.hasAnyConfiguredKey()) {
      if (options?.strict) {
        throw new Error("Chưa cấu hình Google Gemini API Key.");
      }
      console.warn("Gemini API key is not configured.");
      return trimmed;
    }

    const modelId = this.model || "gemini-1.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelId
    )}:generateContent`;

    let prompt: string;
    if (context?.style === "cinema") {
      prompt = buildCinemaPrompt({
        cue: context.cue || { index: 0, startSec: 0, endSec: 3, text: trimmed },
        prevCues: context.prevCues || [],
        nextCues: context.nextCues || [],
        rawTranslation: trimmed,
        targetLang,
      });
    } else if (context?.groupSourceText && context.groupSourceText !== trimmed) {
      prompt = `Full sentence context: "${context.groupSourceText}"\nTranslate the following specific phrase from that sentence into ${targetLang}. Return ONLY the translation of the phrase, without quotes or explanations:\n${trimmed}`;
    } else {
      prompt = `Translate the following subtitle text to ${targetLang}. Return ONLY the translation, without quotes, explanations or extra words:\n${trimmed}`;
    }

    const timeoutSec = Math.max(5, this.timeout || 60);
    const maxOutputTokens = this.maxTokens && this.maxTokens > 0 ? this.maxTokens : 2048;
    const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const lease = await geminiKeyPool.acquireKeyLease({
        modelName: modelId,
        fallbackSingleApiKey: this.apiKey,
        isCancelled: options?.isCancelled,
        isPaused: options?.isPaused,
        signal: options?.signal,
      });

      const startedAt = Date.now();
      try {
        const res = await appHttpRequest(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": lease.apiKey,
          },
          body: {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens },
          },
          timeoutSec,
          signal: options?.signal,
          isCancelled: options?.isCancelled,
        });

        if (options?.isCancelled?.() || options?.signal?.aborted) {
          const classified = classifyGeminiError({
            errorMessage: "CANCELLED: Request aborted by user.",
            knownKeys: [lease.apiKey],
          });
          lease.releaseFailure(classified, Date.now() - startedAt);
          throw new GeminiApiError(classified, lease.keyId, lease.maskedKey);
        }

        if (!res.ok) {
          const classified = classifyGeminiError({
            httpStatus: res.status,
            bodyText: res.text,
            retryAfterHeader: res.retryAfter,
            consecutiveRateLimits: attempt,
            knownKeys: [lease.apiKey, ...geminiKeyPool.getKnownRawKeysForRedaction()],
          });
          lease.releaseFailure(classified, Date.now() - startedAt);
          throw new GeminiApiError(classified, lease.keyId, lease.maskedKey);
        }

        const candidate = stripThinkingTags(
          res.data?.candidates?.[0]?.content?.parts?.[0]?.text || ""
        ).trim();

        if (!candidate) {
          const classified = classifyGeminiError({
            httpStatus: 502,
            errorMessage: "Phản hồi Gemini trống hoặc bị chặn bởi bộ lọc an toàn.",
            consecutiveRateLimits: attempt,
            knownKeys: [lease.apiKey],
          });
          lease.releaseFailure(classified, Date.now() - startedAt);
          throw new GeminiApiError(classified, lease.keyId, lease.maskedKey);
        }

        lease.releaseSuccess(Date.now() - startedAt);
        return candidate;
      } catch (err: any) {
        if (err instanceof GeminiApiError) {
          lastError = err;
          if (err.classified.category === "cancelled") {
            throw err;
          }
          // If key was permanently disabled (401/403) and other keys exist in the pool, try another key
          if (
            !err.classified.retryable &&
            geminiKeyPool.getUsableKeyCount(this.apiKey) <= 0
          ) {
            break;
          }
          continue;
        }

        const classified = classifyGeminiError({
          errorMessage: err?.message || String(err),
          consecutiveRateLimits: attempt,
          knownKeys: [lease.apiKey, ...geminiKeyPool.getKnownRawKeysForRedaction()],
        });
        lease.releaseFailure(classified, Date.now() - startedAt);
        lastError = new GeminiApiError(classified, lease.keyId, lease.maskedKey);
        if (classified.category === "cancelled" || !classified.retryable) {
          break;
        }
      }
    }

    if (options?.strict && lastError) {
      throw lastError;
    }

    if (lastError) {
      console.warn(
        "Gemini translation error:",
        redactGeminiKeysFromText(lastError.message, geminiKeyPool.getKnownRawKeysForRedaction())
      );
    }
    return trimmed;
  }

  async translate(
    text: string,
    targetLang: string,
    sourceLang = "auto",
    context?: TranslationContext
  ): Promise<string> {
    return this.translateWithKeyPool(text, targetLang, sourceLang, context, {
      strict: false,
    });
  }

  async testConnection(): Promise<TranslationConnectionResult> {
    if (this.explicitSingleKeyOnly) {
      const trimmedKey = (this.apiKey || "").trim();
      if (!trimmedKey) {
        return { ok: false, message: "Chưa cấu hình Gemini API Key." };
      }
      const singleRes = await geminiKeyPool.testSingleKey({
        id: "gemini_single_test",
        role: "primary",
        label: "API Key chính",
        apiKey: trimmedKey,
        modelName: this.model || "gemini-1.5-flash",
        timeoutSec: this.timeout || 60,
      });
      return {
        ok: singleRes.ok,
        message: singleRes.ok
          ? `Kết nối Gemini API (${this.model || "gemini-1.5-flash"}) thành công!`
          : `Lỗi kết nối Gemini API (${singleRes.message})`,
      };
    }

    if (!this.hasAnyConfiguredKey()) {
      return { ok: false, message: "Chưa cấu hình Gemini API Key." };
    }

    const summary = await geminiKeyPool.testAllConfiguredKeys({
      modelName: this.model || "gemini-1.5-flash",
      timeoutSec: this.timeout || 60,
    });

    return {
      ok: summary.validCount > 0,
      message: summary.summaryText,
    };
  }

  /**
   * Executes a single batch translation request using an acquired key lease from `GeminiKeyPool`.
   * Throws `GeminiApiError` with full `ClassifiedGeminiError` details on HTTP 429, 401, 403, 5xx,
   * timeout, or empty/unparseable output so `GeminiTranslationCoordinator` can track retries,
   * rotate keys, and recover failed batches accurately.
   */
  async executeBatchAttemptWithPool(
    items: BatchItem[],
    targetLang: string,
    _sourceLang = "auto",
    style: TranslationStyle = "default",
    batchContext?: BatchTranslationContext,
    options?: {
      attempt?: number;
      isCancelled?: () => boolean;
      isPaused?: () => boolean;
      signal?: AbortSignal;
      onKeyAttempt?: (info: {
        keyId: string;
        maskedKey: string;
        status: "success" | "rate_limit_429" | "error";
        httpStatus?: number;
      }) => void;
    }
  ): Promise<{
    translations: Map<number, string>;
    keyId: string;
    maskedKey: string;
    durationMs: number;
  }> {
    if (!items || items.length === 0) {
      return {
        translations: new Map(),
        keyId: "none",
        maskedKey: "",
        durationMs: 0,
      };
    }

    const modelId = this.model || "gemini-1.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelId
    )}:generateContent`;
    const { system, user } = buildBatchTranslationPrompt(
      items,
      targetLang,
      style,
      batchContext
    );
    const fullPrompt = `${system}\n\n${user}`;
    const timeoutSec = Math.max(20, (this.timeout || 60) * 2);
    const maxOutputTokens = Math.max(this.maxTokens || 4096, items.length * 120);
    const attemptNum = options?.attempt ?? 1;

    const lease = await geminiKeyPool.acquireKeyLease({
      modelName: modelId,
      fallbackSingleApiKey: this.apiKey,
      isCancelled: options?.isCancelled,
      isPaused: options?.isPaused,
      signal: options?.signal,
    });

    const startedAt = Date.now();
    try {
      const res = await appHttpRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": lease.apiKey,
        },
        body: {
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens },
        },
        timeoutSec,
        signal: options?.signal,
        isCancelled: options?.isCancelled,
      });

      const durationMs = Date.now() - startedAt;

      if (options?.isCancelled?.() || options?.signal?.aborted) {
        const classified = classifyGeminiError({
          errorMessage: "CANCELLED: Request aborted by user.",
          knownKeys: [lease.apiKey],
        });
        lease.releaseFailure(classified, durationMs);
        throw new GeminiApiError(classified, lease.keyId, lease.maskedKey);
      }

      if (!res.ok) {
        const classified = classifyGeminiError({
          httpStatus: res.status,
          bodyText: res.text,
          retryAfterHeader: res.retryAfter,
          consecutiveRateLimits: attemptNum,
          knownKeys: [lease.apiKey, ...geminiKeyPool.getKnownRawKeysForRedaction()],
        });
        lease.releaseFailure(classified, durationMs);
        options?.onKeyAttempt?.({
          keyId: lease.keyId,
          maskedKey: lease.maskedKey,
          status:
            classified.category === "rate_limit_429" ? "rate_limit_429" : "error",
          httpStatus: res.status,
        });
        throw new GeminiApiError(classified, lease.keyId, lease.maskedKey);
      }

      const candidate = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const parsed = parseBatchTranslationResponse(candidate, items);

      if (parsed.size === 0) {
        const classified = classifyGeminiError({
          httpStatus: 502,
          errorMessage:
            "Phản hồi lô dịch Gemini trống hoặc sai định dạng (0 câu hợp lệ).",
          consecutiveRateLimits: attemptNum,
          knownKeys: [lease.apiKey],
        });
        lease.releaseFailure(classified, durationMs);
        options?.onKeyAttempt?.({
          keyId: lease.keyId,
          maskedKey: lease.maskedKey,
          status: "error",
          httpStatus: 502,
        });
        throw new GeminiApiError(classified, lease.keyId, lease.maskedKey);
      }

      lease.releaseSuccess(durationMs);
      options?.onKeyAttempt?.({
        keyId: lease.keyId,
        maskedKey: lease.maskedKey,
        status: "success",
        httpStatus: res.status,
      });

      return {
        translations: parsed,
        keyId: lease.keyId,
        maskedKey: lease.maskedKey,
        durationMs,
      };
    } catch (err: any) {
      if (err instanceof GeminiApiError) {
        throw err;
      }
      const durationMs = Date.now() - startedAt;
      const classified = classifyGeminiError({
        errorMessage: err?.message || String(err),
        consecutiveRateLimits: attemptNum,
        knownKeys: [lease.apiKey, ...geminiKeyPool.getKnownRawKeysForRedaction()],
      });
      lease.releaseFailure(classified, durationMs);
      if (classified.category !== "cancelled") {
        options?.onKeyAttempt?.({
          keyId: lease.keyId,
          maskedKey: lease.maskedKey,
          status:
            classified.category === "rate_limit_429" ? "rate_limit_429" : "error",
        });
      }
      throw new GeminiApiError(classified, lease.keyId, lease.maskedKey);
    }
  }

  /**
   * Standard `TranslationProvider.translateBatch` implementation backed by `GeminiKeyPool`.
   * Retries up to 3 attempts across available keys in the pool before throwing `GeminiApiError`.
   */
  async translateBatch(
    items: BatchItem[],
    targetLang: string,
    sourceLang = "auto",
    style: TranslationStyle = "default",
    batchContext?: BatchTranslationContext
  ): Promise<Map<number, string>> {
    if (!items || items.length === 0) return new Map();
    if (!this.hasAnyConfiguredKey()) {
      return new Map(items.map((it) => [it.id, it.text]));
    }

    const maxAttempts = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.executeBatchAttemptWithPool(
          items,
          targetLang,
          sourceLang,
          style,
          batchContext,
          { attempt }
        );
        return res.translations;
      } catch (err: any) {
        lastError = err;
        if (err instanceof GeminiApiError) {
          if (err.classified.category === "cancelled") {
            throw err;
          }
          if (
            !err.classified.retryable &&
            geminiKeyPool.getUsableKeyCount(this.apiKey) <= 0
          ) {
            break;
          }
        }
      }
    }

    if (lastError) {
      throw lastError;
    }
    return new Map();
  }
}

/**
 * Concurrent Translation Coordinator for Google Gemini.
 *
 * Implements the unified pipeline:
 * `SRT/Văn bản → Nhóm câu hoàn chỉnh → Chia lô (Token-aware) → Hàng đợi Gemini → Phân phối nhiều API Key → Dịch song song → Hậu kiểm → Ghép kết quả theo ID`
 *
 * Key Invariants:
 * 1. Exclusively used for Google Gemini (`provider.type === "gemini"`). Other providers are untouched.
 * 2. Preserves cross-batch context during out-of-order parallel execution via:
 *    - Global Script Summary (`buildGlobalScriptSummary`)
 *    - Shared Proper Noun & Terminology Glossary (`extractScriptGlossaryAndEntities`)
 *    - Read-only surrounding source lines (`surroundingContextBefore` / `surroundingContextAfter`)
 * 3. Deterministic ID-based assembly: every speech group / cue has a stable global `unitId`.
 *    Out-of-order batch completion never alters output order, drops items, or duplicates items.
 * 4. Granular retry recovery: if a batch partially succeeds, keeps succeeded items and retries
 *    only the missing/failed items. Never silently returns untranslated source text as success.
 */

import {
  BatchItem,
  BatchTranslationContext,
  TranslationStyle,
} from "./types";
import { DubbingMode } from "../../types/dubbing";
import {
  buildGlobalScriptSummary,
  chunkItemsTokenAware,
  extractScriptGlossaryAndEntities,
} from "./batchTranslationHelper";
import { GeminiApiError, GeminiTranslateProvider } from "./providers/gemini";
import { geminiKeyPool } from "./geminiKeyPool";
import { redactGeminiKeysFromText } from "./geminiKeyStore";

export interface GeminiTranslationUnit {
  /** Stable global ID across the entire translation job (e.g. 1..N) */
  unitId: number;
  /** Normalized complete sentence group or cue source text */
  sourceText: string;
  /** Number of underlying subtitle cues represented by this unit (for progress reporting) */
  cueWeight?: number;
}

export interface GeminiTranslationMetrics {
  totalDurationMs: number;
  totalUnits: number;
  completedUnits: number;
  totalBatches: number;
  concurrencyUsed: number;
  totalRequests: number;
  retryCount: number;
  rateLimit429Count: number;
  errorCount: number;
  missingUnitCount: number;
  duplicateUnitCount: number;
  perKeyUsage: Record<
    string,
    {
      maskedKey: string;
      requests: number;
      successes: number;
      rateLimits: number;
      errors: number;
    }
  >;
}

export class GeminiCoordinationError extends Error {
  readonly partialTranslations: Map<number, string>;
  readonly failedUnitIds: number[];
  readonly metrics: GeminiTranslationMetrics;

  constructor(
    message: string,
    partialTranslations: Map<number, string>,
    failedUnitIds: number[],
    metrics: GeminiTranslationMetrics
  ) {
    super(message);
    this.name = "GeminiCoordinationError";
    this.partialTranslations = partialTranslations;
    this.failedUnitIds = failedUnitIds;
    this.metrics = metrics;
  }
}

export interface GeminiCoordinatorOptions {
  targetLang: string;
  sourceLang?: string;
  style?: TranslationStyle;
  dubbingMode?: DubbingMode;
  /** Optional concurrency override (e.g. 1 for sequential benchmark, default 2-3 adaptive) */
  maxConcurrency?: number;
  /** Maximum attempts per batch before failing (default 3) */
  maxBatchAttempts?: number;
  /** Target items per batch (default 35) */
  targetBatchSize?: number;
  /** Single-pass max items (default 45) */
  singlePassMax?: number;
  onProgressCues?: (completedCues: number, totalCues: number) => void;
  isPaused?: () => boolean;
  isCancelled?: () => boolean;
  signal?: AbortSignal;
}

export interface GeminiCoordinatorResult {
  /** Ordered map from `unitId` -> translated text */
  translationsById: Map<number, string>;
  /** Detailed execution metrics for diagnostics & benchmarking */
  metrics: GeminiTranslationMetrics;
}

export class GeminiTranslationCoordinator {
  private static instance: GeminiTranslationCoordinator;
  private lastMetrics: GeminiTranslationMetrics | null = null;

  static getInstance(): GeminiTranslationCoordinator {
    if (!GeminiTranslationCoordinator.instance) {
      GeminiTranslationCoordinator.instance = new GeminiTranslationCoordinator();
    }
    return GeminiTranslationCoordinator.instance;
  }

  getLastMetrics(): GeminiTranslationMetrics | null {
    return this.lastMetrics;
  }

  /**
   * Coordinates token-aware batching, multi-key scheduling, concurrent execution,
   * post-validation, granular retry of missing items, and deterministic ID reassembly.
   */
  async executeUnits(
    provider: GeminiTranslateProvider,
    units: GeminiTranslationUnit[],
    options: GeminiCoordinatorOptions
  ): Promise<GeminiCoordinatorResult> {
    const startedAt = Date.now();
    const totalUnits = units.length;
    const totalCueWeight = units.reduce((acc, u) => acc + (u.cueWeight ?? 1), 0);

    const metrics: GeminiTranslationMetrics = {
      totalDurationMs: 0,
      totalUnits,
      completedUnits: 0,
      totalBatches: 0,
      concurrencyUsed: 1,
      totalRequests: 0,
      retryCount: 0,
      rateLimit429Count: 0,
      errorCount: 0,
      missingUnitCount: 0,
      duplicateUnitCount: 0,
      perKeyUsage: {},
    };

    if (totalUnits === 0) {
      this.lastMetrics = metrics;
      return { translationsById: new Map(), metrics };
    }

    // Verify no duplicate unitIds in input
    const seenInputIds = new Set<number>();
    for (const u of units) {
      if (seenInputIds.has(u.unitId)) {
        metrics.duplicateUnitCount += 1;
      }
      seenInputIds.add(u.unitId);
    }

    const allSourceTexts = units.map((u) => u.sourceText);
    const batches = chunkItemsTokenAware(units, (u) => u.sourceText, {
      singlePassMax: options.singlePassMax,
      targetBatchSize: options.targetBatchSize,
      maxOutputTokens: provider.maxTokens || 4096,
    });

    metrics.totalBatches = batches.length;

    const globalSummary =
      batches.length > 1 ? buildGlobalScriptSummary(allSourceTexts) : undefined;
    const glossaryTerms =
      batches.length > 1 ? extractScriptGlossaryAndEntities(allSourceTexts) : undefined;

    const concurrency = geminiKeyPool.getRecommendedConcurrency(
      batches.length,
      provider.apiKey,
      options.maxConcurrency
    );
    metrics.concurrencyUsed = concurrency;

    const rawTranslatedById = new Map<number, string>();
    const cueWeightById = new Map<number, number>();
    for (const u of units) {
      cueWeightById.set(u.unitId, u.cueWeight ?? 1);
    }

    const maxBatchAttempts = Math.max(1, options.maxBatchAttempts ?? 3);
    const batchErrors: Error[] = [];
    let fatalAbortError: Error | null = null;
    const sessionAbortController = new AbortController();
    const isSessionCancelled = (): boolean =>
      Boolean(
        options.isCancelled?.() ||
          options.signal?.aborted ||
          sessionAbortController.signal.aborted
      );
    const abortSession = () => {
      if (!sessionAbortController.signal.aborted) {
        sessionAbortController.abort();
      }
    };
    const onCallerAbort = () => abortSession();
    if (options.signal) {
      if (options.signal.aborted) {
        abortSession();
      } else {
        options.signal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }

    let completedCueWeight = 0;
    const recordUnitCompleted = (unitId: number, translatedText: string) => {
      if (isSessionCancelled() || fatalAbortError) return;
      const clean = translatedText.trim();
      if (!clean) return;
      const alreadyHad = rawTranslatedById.has(unitId);
      rawTranslatedById.set(unitId, clean);
      if (!alreadyHad) {
        metrics.completedUnits += 1;
        completedCueWeight += cueWeightById.get(unitId) ?? 1;
        options.onProgressCues?.(
          Math.min(totalCueWeight, completedCueWeight),
          totalCueWeight
        );
      }
    };

    const recordKeyTelemetry = (info: {
      keyId: string;
      maskedKey: string;
      status: "success" | "rate_limit_429" | "error";
    }) => {
      if (isSessionCancelled()) return;
      metrics.totalRequests += 1;
      if (!metrics.perKeyUsage[info.keyId]) {
        metrics.perKeyUsage[info.keyId] = {
          maskedKey: info.maskedKey,
          requests: 0,
          successes: 0,
          rateLimits: 0,
          errors: 0,
        };
      }
      const entry = metrics.perKeyUsage[info.keyId];
      entry.requests += 1;
      if (info.status === "success") {
        entry.successes += 1;
      } else if (info.status === "rate_limit_429") {
        entry.rateLimits += 1;
        metrics.rateLimit429Count += 1;
      } else {
        entry.errors += 1;
        metrics.errorCount += 1;
      }
    };

    // Build indexed batch tasks with read-only surrounding context
    const batchTasks = batches.map((batchUnits, batchIndex) => {
      const prevBatch = batchIndex > 0 ? batches[batchIndex - 1] : undefined;
      const nextBatch =
        batchIndex < batches.length - 1 ? batches[batchIndex + 1] : undefined;

      const surroundingContextBefore = prevBatch
        ? prevBatch.slice(-3).map((u) => u.sourceText)
        : undefined;
      const surroundingContextAfter = nextBatch
        ? nextBatch.slice(0, 2).map((u) => u.sourceText)
        : undefined;

      return {
        batchIndex,
        batchUnits,
        surroundingContextBefore,
        surroundingContextAfter,
      };
    });

    let nextTaskIndex = 0;

    const executeBatchTask = async (task: (typeof batchTasks)[0]): Promise<void> => {
      let pendingUnits = [...task.batchUnits];
      let lastTaskError: Error | null = null;

      for (let attempt = 1; attempt <= maxBatchAttempts && pendingUnits.length > 0; attempt++) {
        if (options.isCancelled?.() || options.signal?.aborted || fatalAbortError) {
          return;
        }

        while (
          options.isPaused?.() &&
          !options.isCancelled?.() &&
          !options.signal?.aborted &&
          !fatalAbortError
        ) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }

        if (options.isCancelled?.() || options.signal?.aborted || fatalAbortError) {
          return;
        }

        if (attempt > 1) {
          metrics.retryCount += 1;
        }

        const batchItems: BatchItem[] = pendingUnits.map((u) => ({
          id: u.unitId,
          text: u.sourceText,
        }));

        // Check if preceding batch already finished so we can supply real translated prevLines
        let dynamicPrevLines: { source: string; translated: string }[] | undefined;
        if (task.batchIndex > 0) {
          const prevBatchUnits = batches[task.batchIndex - 1].slice(-3);
          const availablePairs: { source: string; translated: string }[] = [];
          for (const pu of prevBatchUnits) {
            const trans = rawTranslatedById.get(pu.unitId);
            if (trans) {
              availablePairs.push({ source: pu.sourceText, translated: trans });
            }
          }
          if (availablePairs.length > 0) {
            dynamicPrevLines = availablePairs;
          }
        }

        const batchContext: BatchTranslationContext = {
          isFullScriptSinglePass: batches.length === 1 && attempt === 1,
          globalSummary,
          glossaryTerms,
          prevLines: dynamicPrevLines,
          surroundingContextBefore: dynamicPrevLines
            ? undefined
            : task.surroundingContextBefore,
          surroundingContextAfter: task.surroundingContextAfter,
          dubbingMode: options.dubbingMode,
        };

        try {
          const attemptRes = await provider.executeBatchAttemptWithPool(
            batchItems,
            options.targetLang,
            options.sourceLang || "auto",
            options.style || "default",
            batchContext,
            {
              attempt,
              isCancelled: isSessionCancelled,
              isPaused: options.isPaused,
              signal: sessionAbortController.signal,
              onKeyAttempt: recordKeyTelemetry,
            }
          );

          if (isSessionCancelled() || fatalAbortError) {
            abortSession();
            return;
          }

          for (const u of pendingUnits) {
            const translated = attemptRes.translations.get(u.unitId);
            if (translated && translated.trim().length > 0) {
              recordUnitCompleted(u.unitId, translated);
            }
          }

          // Filter down to only units that are still missing from `rawTranslatedById`
          pendingUnits = pendingUnits.filter((u) => !rawTranslatedById.has(u.unitId));
          lastTaskError = null;
        } catch (err: any) {
          lastTaskError = err instanceof Error ? err : new Error(String(err));
          if (
            err instanceof GeminiApiError &&
            err.classified.category === "cancelled"
          ) {
            fatalAbortError = err;
            abortSession();
            return;
          }
          if (
            String(lastTaskError.message).includes("CANCELLED") ||
            isSessionCancelled()
          ) {
            fatalAbortError = lastTaskError;
            abortSession();
            return;
          }
          // If no usable keys remain in the entire pool, stop immediately
          if (geminiKeyPool.getUsableKeyCount(provider.apiKey) <= 0) {
            fatalAbortError = lastTaskError;
            batchErrors.push(lastTaskError);
            abortSession();
            return;
          }
        }
      }

      // Targeted single-unit recovery if only 1-2 items were missed by batch formatting
      if (
        pendingUnits.length > 0 &&
        pendingUnits.length <= 3 &&
        !fatalAbortError &&
        !isSessionCancelled() &&
        geminiKeyPool.getUsableKeyCount(provider.apiKey) > 0
      ) {
        for (const missingUnit of [...pendingUnits]) {
          if (isSessionCancelled() || fatalAbortError) {
            break;
          }
          try {
            metrics.retryCount += 1;
            const singleTrans = await provider.translateWithKeyPool(
              missingUnit.sourceText,
              options.targetLang,
              options.sourceLang || "auto",
              {
                style: options.style || "default",
                dubbingMode: options.dubbingMode,
              },
              {
                strict: true,
                maxAttempts: 2,
                isCancelled: isSessionCancelled,
                isPaused: options.isPaused,
                signal: sessionAbortController.signal,
              }
            );
            if (singleTrans && singleTrans.trim().length > 0) {
              recordUnitCompleted(missingUnit.unitId, singleTrans);
            }
          } catch (singleErr: any) {
            lastTaskError =
              singleErr instanceof Error ? singleErr : new Error(String(singleErr));
          }
        }
        pendingUnits = pendingUnits.filter((u) => !rawTranslatedById.has(u.unitId));
      }

      if (pendingUnits.length > 0 && lastTaskError) {
        batchErrors.push(lastTaskError);
      }
    };

    const workerLoop = async (): Promise<void> => {
      while (nextTaskIndex < batchTasks.length) {
        if (isSessionCancelled() || fatalAbortError) {
          break;
        }
        const currentIndex = nextTaskIndex++;
        const task = batchTasks[currentIndex];
        if (!task) break;
        await executeBatchTask(task);
      }
    };

    const workerCount = Math.max(1, Math.min(concurrency, batchTasks.length));
    const workers: Promise<void>[] = [];
    for (let w = 0; w < workerCount; w++) {
      workers.push(workerLoop());
    }
    try {
      await Promise.all(workers);
    } finally {
      if (options.signal) {
        options.signal.removeEventListener("abort", onCallerAbort);
      }
    }

    metrics.totalDurationMs = Date.now() - startedAt;

    // Assemble final ordered Map strictly by the original `units` sequence
    const orderedTranslations = new Map<number, string>();
    const failedUnitIds: number[] = [];

    for (const u of units) {
      const trans = rawTranslatedById.get(u.unitId);
      if (trans && trans.trim().length > 0) {
        orderedTranslations.set(u.unitId, trans.trim());
      } else {
        failedUnitIds.push(u.unitId);
      }
    }

    metrics.missingUnitCount = failedUnitIds.length;
    this.lastMetrics = metrics;

    if (options.isCancelled?.() || options.signal?.aborted) {
      return {
        translationsById: orderedTranslations,
        metrics,
      };
    }

    if (failedUnitIds.length > 0) {
      const knownKeys = geminiKeyPool.getKnownRawKeysForRedaction();
      const rawCause =
        batchErrors[0]?.message ||
        (fatalAbortError as Error | null)?.message ||
        `Không nhận được bản dịch hợp lệ cho ${failedUnitIds.length}/${totalUnits} nhóm thoại.`;
      const sanitizedCause = redactGeminiKeysFromText(rawCause, knownKeys);

      throw new GeminiCoordinationError(
        `Dịch Gemini chưa hoàn tất (${orderedTranslations.size}/${totalUnits} nhóm thành công, ${failedUnitIds.length} nhóm lỗi): ${sanitizedCause}`,
        orderedTranslations,
        failedUnitIds,
        metrics
      );
    }

    return {
      translationsById: orderedTranslations,
      metrics,
    };
  }
}

export const geminiTranslationCoordinator = GeminiTranslationCoordinator.getInstance();

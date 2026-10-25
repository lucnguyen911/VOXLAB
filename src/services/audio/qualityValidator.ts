import { AudioQualityReview, AudioQualityStatus, ChunkItem } from "../../types/ui";
import { getSharedAiServices } from "../batch/batchRuntime";
import { LocalAiServices } from "../ai/localAiServices";
import { loadSubtitleSettings } from "../subtitle/profiles";
import { getEffectiveRules, prepareSpokenText } from "../pronunciation";
import { replacePauseTokensWithBoundary } from "../pause";

export const QUALITY_VALIDATOR_VERSION = "3.7.0";
export const MAX_AUTO_VALIDATION_RETRIES = 1;

export interface QualityCheckableItem {
  id?: string | number;
  cueIndex?: number;
  text?: string;
  cleanText?: string;
  status: string;
  audioUrl?: string;
  audioBlobUrl?: string;
  fittedAudioUrl?: string;
  audioFilePath?: string;
  audioRevision?: number;
  durationSec?: number;
  fittedDurationSec?: number;
  errorMessage?: string;
  qualityReview?: AudioQualityReview;
  acknowledgedAt?: number;
  acknowledgedAudioSignature?: string;
}

function getItemText(item: QualityCheckableItem): string {
  return item.text ?? item.cleanText ?? "";
}

function getItemDurationSec(item: QualityCheckableItem): number | undefined {
  return item.durationSec ?? item.fittedDurationSec;
}

/**
 * Helper to get the unique audio signature of a chunk's generated audio.
 */
export function getChunkAudioSignature(chunk: QualityCheckableItem): string {
  const pathOrUrl =
    chunk.fittedAudioUrl || chunk.audioUrl || chunk.audioBlobUrl || chunk.audioFilePath || "";
  if (!pathOrUrl) return "";
  const base = `${pathOrUrl}::${getItemDurationSec(chunk) ?? 0}`;
  return chunk.audioRevision !== undefined ? `${base}::v${chunk.audioRevision}` : base;
}

/**
 * Returns true if the chunk has been confirmed by the user as having correct audio.
 * The confirmation is only valid if the audio signature matches the current chunk audio.
 */
export function isChunkConfirmed(chunk: QualityCheckableItem): boolean {
  if (!chunk.acknowledgedAudioSignature) return false;
  const sig = getChunkAudioSignature(chunk);
  return Boolean(sig && chunk.acknowledgedAudioSignature === sig);
}

/**
 * Returns true if the chunk has a quality warning review, regardless of whether it is confirmed.
 */
export function hasChunkQualityWarningReview(chunk: QualityCheckableItem): boolean {
  return chunk.qualityReview?.status === "warning";
}

/**
 * Returns true if the chunk has a definitive error (status is 'failed' or review is 'error').
 */
export function isChunkError(chunk: QualityCheckableItem): boolean {
  if (chunk.status === "failed") return true;
  if (chunk.qualityReview?.status === "error") return true;
  return false;
}

/**
 * Returns true if the chunk is in 'ready' status and has an active (unconfirmed) quality warning review.
 * Errors take precedence over warnings.
 * Confirmed chunks do not count as active warnings.
 */
export function isChunkWarning(chunk: QualityCheckableItem): boolean {
  if (isChunkError(chunk)) return false;
  if (chunk.status !== "ready") return false;
  if (isChunkConfirmed(chunk)) return false;
  return chunk.qualityReview?.status === "warning";
}

/**
 * Checks whether the quality review was computed for the current text and current audio of the chunk.
 * If text or audioSignature has changed since the review, the review is considered stale.
 */
export function isReviewCurrent(chunk: QualityCheckableItem): boolean {
  if (!chunk.qualityReview) return false;
  const currentText = getItemText(chunk);
  if (chunk.qualityReview.text !== undefined && chunk.qualityReview.text !== currentText) {
    return false;
  }
  const currentSig = getChunkAudioSignature(chunk);
  if (chunk.qualityReview.audioSignature && currentSig && chunk.qualityReview.audioSignature !== currentSig) {
    return false;
  }
  return true;
}

/**
 * Returns true if the chunk's quality review is missing, stale (text changed),
 * evaluated with an older version of the validator, evaluated with a different ASR model,
 * or evaluated on different audio (audioSignature changed).
 * When isAsrReady is true, unverified reviews caused by previously missing models or transient timeouts
 * are treated as outdated for bounded auto-recovery (up to MAX_AUTO_VALIDATION_RETRIES).
 */
export function isReviewOutdated(
  chunk: QualityCheckableItem,
  currentAsrModel?: string,
  isAsrReady: boolean = true
): boolean {
  if (!chunk.qualityReview) return true;
  if (chunk.qualityReview.status === "checking") return true;
  if (!isReviewCurrent(chunk)) return true;
  if (chunk.qualityReview.validatorVersion !== QUALITY_VALIDATOR_VERSION) {
    return true;
  }
  const currentSig = getChunkAudioSignature(chunk);
  if (chunk.qualityReview.audioSignature && currentSig && chunk.qualityReview.audioSignature !== currentSig) {
    return true;
  }
  if (currentAsrModel) {
    if (!chunk.qualityReview.asrModelId || chunk.qualityReview.asrModelId !== currentAsrModel) {
      return true;
    }
  }
  // Auto-recovery: If review is unverified because model was missing or sidecar timed out,
  // and ASR is now confirmed ready, mark it outdated so background verification re-runs it (bounded by retryCount).
  if (isAsrReady && chunk.qualityReview.status === "unverified") {
    const retryCount = chunk.qualityReview.retryCount ?? 0;
    if (retryCount >= MAX_AUTO_VALIDATION_RETRIES) {
      return false;
    }
    const summaryLower = (chunk.qualityReview.summary || "").toLowerCase();
    const isModelMissingIssue =
      summaryLower.includes("không tìm thấy") ||
      summaryLower.includes("không thể khởi tạo") ||
      summaryLower.includes("chưa có trên máy") ||
      summaryLower.includes("quá thời gian");
    if (isModelMissingIssue) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the chunk is in 'ready' status and currently undergoing ASR inspection.
 */
export function isChunkChecking(chunk: QualityCheckableItem): boolean {
  if (chunk.status !== "ready") return false;
  return chunk.qualityReview?.status === "checking";
}

/**
 * Returns true if the chunk is in 'ready' status and has an unverified review.
 * Errors, warnings, and checking take precedence.
 */
export function isChunkUnverified(chunk: QualityCheckableItem): boolean {
  if (isChunkError(chunk) || isChunkWarning(chunk) || isChunkChecking(chunk)) return false;
  if (chunk.status !== "ready") return false;
  return chunk.qualityReview?.status === "unverified";
}

/**
 * Returns true if the chunk is in 'ready' status and passed quality validation.
 */
export function isChunkPass(chunk: QualityCheckableItem): boolean {
  if (isChunkError(chunk) || isChunkWarning(chunk) || isChunkUnverified(chunk) || isChunkChecking(chunk)) return false;
  if (chunk.status !== "ready") return false;
  return chunk.qualityReview?.status === "pass";
}

export interface ChunkQualityStats<T = ChunkItem> {
  errorCount: number;
  warningCount: number;
  unverifiedCount: number;
  checkingCount: number;
  passCount: number;
  errorChunks: T[];
  warningChunks: T[];
  unverifiedChunks: T[];
  checkingChunks: T[];
  passChunks: T[];
}

/**
 * Aggregates quality issues across chunks into 5 mutually-exclusive categories:
 * - Errors (Red)
 * - Warnings (Yellow)
 * - Checking (Blue / Cyan Pulse)
 * - Unverified (Neutral)
 * - Pass (Green)
 * Guarantee: A chunk with multiple warnings is counted as 1 warning chunk.
 * Guarantee: If a chunk has both error and warning, it is counted ONLY as an error chunk (Priority: Red > Yellow).
 * Guarantee: Modified chunks are not counted as quality warnings.
 */
export function countChunkQualityIssues<T extends QualityCheckableItem = ChunkItem>(
  chunks: T[]
): ChunkQualityStats<T> {
  const errorChunks: T[] = [];
  const warningChunks: T[] = [];
  const checkingChunks: T[] = [];
  const unverifiedChunks: T[] = [];
  const passChunks: T[] = [];

  for (const chunk of chunks) {
    if (isChunkError(chunk)) {
      errorChunks.push(chunk);
    } else if (isChunkWarning(chunk)) {
      warningChunks.push(chunk);
    } else if (isChunkChecking(chunk)) {
      checkingChunks.push(chunk);
    } else if (isChunkUnverified(chunk)) {
      unverifiedChunks.push(chunk);
    } else if (isChunkPass(chunk)) {
      passChunks.push(chunk);
    }
  }

  return {
    errorCount: errorChunks.length,
    warningCount: warningChunks.length,
    unverifiedCount: unverifiedChunks.length,
    checkingCount: checkingChunks.length,
    passCount: passChunks.length,
    errorChunks,
    warningChunks,
    unverifiedChunks,
    checkingChunks,
    passChunks,
  };
}

/**
 * Maps a quality issue code to a concise, human-friendly short category label.
 *
 * Mappings:
 * - SUSPECTED_STUTTER -> Vấp từ
 * - REPEATED_WORD, REPEATED_WORDS -> Lặp từ
 * - MISSING_WORD, SUSPECTED_SWALLOWED -> Thiếu từ
 * - PARTIAL_PRONUNCIATION, SUSPECTED_MISPRONUNCIATION -> Phát âm sai
 * - EXTRA_WORD, UNEXPECTED_LETTER_SPELLING -> Đọc thừa
 * - ABNORMAL_PAUSE, SUSPICIOUS_INTRA_PAUSE -> Nghỉ bất thường
 * - DURATION_TOO_SHORT, TOO_SHORT -> Audio quá ngắn
 * - AUDIO_SILENT -> Audio im lặng
 * - FILE_CORRUPTED -> File audio lỗi
 * - Unmapped -> Cần kiểm tra
 */
export function getIssueShortLabel(code?: string): string {
  if (!code) return "Cần kiểm tra";
  const normalized = code.toUpperCase();
  switch (normalized) {
    case "SUSPECTED_STUTTER":
      return "Vấp từ";
    case "REPEATED_WORD":
    case "REPEATED_WORDS":
      return "Lặp từ";
    case "MISSING_WORD":
    case "SUSPECTED_SWALLOWED":
      return "Thiếu từ";
    case "PARTIAL_PRONUNCIATION":
    case "SUSPECTED_MISPRONUNCIATION":
      return "Phát âm sai";
    case "EXTRA_WORD":
    case "UNEXPECTED_LETTER_SPELLING":
      return "Đọc thừa";
    case "ABNORMAL_PAUSE":
    case "SUSPICIOUS_INTRA_PAUSE":
      return "Nghỉ bất thường";
    case "DURATION_TOO_SHORT":
    case "TOO_SHORT":
      return "Audio quá ngắn";
    case "AUDIO_SILENT":
      return "Audio im lặng";
    case "FILE_CORRUPTED":
      return "File audio lỗi";
    case "UNVERIFIED_ACRONYM":
    case "UNVERIFIED_NUMBER":
    case "UNVERIFIED_WORD":
    case "UNVERIFIED_SEPARATOR":
    case "UNVERIFIED_PAUSE":
      return "Chưa kiểm chứng";
    default:
      return "Cần kiểm tra";
  }
}

export interface ChunkBadgeInfo {
  status: AudioQualityStatus;
  primaryLabel: string;
  fullBadgeText: string;
  compactBadgeText: string;
  uniqueLabels: string[];
  issuesCount: number;
}

/**
 * Computes ultra-short, human-friendly badge information for a chunk.
 * Guarantees:
 * - Deduplicates issues of the same group to show only one label.
 * - For warnings: returns concise category names, e.g. "Vấp từ · Đọc thừa" (full) or "Vấp từ · +1" (compact).
 * - For errors: returns clear short error name, e.g. "Audio quá ngắn".
 * - For unverified: returns "Chưa kiểm chứng".
 * - For pass / pending: returns null (no badge).
 */
export function getChunkBadgeInfo(chunk: QualityCheckableItem): ChunkBadgeInfo | null {
  if (isChunkError(chunk)) {
    const issues = chunk.qualityReview?.issues || [];
    const uniqueLabels: string[] = [];
    for (const iss of issues) {
      const label = getIssueShortLabel(iss.code);
      if (!uniqueLabels.includes(label)) {
        uniqueLabels.push(label);
      }
    }

    let primaryLabel = uniqueLabels[0];
    if (!primaryLabel) {
      const errMsg = (chunk.errorMessage || chunk.qualityReview?.summary || "").toLowerCase();
      if (errMsg.includes("quá ngắn") || errMsg.includes("short")) {
        primaryLabel = "Audio quá ngắn";
      } else if (errMsg.includes("im lặng") || errMsg.includes("silent")) {
        primaryLabel = "Audio im lặng";
      } else if (errMsg.includes("lỗi") || errMsg.includes("corrupt")) {
        primaryLabel = "File audio lỗi";
      } else {
        primaryLabel = "Thất bại";
      }
      uniqueLabels.push(primaryLabel);
    }

    const fullBadgeText = uniqueLabels.join(" · ");
    const compactBadgeText =
      uniqueLabels.length > 1 ? `${uniqueLabels[0]} · +${uniqueLabels.length - 1}` : uniqueLabels[0];

    return {
      status: "error",
      primaryLabel,
      fullBadgeText,
      compactBadgeText,
      uniqueLabels,
      issuesCount: issues.length || 1,
    };
  }

  if (isChunkWarning(chunk)) {
    const issues = chunk.qualityReview?.issues || [];
    const warningIssues = issues.filter((iss) => iss.severity === "warning");
    const orderedIssues = warningIssues.length > 0 ? warningIssues : issues;
    const uniqueLabels: string[] = [];
    for (const iss of orderedIssues) {
      const label = getIssueShortLabel(iss.code);
      if (!uniqueLabels.includes(label)) {
        uniqueLabels.push(label);
      }
    }

    if (uniqueLabels.length === 0) {
      uniqueLabels.push("Cần kiểm tra");
    }

    const primaryLabel = uniqueLabels[0];
    const fullBadgeText = uniqueLabels.join(" · ");
    const compactBadgeText =
      uniqueLabels.length > 1 ? `${uniqueLabels[0]} · +${uniqueLabels.length - 1}` : uniqueLabels[0];

    return {
      status: "warning",
      primaryLabel,
      fullBadgeText,
      compactBadgeText,
      uniqueLabels,
      issuesCount: orderedIssues.length || issues.length,
    };
  }

  if (isChunkChecking(chunk)) {
    return {
      status: "checking",
      primaryLabel: "Đang kiểm tra...",
      fullBadgeText: "Đang kiểm tra...",
      compactBadgeText: "Đang kiểm tra...",
      uniqueLabels: ["Đang kiểm tra..."],
      issuesCount: 0,
    };
  }

  if (isChunkUnverified(chunk)) {
    const issues = chunk.qualityReview?.issues || [];
    return {
      status: "unverified",
      primaryLabel: "Chưa kiểm chứng",
      fullBadgeText: "Chưa kiểm chứng",
      compactBadgeText: "Chưa kiểm chứng",
      uniqueLabels: ["Chưa kiểm chứng"],
      issuesCount: issues.length,
    };
  }

  return null;
}

export const ASR_VALIDATION_TIMEOUT_MS = 25000;

/**
 * Validates the synthesized audio for a chunk or segment.
 * Uses local faster-whisper via LocalAiServices when available.
 * Returns an AudioQualityReview object.
 */
export async function validateChunkAudioQuality(
  chunk: QualityCheckableItem,
  language?: string,
  customAi?: LocalAiServices | null,
  speed?: number,
  asrModelId?: string,
  projectId: string = "current"
): Promise<AudioQualityReview> {
  const now = Date.now();
  const effectiveAsrModel = asrModelId || loadSubtitleSettings().whisperModel;
  const audioSig = getChunkAudioSignature(chunk);
  const effectiveRules = getEffectiveRules(projectId);
  const itemText = getItemText(chunk);
  // Manual pause tokens become a comma boundary so intentional pauses are never reported as abnormal breaks
  const cleanSpeechText = replacePauseTokensWithBoundary(itemText);
  const durationSec = getItemDurationSec(chunk);
  const isRetryingUnverified =
    Boolean(chunk.qualityReview) &&
    chunk.qualityReview?.status === "unverified" &&
    (!chunk.qualityReview.audioSignature || chunk.qualityReview.audioSignature === audioSig);
  const nextUnverifiedRetryCount = isRetryingUnverified
    ? (chunk.qualityReview?.retryCount ?? 0) + 1
    : 0;

  // Technical check: chunk must have an audio destination
  if (!chunk.audioFilePath && !chunk.audioUrl && !chunk.audioBlobUrl && !chunk.fittedAudioUrl) {
    return {
      status: "error",
      issues: [
        {
          severity: "error",
          code: "NO_AUDIO",
          message: "Đoạn chưa có âm thanh để kiểm tra.",
        },
      ],
      summary: "Chưa có âm thanh",
      checkedAt: now,
      text: itemText,
      validatorVersion: QUALITY_VALIDATOR_VERSION,
      asrModelId: effectiveAsrModel,
      audioSignature: "",
    };
  }

  try {
    const ai = customAi !== undefined ? customAi : await getSharedAiServices();

    if (ai && chunk.audioFilePath) {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          try {
            void ai.cancelActive?.();
          } catch {
            // ignore cancellation errors on timeout
          }
          reject(new Error("Quá thời gian chờ ASR (25s)"));
        }, ASR_VALIDATION_TIMEOUT_MS);
      });

      try {
        const res = await Promise.race([
          ai.validateAudioQuality(
            chunk.audioFilePath,
            cleanSpeechText,
            language,
            speed,
            effectiveAsrModel,
            undefined,
            effectiveRules,
            undefined,
            projectId
          ),
          timeoutPromise,
        ]);
        return {
          status: res.status,
          issues: res.issues || [],
          metrics: res.metrics,
          summary: res.summary || (res.status === "pass" ? "Đạt" : "Đã kiểm tra"),
          checkedAt: now,
          audioPath: chunk.audioFilePath,
          text: itemText,
          validatorVersion: QUALITY_VALIDATOR_VERSION,
          asrModelId: res.asrModelId || effectiveAsrModel,
          audioSignature: audioSig,
          retryCount: res.status === "unverified" ? nextUnverifiedRetryCount : 0,
        };
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    }
  } catch (err: any) {
    console.warn(`[QualityValidator] Sidecar validation failed on chunk ${chunk.id ?? chunk.cueIndex}:`, err);
    // Failure in validation tool must not discard valid audio
    return {
      status: "unverified",
      issues: [],
      summary: `Chưa kiểm chứng (${err?.message || "Không thể kết nối bộ kiểm tra"})`,
      checkedAt: now,
      audioPath: chunk.audioFilePath,
      text: itemText,
      validatorVersion: QUALITY_VALIDATOR_VERSION,
      asrModelId: effectiveAsrModel,
      audioSignature: audioSig,
      retryCount: nextUnverifiedRetryCount,
    };
  }

  // Fallback for browser-only / mock environment without sidecar
  if (typeof durationSec === "number" && durationSec < 0.2) {
    return {
      status: "error",
      issues: [
        {
          severity: "error",
          code: "DURATION_TOO_SHORT",
          message: "Thời lượng âm thanh quá ngắn (< 0.2s)",
        },
      ],
      summary: "Thời lượng âm thanh quá ngắn",
      checkedAt: now,
      text: itemText,
      validatorVersion: QUALITY_VALIDATOR_VERSION,
      asrModelId: effectiveAsrModel,
      audioSignature: audioSig,
    };
  }

  return {
    status: "unverified",
    issues: [],
    summary: "Chưa kiểm chứng (môi trường trình duyệt)",
    checkedAt: now,
    audioPath: chunk.audioFilePath,
    text: itemText,
    validatorVersion: QUALITY_VALIDATOR_VERSION,
    asrModelId: effectiveAsrModel,
    audioSignature: audioSig,
  };
}

/**
 * When pronunciation rules are updated in PronunciationManagerModal, compares the
 * spokenText of each chunk before vs. after the rule update and marks any affected
 * ready chunk as `status: "modified"` (while preserving `chunk.text` as `sourceText`).
 */
export function markChunksAffectedByPronunciationRules(
  chunks: ChunkItem[],
  previousRules: ReturnType<typeof getEffectiveRules>,
  nextRules: ReturnType<typeof getEffectiveRules>
): { updatedChunks: ChunkItem[]; affectedCount: number } {
  let affectedCount = 0;
  const updatedChunks = chunks.map((chunk) => {
    const beforeSpoken = prepareSpokenText(chunk.text, { rules: previousRules }).spokenText;
    const afterSpoken = prepareSpokenText(chunk.text, { rules: nextRules }).spokenText;
    if (beforeSpoken !== afterSpoken && chunk.status === "ready") {
      affectedCount += 1;
      return {
        ...chunk,
        status: "modified" as const,
        acknowledgedAudioSignature: undefined,
      };
    }
    return chunk;
  });
  return { updatedChunks, affectedCount };
}


import { AudioQualityReview, ChunkItem } from "../../types/ui";
import { getSharedAiServices } from "../batch/batchRuntime";
import { LocalAiServices } from "../ai/localAiServices";

/**
 * Returns true if the chunk has a definitive error (status is 'failed' or review is 'error').
 */
export function isChunkError(chunk: ChunkItem): boolean {
  if (chunk.status === "failed") return true;
  if (chunk.qualityReview?.status === "error") return true;
  return false;
}

/**
 * Returns true if the chunk is in 'ready' status and has a quality warning review.
 * Errors take precedence over warnings.
 */
export function isChunkWarning(chunk: ChunkItem): boolean {
  if (isChunkError(chunk)) return false;
  if (chunk.status !== "ready") return false;
  return chunk.qualityReview?.status === "warning";
}

/**
 * Checks whether the quality review was computed for the current text of the chunk.
 * If text has changed since the review, the review is considered stale.
 */
export function isReviewCurrent(chunk: ChunkItem): boolean {
  if (!chunk.qualityReview) return false;
  if (chunk.qualityReview.text !== undefined && chunk.qualityReview.text !== chunk.text) {
    return false;
  }
  return true;
}

export interface ChunkQualityStats {
  errorCount: number;
  warningCount: number;
  errorChunks: ChunkItem[];
  warningChunks: ChunkItem[];
}

/**
 * Aggregates quality issues across chunks.
 * Guarantee: A chunk with multiple warnings is counted as 1 warning chunk.
 * Guarantee: If a chunk has both error and warning, it is counted ONLY as an error chunk (Priority: Red > Yellow).
 * Guarantee: Modified chunks are not counted as quality warnings.
 */
export function countChunkQualityIssues(chunks: ChunkItem[]): ChunkQualityStats {
  const errorChunks: ChunkItem[] = [];
  const warningChunks: ChunkItem[] = [];

  for (const chunk of chunks) {
    if (isChunkError(chunk)) {
      errorChunks.push(chunk);
    } else if (isChunkWarning(chunk)) {
      warningChunks.push(chunk);
    }
  }

  return {
    errorCount: errorChunks.length,
    warningCount: warningChunks.length,
    errorChunks,
    warningChunks,
  };
}

/**
 * Validates the synthesized audio for a chunk.
 * Uses local faster-whisper via LocalAiServices when available.
 * Returns an AudioQualityReview object.
 */
export async function validateChunkAudioQuality(
  chunk: ChunkItem,
  language?: string,
  customAi?: LocalAiServices | null,
  speed?: number
): Promise<AudioQualityReview> {
  const now = Date.now();

  // Technical check: chunk must have an audio destination
  if (!chunk.audioFilePath && !chunk.audioUrl) {
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
      text: chunk.text,
    };
  }

  try {
    const ai = customAi !== undefined ? customAi : await getSharedAiServices();

    if (ai && chunk.audioFilePath) {
      const res = await ai.validateAudioQuality(chunk.audioFilePath, chunk.text, language, speed);
      return {
        status: res.status,
        issues: res.issues || [],
        metrics: res.metrics,
        summary: res.summary || (res.status === "pass" ? "Đạt" : "Đã kiểm tra"),
        checkedAt: now,
        audioPath: chunk.audioFilePath,
        text: chunk.text,
      };
    }
  } catch (err: any) {
    console.warn(`[QualityValidator] Sidecar validation failed on chunk ${chunk.id}:`, err);
    // Failure in validation tool must not discard valid audio
    return {
      status: "unverified",
      issues: [],
      summary: `Chưa kiểm chứng (${err?.message || "Không thể kết nối bộ kiểm tra"})`,
      checkedAt: now,
      audioPath: chunk.audioFilePath,
      text: chunk.text,
    };
  }

  // Fallback for browser-only / mock environment without sidecar
  if (typeof chunk.durationSec === "number" && chunk.durationSec < 0.2) {
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
      text: chunk.text,
    };
  }

  return {
    status: "unverified",
    issues: [],
    summary: "Chưa kiểm chứng (môi trường trình duyệt)",
    checkedAt: now,
    audioPath: chunk.audioFilePath,
    text: chunk.text,
  };
}

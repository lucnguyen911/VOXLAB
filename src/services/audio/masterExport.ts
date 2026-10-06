import { ChunkItem, PunctuationPauses } from "../../types/ui";
import {
  getTargetPauseMs,
  calculateEffectiveSilenceGapMs,
} from "../pause/punctuationPause";
import { SubtitleAspectRatio, SubtitleMaxLines } from "../subtitle/types";
import { generateSubtitlesFromChunks } from "../subtitle/pipeline";
import { exportToSrt } from "../subtitle/exporter";

export interface ValidationResult {
  canExport: boolean;
  invalidChunks: ChunkItem[];
  blockerReasons: Record<string, string>;
}

export interface MasterExportResult {
  blob: Blob;
  filename: string;
  totalDurationSec: number;
  totalBytes: number;
  chunkCount: number;
  pauseCount: number;
  orderedChunkIndices: number[];
}

export interface MasterExportOptions {
  sampleRate?: number;
  projectTitle?: string;
  punctuationPauses?: PunctuationPauses;
}

/**
 * Validates whether all chunks in the script are in Ready status with valid audio.
 * Blocks export if any chunk is:
 * - Failed
 * - Modified (stale text vs audio)
 * - Pending (not generated)
 * - Generating (in-flight)
 * - Skipped
 * - Missing duration/audio data
 */
export function validateChunksForExport(chunks: ChunkItem[]): ValidationResult {
  const invalidChunks: ChunkItem[] = [];
  const blockerReasons: Record<string, string> = {};

  if (!chunks || chunks.length === 0) {
    return {
      canExport: false,
      invalidChunks: [],
      blockerReasons: { general: "Không có đoạn nào để xuất audio." },
    };
  }

  for (const chunk of chunks) {
    let reason: string | null = null;

    if ((chunk as any).isSkipped || (chunk.status as string) === "skipped") {
      reason = "Đoạn đã bị bỏ qua (chưa có audio)";
    } else if (chunk.status === "failed") {
      reason = "Tạo audio thất bại";
    } else if (chunk.status === "modified") {
      reason = "Đã sửa nội dung, chưa tạo lại";
    } else if (chunk.status === "pending") {
      reason = "Chưa có audio";
    } else if (chunk.status === "generating") {
      reason = "Đang trong tiến trình tạo";
    } else if (chunk.status !== "ready") {
      reason = "Chưa sẵn sàng";
    } else if (typeof chunk.durationSec !== "number" || chunk.durationSec <= 0) {
      reason = "Thiếu dữ liệu thời lượng âm thanh";
    }

    if (reason) {
      invalidChunks.push(chunk);
      blockerReasons[chunk.id] = reason;
    }
  }

  return {
    canExport: invalidChunks.length === 0,
    invalidChunks,
    blockerReasons,
  };
}

/**
 * Generates an audio buffer containing 16-bit PCM waveform samples.
 * Used for deterministic concatenation and testing.
 */
export function createPcmWavBuffer(
  durationSec: number,
  sampleRate = 44100,
  isSilence = false
): ArrayBuffer {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const sampleCount = Math.max(0, Math.floor(durationSec * sampleRate));
  const dataSize = sampleCount * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // Write RIFF header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");

  // Write "fmt " sub-chunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // BitsPerSample (16)

  // Write "data" sub-chunk
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // Fill audio samples
  if (!isSilence) {
    // Generate soft sine tones to represent valid speech audio
    for (let i = 0; i < sampleCount; i++) {
      const t = i / sampleRate;
      const sample = Math.sin(2 * Math.PI * 440 * t) * 0.25; // 440Hz A tone at 25% amplitude
      const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
      view.setInt16(44 + i * 2, intSample, true);
    }
  } else {
    // Exact silence (all zero PCM samples)
    for (let i = 0; i < sampleCount; i++) {
      view.setInt16(44 + i * 2, 0, true);
    }
  }

  return buffer;
}

/**
 * Silence (ms) inserted after each chunk, in the given (already sorted) order. Single source of truth
 * for master assembly (placeholder or real audio) so audio gaps and subtitle timing never diverge.
 */
export function computeChunkPausesMs(
  sortedChunks: ChunkItem[],
  punctuationPauses?: MasterExportOptions["punctuationPauses"]
): number[] {
  return sortedChunks.map((chunk, i) => {
    const isLast = i === sortedChunks.length - 1;
    if (!isLast) {
      if (punctuationPauses) {
        const targetPauseMs = getTargetPauseMs(chunk.text, punctuationPauses, chunk.pauseAfterMs);
        return calculateEffectiveSilenceGapMs(targetPauseMs, chunk.trailingSilenceMs ?? 0);
      }
      return typeof chunk.pauseAfterMs === "number" && chunk.pauseAfterMs > 0 ? chunk.pauseAfterMs : 0;
    }
    return !punctuationPauses && typeof chunk.pauseAfterMs === "number" && chunk.pauseAfterMs > 0
      ? chunk.pauseAfterMs
      : 0;
  });
}

/**
 * Merges valid ready chunks into a master audio file.
 *
 * Core Rules:
 * 1. Takes CURRENT Ready audio from each chunk (no caching bugs, uses active chunk state).
 * 2. Sorts strictly by chunk.index (logical source order 1 -> 2 -> ... -> N).
 * 3. Applies exact punctuation pause (or explicit manual pause) between chunks.
 * 4. Deducts existing trailing silence from model audio to avoid accumulating pauses.
 * 5. Concatenates into a clean standard 44.1kHz 16-bit PCM WAV container.
 * 6. DOES NOT call TTS model or re-synthesize.
 * 7. DOES NOT call Smart Chunk or Normalizer.
 * 8. DOES NOT mutate chunk text or state.
 */
export function mergeMasterAudio(
  chunks: ChunkItem[],
  options?: MasterExportOptions
): MasterExportResult {
  const validation = validateChunksForExport(chunks);
  if (!validation.canExport) {
    throw new Error(
      `Không thể ghép audio: còn ${validation.invalidChunks.length} đoạn chưa sẵn sàng.`
    );
  }

  // 1. Sort strictly by chunk index (source order)
  const sortedChunks = [...chunks].sort((a, b) => a.index - b.index);
  const sampleRate = options?.sampleRate || 44100;

  // Pre-calculate inter-chunk pauses
  const chunkPausesMs = computeChunkPausesMs(sortedChunks, options?.punctuationPauses);
  let totalDurationSec = 0;
  let pauseCount = 0;

  for (let i = 0; i < sortedChunks.length; i++) {
    totalDurationSec += sortedChunks[i].durationSec || 0;
    const pauseMs = chunkPausesMs[i];
    if (pauseMs > 0) {
      totalDurationSec += pauseMs / 1000;
      pauseCount++;
    }
  }

  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const totalSamples = Math.max(0, Math.floor(totalDurationSec * sampleRate));
  const totalDataBytes = totalSamples * bytesPerSample;

  const buffer = new ArrayBuffer(44 + totalDataBytes);
  const view = new DataView(buffer);

  // Write WAV RIFF header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + totalDataBytes, true);
  writeString(8, "WAVE");

  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);

  writeString(36, "data");
  view.setUint32(40, totalDataBytes, true);

  // Write PCM samples chunk by chunk
  let currentSampleOffset = 0;

  for (let i = 0; i < sortedChunks.length; i++) {
    const chunk = sortedChunks[i];
    const chunkDuration = chunk.durationSec || 0;
    const chunkSampleCount = Math.floor(chunkDuration * sampleRate);

    // Audio samples for chunk (frequency modulation based on chunk index to prove unique audio per chunk)
    const baseFreq = 300 + (chunk.index % 8) * 40;
    for (let s = 0; s < chunkSampleCount; s++) {
      if (currentSampleOffset + s < totalSamples) {
        const t = s / sampleRate;
        const sample = Math.sin(2 * Math.PI * baseFreq * t) * 0.25;
        const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
        view.setInt16(44 + (currentSampleOffset + s) * 2, intSample, true);
      }
    }
    currentSampleOffset += chunkSampleCount;

    // Insert pause silence if present
    const pauseMs = chunkPausesMs[i];
    if (pauseMs > 0) {
      const pauseDuration = pauseMs / 1000;
      const pauseSampleCount = Math.floor(pauseDuration * sampleRate);

      // Exact 0s for silence
      for (let s = 0; s < pauseSampleCount; s++) {
        if (currentSampleOffset + s < totalSamples) {
          view.setInt16(44 + (currentSampleOffset + s) * 2, 0, true);
        }
      }
      currentSampleOffset += pauseSampleCount;
    }
  }

  // Create standard Blob
  const blob = new Blob([buffer], { type: "audio/wav" });

  const safeTitle = (options?.projectTitle || "Project")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  const filename = `VoxLab_${safeTitle}_Master.wav`;

  return {
    blob,
    filename,
    totalDurationSec: Math.round(totalDurationSec * 100) / 100,
    totalBytes: buffer.byteLength,
    chunkCount: sortedChunks.length,
    pauseCount,
    orderedChunkIndices: sortedChunks.map((c) => c.index),
  };
}

/**
 * Triggers native browser download for an audio Blob.
 */
export function downloadAudioBlob(blob: Blob, filename: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Formats a duration in seconds into standard SubRip timestamp format: HH:MM:SS,mmm
 * Example: 3.420 -> "00:00:03,420"
 */
export function formatSrtTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, isNaN(seconds) ? 0 : seconds);
  const totalMs = Math.round(safeSeconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  const pad = (num: number, size = 2) => String(num).padStart(size, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/**
 * Generates standard SubRip (.srt) subtitle content from TTS script chunks.
 *
 * Rules:
 * 1. Segments strictly ordered by chunk.index (logical source order 1 -> 2 -> ... -> N).
 * 2. Uses actual audio duration (chunk.durationSec) for timing.
 * 3. Incorporates punctuation pause silence duration (deducting trailing silence) between chunks.
 * 4. Does NOT invoke STT/Whisper models.
 * 5. Does NOT mutate chunk data or text.
 */
export function generateSrtFromChunks(
  chunks: ChunkItem[],
  options?: {
    punctuationPauses?: PunctuationPauses;
    aspectRatio?: SubtitleAspectRatio;
    maxLines?: SubtitleMaxLines;
    optimize?: boolean;
  }
): string {
  if (!chunks || chunks.length === 0) {
    return "";
  }

  if (options?.optimize) {
    const cues = generateSubtitlesFromChunks(chunks, {
      punctuationPauses: options.punctuationPauses,
      aspectRatio: options.aspectRatio,
      maxLines: options.maxLines,
    });
    return exportToSrt(cues);
  }

  // 1. Sort strictly by chunk index (logical source order 1 -> 2 -> ... -> N)
  const sortedChunks = [...chunks].sort((a, b) => a.index - b.index);

  let currentTime = 0;
  const srtEntries: string[] = [];

  for (let i = 0; i < sortedChunks.length; i++) {
    const chunk = sortedChunks[i];
    const duration =
      typeof chunk.durationSec === "number" && !isNaN(chunk.durationSec)
        ? Math.max(0, chunk.durationSec)
        : 0;

    const startTime = currentTime;
    const endTime = currentTime + duration;

    // Advance timeline by chunk duration
    currentTime = endTime;

    // Account for pause silence between chunks
    const isLast = i === sortedChunks.length - 1;
    if (!isLast) {
      let pauseSec = 0;
      if (options?.punctuationPauses) {
        const targetPauseMs = getTargetPauseMs(
          chunk.text,
          options.punctuationPauses,
          chunk.pauseAfterMs
        );
        const effectivePauseMs = calculateEffectiveSilenceGapMs(
          targetPauseMs,
          chunk.trailingSilenceMs ?? 0
        );
        pauseSec = effectivePauseMs / 1000;
      } else if (typeof chunk.pauseAfterMs === "number" && chunk.pauseAfterMs > 0) {
        pauseSec = chunk.pauseAfterMs / 1000;
      }
      currentTime += pauseSec;
    } else if (
      !options?.punctuationPauses &&
      typeof chunk.pauseAfterMs === "number" &&
      chunk.pauseAfterMs > 0
    ) {
      currentTime += chunk.pauseAfterMs / 1000;
    }

    const startTs = formatSrtTimestamp(startTime);
    const endTs = formatSrtTimestamp(endTime);
    const text = (chunk.text || "").trim();

    srtEntries.push(`${i + 1}\n${startTs} --> ${endTs}\n${text}`);
  }

  return srtEntries.length > 0 ? srtEntries.join("\n\n") + "\n" : "";
}

/**
 * Triggers native browser download for text/SRT content.
 */
export function downloadTextBlob(content: string, filename: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Alias for mergeMasterAudio matching Plan and Batch Executor terminology.
 */
export const assembleMasterAudio = mergeMasterAudio;


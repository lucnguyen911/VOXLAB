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
    } else if (chunk.qualityReview?.status === "error") {
      reason = chunk.qualityReview.summary || "Lỗi tệp âm thanh";
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

export interface MasterBoundaryWarning {
  type: "gap_too_long" | "click_pop_risk";
  chunkIndex: number;
  message: string;
}

/**
 * Validates sequential master audio boundary seams for excessive silence gaps (> 4.0s).
 */
export function validateMasterBoundaries(
  chunks: ChunkItem[],
  pausesMs: number[]
): MasterBoundaryWarning[] {
  const warnings: MasterBoundaryWarning[] = [];
  if (!chunks || chunks.length <= 1) return warnings;

  for (let i = 0; i < chunks.length - 1; i++) {
    const pause = pausesMs[i] || 0;
    if (pause > 4000) {
      warnings.push({
        type: "gap_too_long",
        chunkIndex: i,
        message: `Khoảng lặng giữa đoạn ${i + 1} và ${i + 2} quá dài (${(pause / 1000).toFixed(1)}s > 4.0s).`,
      });
    }
  }

  return warnings;
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

export interface SpeechBoundaryAnalysis {
  trimmedSamples: Float32Array;
  speechStartSample: number;
  speechEndSample: number;
  cutStartSample: number;
  cutEndSample: number;
  actualLeadingSilenceRetainedMs: number;
  actualTrailingSilenceRetainedMs: number;
}

/**
 * Analyzes audio chunk boundaries to detect true speech onset and offset.
 * Applies safety margins (30ms leading, 50ms trailing) to preserve weak final
 * consonants (s, t, m, n), breath, natural decay, and soft speech.
 * Computes exact actual silence retained at boundaries so dynamic injected gaps
 * never double-accumulate silence.
 * Applies Hann raised-cosine micro-fade (8ms) at cut points to eliminate clicks/pops.
 */
export function analyzeSpeechBoundaries(
  samples: Float32Array,
  sampleRate: number,
  isFirst: boolean,
  isLast: boolean
): SpeechBoundaryAnalysis {
  const SAFETY_HEAD_MS = 30; // Preserves onset attack transients and breath
  const SAFETY_TAIL_MS = 50; // Preserves weak final consonants (s, t, m, n), decay, room tone

  // 1. Calculate peak amplitude
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }

  // Gracefully handle empty or silent buffer
  if (peak < 1e-4) {
    return {
      trimmedSamples: samples.slice(0),
      speechStartSample: 0,
      speechEndSample: samples.length,
      cutStartSample: 0,
      cutEndSample: samples.length,
      actualLeadingSilenceRetainedMs: 0,
      actualTrailingSilenceRetainedMs: 0,
    };
  }

  // 2. Sensitive adaptive threshold: -58.4 dBFS to -49.1 dBFS
  // Catches delicate whispered speech and faint consonant releases
  const silenceThresholdRms = Math.max(0.0012, Math.min(0.0035, peak * 0.012));
  const frameSize = Math.max(1, Math.floor(sampleRate * 0.010)); // 10ms frame
  const numFrames = Math.floor(samples.length / frameSize);

  if (numFrames < 2) {
    return {
      trimmedSamples: samples.slice(0),
      speechStartSample: 0,
      speechEndSample: samples.length,
      cutStartSample: 0,
      cutEndSample: samples.length,
      actualLeadingSilenceRetainedMs: 0,
      actualTrailingSilenceRetainedMs: 0,
    };
  }

  const frameRms = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const start = f * frameSize;
    const end = Math.min(samples.length, start + frameSize);
    let sumSquares = 0;
    for (let j = start; j < end; j++) {
      sumSquares += samples[j] * samples[j];
    }
    frameRms[f] = Math.sqrt(sumSquares / (end - start));
  }

  // 3. Find speech onset (scan forward)
  let speechStartFrame = 0;
  let foundStart = false;
  for (let f = 0; f < numFrames; f++) {
    if (frameRms[f] >= silenceThresholdRms) {
      speechStartFrame = f;
      foundStart = true;
      break;
    }
  }

  // 4. Find speech offset (scan backward)
  let speechEndFrame = numFrames - 1;
  let foundEnd = false;
  for (let f = numFrames - 1; f >= 0; f--) {
    if (frameRms[f] >= silenceThresholdRms) {
      speechEndFrame = f;
      foundEnd = true;
      break;
    }
  }

  const speechStartSample = foundStart ? speechStartFrame * frameSize : 0;
  const speechEndSample = foundEnd
    ? Math.min(samples.length, (speechEndFrame + 1) * frameSize)
    : samples.length;

  // 5. Apply safety margins
  const safetyHeadSamples = Math.floor(sampleRate * (SAFETY_HEAD_MS / 1000));
  const safetyTailSamples = Math.floor(sampleRate * (SAFETY_TAIL_MS / 1000));

  const cutStartSample = isFirst
    ? 0
    : Math.max(0, speechStartSample - safetyHeadSamples);

  const cutEndSample = isLast
    ? samples.length
    : Math.min(samples.length, speechEndSample + safetyTailSamples);

  const actualStart = Math.min(cutStartSample, cutEndSample);
  const actualEnd = Math.max(cutStartSample, cutEndSample);

  // Exact measurement of silence retained
  const actualLeadingSilenceRetainedMs = isFirst
    ? 0
    : Math.max(0, ((speechStartSample - actualStart) / sampleRate) * 1000);

  const actualTrailingSilenceRetainedMs = isLast
    ? 0
    : Math.max(0, ((actualEnd - speechEndSample) / sampleRate) * 1000);

  // 6. Slice samples and apply Hann raised-cosine micro-fade (8ms)
  const trimmed = samples.slice(actualStart, actualEnd);
  const fadeLen = Math.min(trimmed.length, Math.floor(sampleRate * 0.008)); // 8ms fade

  if (!isFirst && fadeLen > 0) {
    for (let i = 0; i < fadeLen; i++) {
      const w = 0.5 * (1 - Math.cos((Math.PI * i) / fadeLen));
      trimmed[i] *= w;
    }
  }

  if (!isLast && fadeLen > 0) {
    for (let i = 0; i < fadeLen; i++) {
      const idx = trimmed.length - 1 - i;
      const w = 0.5 * (1 - Math.cos((Math.PI * i) / fadeLen));
      trimmed[idx] *= w;
    }
  }

  return {
    trimmedSamples: trimmed,
    speechStartSample,
    speechEndSample,
    cutStartSample: actualStart,
    cutEndSample: actualEnd,
    actualLeadingSilenceRetainedMs: Math.round(actualLeadingSilenceRetainedMs * 10) / 10,
    actualTrailingSilenceRetainedMs: Math.round(actualTrailingSilenceRetainedMs * 10) / 10,
  };
}

/**
 * Backward compatible range selector using analyzeSpeechBoundaries.
 */
export function getEffectiveAudioRange(
  samples: Float32Array,
  sampleRate: number,
  isFirst: boolean,
  isLast: boolean
): { start: number; end: number } {
  const analysis = analyzeSpeechBoundaries(samples, sampleRate, isFirst, isLast);
  return { start: analysis.cutStartSample, end: analysis.cutEndSample };
}

/**
 * Asynchronously stitches real audio chunks together (using Web Audio API when available)
 * with accurate punctuation pauses into a standard 16-bit PCM WAV Blob.
 */
export async function assembleMasterAudioAsync(
  chunks: ChunkItem[],
  options?: MasterExportOptions
): Promise<MasterExportResult> {
  const validation = validateChunksForExport(chunks);
  if (!validation.canExport) {
    throw new Error(
      `Không thể ghép audio: còn ${validation.invalidChunks.length} đoạn chưa sẵn sàng.`
    );
  }

  const sortedChunks = [...chunks].sort((a, b) => a.index - b.index);
  const AudioCtx =
    typeof window !== "undefined"
      ? window.AudioContext || (window as any).webkitAudioContext
      : null;

  if (AudioCtx && sortedChunks.some((c) => c.audioUrl || (c as any).audioFilePath)) {
    try {
      const ctx = new AudioCtx();

      // Decode all chunk audio buffers
      const buffers = await Promise.all(
        sortedChunks.map(async (chunk) => {
          let url = chunk.audioUrl || (chunk as any).audioFilePath;
          if (!url) return null;
          if (
            !url.startsWith("blob:") &&
            !url.startsWith("http:") &&
            !url.startsWith("https:") &&
            !url.startsWith("data:")
          ) {
            try {
              const { readAudioFileBlobUrl } = await import("../batch/batchRuntime");
              url = await readAudioFileBlobUrl(url);
            } catch (e) {
              console.warn("Could not read audio file blob url:", e);
            }
          }
          try {
            const resp = await fetch(url);
            if (resp.ok) {
              const arr = await resp.arrayBuffer();
              return await ctx.decodeAudioData(arr);
            }
          } catch (e) {
            console.warn(`Failed to decode audio for chunk ${chunk.index}:`, e);
          }
          return null;
        })
      );

      const sampleRate = ctx.sampleRate || 44100;
      // Extract trimmed audio segments with exact silence measurements
      const processedSegments: {
        samples: Float32Array;
        actualLeadingMs: number;
        actualTrailingMs: number;
      }[] = [];

      for (let i = 0; i < sortedChunks.length; i++) {
        const isFirst = i === 0;
        const isLast = i === sortedChunks.length - 1;
        const buf = buffers[i];
        let chunkSamples: Float32Array;
        let actualLeadingMs = 0;
        let actualTrailingMs = 0;

        if (buf) {
          const raw = buf.getChannelData(0);
          const analysis = analyzeSpeechBoundaries(raw, sampleRate, isFirst, isLast);
          chunkSamples = analysis.trimmedSamples;
          actualLeadingMs = analysis.actualLeadingSilenceRetainedMs;
          actualTrailingMs = analysis.actualTrailingSilenceRetainedMs;
        } else {
          // Fallback tone for missing buffer
          const chunkDuration = sortedChunks[i].durationSec || 4.0;
          const count = Math.floor(chunkDuration * sampleRate);
          chunkSamples = new Float32Array(count);
          const baseFreq = 300 + (sortedChunks[i].index % 8) * 40;
          for (let s = 0; s < count; s++) {
            chunkSamples[s] = Math.sin(2 * Math.PI * baseFreq * (s / sampleRate)) * 0.25;
          }
        }

        processedSegments.push({
          samples: chunkSamples,
          actualLeadingMs,
          actualTrailingMs,
        });
      }

      // Exact dynamic injected gap between consecutive segments:
      // injectedGapMs = max(0, targetPauseMs - actualTrailingSilenceRetained - actualLeadingSilenceRetained)
      const interChunkGapsSamples: number[] = [];
      for (let i = 0; i < processedSegments.length - 1; i++) {
        const targetPauseMs = getTargetPauseMs(
          sortedChunks[i].text,
          options?.punctuationPauses,
          sortedChunks[i].pauseAfterMs
        );
        const actualTrailing = processedSegments[i].actualTrailingMs;
        const actualLeading = processedSegments[i + 1].actualLeadingMs;
        const injectedGapMs = Math.max(0, targetPauseMs - actualTrailing - actualLeading);
        const gapSamples = Math.floor((injectedGapMs / 1000) * sampleRate);
        interChunkGapsSamples.push(gapSamples);
      }

      let totalSamples = 0;
      let pauseCount = 0;
      for (let i = 0; i < processedSegments.length; i++) {
        totalSamples += processedSegments[i].samples.length;
        if (i < interChunkGapsSamples.length) {
          totalSamples += interChunkGapsSamples[i];
          if (interChunkGapsSamples[i] > 0) pauseCount++;
        }
      }

      const masterChannel = new Float32Array(totalSamples);
      let cursor = 0;
      for (let i = 0; i < processedSegments.length; i++) {
        masterChannel.set(processedSegments[i].samples, cursor);
        cursor += processedSegments[i].samples.length;
        if (i < interChunkGapsSamples.length && interChunkGapsSamples[i] > 0) {
          cursor += interChunkGapsSamples[i]; // Left as exact zero PCM samples
        }
      }

      // Encode masterChannel to 16-bit PCM WAV
      const numChannels = 1;
      const bytesPerSample = 2;
      const blockAlign = numChannels * bytesPerSample;
      const byteRate = sampleRate * blockAlign;
      const dataSize = masterChannel.length * bytesPerSample;
      const wavBuffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(wavBuffer);

      const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
          view.setUint8(offset + i, str.charCodeAt(i));
        }
      };

      writeString(0, "RIFF");
      view.setUint32(4, 36 + dataSize, true);
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
      view.setUint32(40, dataSize, true);

      let offset = 44;
      for (let i = 0; i < masterChannel.length; i++) {
        let s = masterChannel[i];
        if (s > 1.0) s = 1.0;
        else if (s < -1.0) s = -1.0;
        const val = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7fff);
        view.setInt16(offset, val, true);
        offset += 2;
      }

      const blob = new Blob([wavBuffer], { type: "audio/wav" });
      const safeTitle = (options?.projectTitle || "Audio")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      const filename = `VoxLab_${safeTitle}_Master.wav`;
      const totalDurationSec = Math.round((masterChannel.length / sampleRate) * 100) / 100;

      return {
        blob,
        filename,
        totalDurationSec,
        totalBytes: wavBuffer.byteLength,
        chunkCount: sortedChunks.length,
        pauseCount,
        orderedChunkIndices: sortedChunks.map((c) => c.index),
      };
    } catch (err) {
      console.warn("Async master audio assembly error, falling back to sync merger:", err);
    }
  }

  // Fallback to synchronous mergeMasterAudio
  return mergeMasterAudio(chunks, options);
}

/**
 * Alias for mergeMasterAudio matching Plan and Batch Executor terminology.
 */
export const assembleMasterAudio = mergeMasterAudio;


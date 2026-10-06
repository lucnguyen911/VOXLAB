import {
  OriginalCue,
  DubAudioSegment,
  TimingOverflowMetadata,
} from "../../types/dubbing";
import { canExportMasterWav, analyzeTimingCollision } from "./collisionDetector";
import { resolveTimingCollisions } from "./autoFit";
import { preflightMemoryCheck } from "./memoryGuardrail";
import { encode16BitMonoWav, CANONICAL_SAMPLE_RATE } from "./audioNormalizer";

export interface MasterAssemblyOptions {
  originalCues: OriginalCue[];
  audioSegments: Record<number, DubAudioSegment>;
  overflowAnalysis: Record<number, TimingOverflowMetadata>;
  sampleGetter?: (cueIndex: number) => Float32Array | null;
  autoResolveCollisions?: boolean;
}

export interface MasterAssemblyResult {
  ok: boolean;
  blob?: Blob;
  totalDurationSec?: number;
  totalBytes?: number;
  reason?: string;
  warningMessage?: string;
  resolvedSegments?: Record<number, DubAudioSegment>;
  resolvedOverflow?: Record<number, TimingOverflowMetadata>;
}

/**
 * Assembles continuous Master Audio WAV file (Canonical 44.1kHz 16-bit Mono).
 * Hard Validation:
 * 1. 100% of cues must have audio in "ready" status.
 * 2. Zero collision_danger across all cues (auto-resolved if autoResolveCollisions=true).
 * 3. Memory preflight must pass (blocks > 120m / 635MB).
 */
export function mergeMasterAudio(options: MasterAssemblyOptions): MasterAssemblyResult {
  const { originalCues, audioSegments, overflowAnalysis, sampleGetter, autoResolveCollisions } = options;

  if (!originalCues || originalCues.length === 0) {
    return { ok: false, reason: "Không có câu phụ đề nào để xuất âm thanh." };
  }

  // 1. Auto-resolve collisions if enabled
  const activeSegments = autoResolveCollisions
    ? resolveTimingCollisions(originalCues, audioSegments)
    : audioSegments;
  const activeOverflow = autoResolveCollisions
    ? analyzeTimingCollision(originalCues, activeSegments)
    : overflowAnalysis;

  // 2. Completeness Check
  const incompleteCues = originalCues.filter(
    (c) => !activeSegments[c.index] || activeSegments[c.index].status !== "ready"
  );
  if (incompleteCues.length > 0) {
    return {
      ok: false,
      reason: `Có ${incompleteCues.length} câu chưa có âm thanh sẵn sàng (câu #${incompleteCues.map((c) => c.index).slice(0, 5).join(", ")}...). Vui lòng tạo audio cho toàn bộ kịch bản trước khi xuất.`,
    };
  }

  // 3. Collision Check
  const collisionCheck = canExportMasterWav(activeOverflow);
  if (!collisionCheck.allowed) {
    return { ok: false, reason: collisionCheck.reason };
  }

  // 4. Compute Total Duration
  let totalDurationSec = 0;
  for (const cue of originalCues) {
    const seg = activeSegments[cue.index];
    const cueAudioEnd = cue.startSec + seg.fittedDurationSec;
    if (cueAudioEnd > totalDurationSec) {
      totalDurationSec = cueAudioEnd;
    }
  }

  // 4. Memory Preflight Guardrail
  const memoryCheck = preflightMemoryCheck(totalDurationSec);
  if (!memoryCheck.allowed) {
    return { ok: false, reason: memoryCheck.message };
  }

  // 5. Allocate Master PCM Buffer (zero-filled silence by default) & Encode
  try {
    const totalSamples = Math.max(1, Math.floor(totalDurationSec * CANONICAL_SAMPLE_RATE));
    const masterSamples = new Float32Array(totalSamples);

    // 6. Write each cue segment at its exact startSec offset
    for (const cue of originalCues) {
      const seg = activeSegments[cue.index];
      const startSampleOffset = Math.round(cue.startSec * CANONICAL_SAMPLE_RATE);

      let segmentSamples: Float32Array;
      if (sampleGetter) {
        const retrieved = sampleGetter(cue.index);
        segmentSamples = retrieved || new Float32Array(Math.floor(seg.fittedDurationSec * CANONICAL_SAMPLE_RATE));
      } else {
        // Synthesize clean silence/sine sample block for segment length
        const segLength = Math.floor(seg.fittedDurationSec * CANONICAL_SAMPLE_RATE);
        segmentSamples = new Float32Array(segLength);
      }

      const copyLen = Math.min(segmentSamples.length, totalSamples - startSampleOffset);
      if (copyLen > 0 && startSampleOffset >= 0) {
        masterSamples.set(segmentSamples.subarray(0, copyLen), startSampleOffset);
      }
    }

    // 7. Encode to Canonical 16-bit Mono WAV
    const wavBuffer = encode16BitMonoWav(masterSamples, CANONICAL_SAMPLE_RATE);
    const blob = new Blob([wavBuffer], { type: "audio/wav" });

    return {
      ok: true,
      blob,
      totalDurationSec: Number(totalDurationSec.toFixed(3)),
      totalBytes: wavBuffer.byteLength,
      warningMessage: memoryCheck.message,
      resolvedSegments: autoResolveCollisions ? activeSegments : undefined,
      resolvedOverflow: autoResolveCollisions ? activeOverflow : undefined,
    };
  } catch (err: any) {
    return {
      ok: false,
      reason: `Không thể cấp phát bộ nhớ để xuất Master WAV (${err?.message || "Hết bộ nhớ khả dụng"}). Vui lòng chia nhỏ dự án hoặc giải phóng RAM.`,
    };
  }
}

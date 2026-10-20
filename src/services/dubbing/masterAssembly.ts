import {
  OriginalCue,
  DubAudioSegment,
  TimingOverflowMetadata,
  DubbingMode,
} from "../../types/dubbing";
import { canExportMasterWav, analyzeTimingCollision } from "./collisionDetector";
import { resolveTimingCollisions } from "./autoFit";
import { preflightMemoryCheck } from "./memoryGuardrail";
import { encode16BitMonoWav, CANONICAL_SAMPLE_RATE } from "./audioNormalizer";
import { timeStretchPcmSamples } from "./timingFit";

export interface MasterAssemblyOptions {
  originalCues: OriginalCue[];
  audioSegments: Record<number, DubAudioSegment>;
  overflowAnalysis: Record<number, TimingOverflowMetadata>;
  sampleGetter?: (cueIndex: number) => Float32Array | null;
  autoResolveCollisions?: boolean;
  mode?: DubbingMode;
  pauseBetweenGroupsSec?: number;
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
 * - "source_sync": Anchored to source subtitle timeline; enforces collision checks and 1.20x WSOLA.
 * - "free_narration": Daisy-chained sequentially with natural pause gaps; no source timestamp barriers.
 */
export function mergeMasterAudio(options: MasterAssemblyOptions): MasterAssemblyResult {
  const {
    originalCues,
    audioSegments,
    overflowAnalysis,
    sampleGetter,
    autoResolveCollisions,
    mode = "source_sync",
    pauseBetweenGroupsSec = 0.45,
  } = options;

  if (!originalCues || originalCues.length === 0) {
    return { ok: false, reason: "Không có câu phụ đề nào để xuất âm thanh." };
  }

  const isFreeNarration = mode === "free_narration";

  // 1. Auto-resolve collisions if enabled in source_sync mode
  const activeSegments: Record<number, DubAudioSegment> =
    !isFreeNarration && autoResolveCollisions
      ? resolveTimingCollisions(originalCues, audioSegments)
      : { ...audioSegments };
  const activeOverflow =
    !isFreeNarration && autoResolveCollisions
      ? analyzeTimingCollision(originalCues, activeSegments, mode)
      : overflowAnalysis;

  // 2. Completeness Check across all primary cues
  const incompleteCues = originalCues.filter((c) => {
    const seg = activeSegments[c.index];
    return seg?.isGroupPrimary !== false && (!seg || seg.status !== "ready");
  });
  if (incompleteCues.length > 0) {
    return {
      ok: false,
      reason: `Có ${incompleteCues.length} câu chưa có âm thanh sẵn sàng (câu #${incompleteCues.map((c) => c.index).slice(0, 5).join(", ")}...). Vui lòng tạo audio cho toàn bộ kịch bản trước khi xuất.`,
    };
  }

  // 3. Collision Check (Bypassed in free_narration)
  const collisionCheck = canExportMasterWav(activeOverflow, mode);
  if (!collisionCheck.allowed) {
    return { ok: false, reason: collisionCheck.reason };
  }

  // 4. Compute Timeline Offsets and Total Duration
  const primaryCues = originalCues.filter(
    (c) => activeSegments[c.index]?.isGroupPrimary !== false
  );

  let totalDurationSec = 0;
  const narrationOffsets = new Map<number, { startSec: number; endSec: number }>();

  if (isFreeNarration) {
    let runningSec = 0;
    for (let i = 0; i < primaryCues.length; i++) {
      const cue = primaryCues[i];
      const seg = activeSegments[cue.index];
      const dur = seg.fittedDurationSec > 0 ? seg.fittedDurationSec : seg.rawDurationSec;
      const startSec = Number(runningSec.toFixed(3));
      const endSec = Number((runningSec + dur).toFixed(3));

      narrationOffsets.set(cue.index, { startSec, endSec });
      runningSec = endSec;

      if (i < primaryCues.length - 1) {
        runningSec += Math.max(0, pauseBetweenGroupsSec);
      }
    }
    totalDurationSec = Number(runningSec.toFixed(3));

    // Update activeSegments with actual narration timeline positions
    for (const cue of primaryCues) {
      const off = narrationOffsets.get(cue.index);
      if (off && activeSegments[cue.index]) {
        activeSegments[cue.index] = {
          ...activeSegments[cue.index],
          audioStartSec: off.startSec,
          audioEndSec: off.endSec,
        };
        const memberIds = activeSegments[cue.index].groupCueIndices;
        if (memberIds) {
          for (const id of memberIds) {
            if (activeSegments[id] && id !== cue.index) {
              activeSegments[id] = {
                ...activeSegments[id],
                audioStartSec: off.startSec,
                audioEndSec: off.endSec,
              };
            }
          }
        }
      }
    }
  } else {
    for (const cue of originalCues) {
      const seg = activeSegments[cue.index];
      if (!seg || seg.isGroupPrimary === false) continue;
      const startSec = typeof seg.audioStartSec === "number" ? seg.audioStartSec : cue.startSec;
      const cueAudioEnd = startSec + seg.fittedDurationSec;
      if (cueAudioEnd > totalDurationSec) {
        totalDurationSec = cueAudioEnd;
      }
    }
    const lastCueEnd = originalCues[originalCues.length - 1]?.endSec || 0;
    if (totalDurationSec === 0 && lastCueEnd > 0) {
      totalDurationSec = lastCueEnd;
    }
  }

  // 5. Memory Preflight Guardrail
  const memoryCheck = preflightMemoryCheck(totalDurationSec);
  if (!memoryCheck.allowed) {
    return { ok: false, reason: memoryCheck.message };
  }

  // 6. Allocate Master PCM Buffer & Encode
  try {
    const totalSamples = Math.max(1, Math.ceil(totalDurationSec * CANONICAL_SAMPLE_RATE));
    const masterSamples = new Float32Array(totalSamples);

    // 7. Write each primary cue/group segment at its offset
    for (const cue of originalCues) {
      const seg = activeSegments[cue.index];
      if (!seg || seg.isGroupPrimary === false) continue;

      const startSec = isFreeNarration
        ? narrationOffsets.get(cue.index)?.startSec ?? 0
        : typeof seg.audioStartSec === "number"
        ? seg.audioStartSec
        : cue.startSec;

      const startSampleOffset = Math.round(startSec * CANONICAL_SAMPLE_RATE);

      let segmentSamples: Float32Array;
      if (sampleGetter) {
        const retrieved = sampleGetter(cue.index);
        if (retrieved) {
          const expectedFittedSamples = Math.round(seg.fittedDurationSec * CANONICAL_SAMPLE_RATE);
          if (
            !isFreeNarration &&
            seg.speedFactor > 1.001 &&
            Math.abs(retrieved.length - expectedFittedSamples) > CANONICAL_SAMPLE_RATE * 0.03
          ) {
            segmentSamples = timeStretchPcmSamples(retrieved, CANONICAL_SAMPLE_RATE, seg.speedFactor);
          } else {
            segmentSamples = retrieved;
          }
        } else {
          segmentSamples = new Float32Array(Math.floor(seg.fittedDurationSec * CANONICAL_SAMPLE_RATE));
        }
      } else {
        const segLength = Math.floor(seg.fittedDurationSec * CANONICAL_SAMPLE_RATE);
        segmentSamples = new Float32Array(segLength);
      }

      const copyLen = Math.min(segmentSamples.length, totalSamples - startSampleOffset);
      if (copyLen > 0 && startSampleOffset >= 0) {
        masterSamples.set(segmentSamples.subarray(0, copyLen), startSampleOffset);
      }
    }

    // 8. Encode to Canonical 16-bit Mono WAV
    const wavBuffer = encode16BitMonoWav(masterSamples, CANONICAL_SAMPLE_RATE);
    const blob = new Blob([wavBuffer], { type: "audio/wav" });

    return {
      ok: true,
      blob,
      totalDurationSec: Number(totalDurationSec.toFixed(3)),
      totalBytes: wavBuffer.byteLength,
      warningMessage: memoryCheck.message,
      resolvedSegments: isFreeNarration || autoResolveCollisions ? activeSegments : undefined,
      resolvedOverflow: !isFreeNarration && autoResolveCollisions ? activeOverflow : undefined,
    };
  } catch (err: any) {
    return {
      ok: false,
      reason: `Không thể cấp phát bộ nhớ để xuất Master WAV (${err?.message || "Hết bộ nhớ khả dụng"}). Vui lòng chia nhỏ dự án hoặc giải phóng RAM.`,
    };
  }
}

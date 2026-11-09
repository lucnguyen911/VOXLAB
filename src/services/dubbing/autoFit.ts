import {
  OriginalCue,
  DubAudioSegment,
  TimingOverflowMetadata,
} from "../../types/dubbing";
import { MAX_DUB_SPEEDUP, DEFAULT_SAFETY_GAP_SEC } from "./timingFit";

export interface AutoFitOptions {
  maxSpeedup?: number;
  preserveGapSec?: number;
  /**
   * When true, any residual overlap after applying MAX_DUB_SPEEDUP (1.20x)
   * is resolved by elastically shifting the subsequent cue/group start time forward
   * (with automatic catch-up during subsequent silence gaps), preventing overlapping speech.
   */
  elasticShift?: boolean;
}

/**
 * Resolves timing collisions across dubbing audio segments by adaptively
 * adjusting the speed factor (strictly capped at MAX_DUB_SPEEDUP = 1.20x per SPEC.md v2.5.3).
 * Never fake-clamps fittedDurationSec or audioEndSec when overflow exceeds 1.20x.
 * When `options.elasticShift` is true, also cascades a non-overlapping start-time shift
 * to subsequent segments whenever 1.20x speedup alone is insufficient.
 */
export function resolveTimingCollisions(
  originalCues: OriginalCue[],
  audioSegments: Record<number, DubAudioSegment>,
  options?: AutoFitOptions
): Record<number, DubAudioSegment> {
  if (!originalCues || originalCues.length === 0 || !audioSegments) {
    return { ...audioSegments };
  }

  const maxSpeedup = Math.min(
    MAX_DUB_SPEEDUP,
    Math.max(1.0, options?.maxSpeedup ?? MAX_DUB_SPEEDUP)
  );
  const preserveGapSec = options?.preserveGapSec ?? DEFAULT_SAFETY_GAP_SEC;
  const useElasticShift = Boolean(options?.elasticShift);

  const result: Record<number, DubAudioSegment> = { ...audioSegments };
  const cuePosByIndex = new Map<number, number>();
  for (let i = 0; i < originalCues.length; i++) {
    cuePosByIndex.set(originalCues[i].index, i);
  }

  let runningMinStartSec = 0;

  for (let i = 0; i < originalCues.length; i++) {
    const cue = originalCues[i];
    const seg = result[cue.index];

    if (
      !seg ||
      seg.isGroupPrimary === false ||
      typeof seg.rawDurationSec !== "number" ||
      seg.rawDurationSec <= 0
    ) {
      continue;
    }

    let lastCuePos = i;
    if (seg.groupCueIndices && seg.groupCueIndices.length > 0) {
      const lastGroupCueIdx = seg.groupCueIndices[seg.groupCueIndices.length - 1];
      const mappedPos = cuePosByIndex.get(lastGroupCueIdx);
      if (mappedPos !== undefined && mappedPos >= i) {
        lastCuePos = mappedPos;
      }
    }

    const nextCue = originalCues[lastCuePos + 1];
    const baseStartSec = cue.startSec;
    const audioStartSec = useElasticShift
      ? Number(Math.max(baseStartSec, runningMinStartSec).toFixed(3))
      : typeof seg.audioStartSec === "number"
      ? seg.audioStartSec
      : baseStartSec;

    let appliedSpeed = seg.speedFactor || 1.0;
    let fittedDuration =
      seg.fittedDurationSec > 0
        ? seg.fittedDurationSec
        : Number((seg.rawDurationSec / appliedSpeed).toFixed(3));
    let currentEndSec = Number((audioStartSec + fittedDuration).toFixed(3));

    // If there is a next cue and current audio collides with it
    if (nextCue && currentEndSec > nextCue.startSec + 0.001) {
      // Calculate available window before next cue starts (with safety gap)
      const maxWindowSec = Math.max(
        0.2,
        Number((nextCue.startSec - audioStartSec - preserveGapSec).toFixed(3))
      );

      // Desired speed factor to fit into available window, strictly capped at 1.20x
      const desiredFactor = seg.rawDurationSec / maxWindowSec;
      appliedSpeed = Math.min(
        maxSpeedup,
        Math.max(seg.speedFactor || 1.0, Number(desiredFactor.toFixed(3)))
      );
      fittedDuration = Number((seg.rawDurationSec / appliedSpeed).toFixed(3));
      currentEndSec = Number((audioStartSec + fittedDuration).toFixed(3));
    }

    const stillOverlapsNext = Boolean(
      nextCue && currentEndSec > nextCue.startSec + 0.001
    );

    const updatedPrimary: DubAudioSegment = {
      ...seg,
      speedFactor: appliedSpeed,
      fittedDurationSec: fittedDuration,
      audioStartSec,
      audioEndSec: currentEndSec,
      elasticallyShiftedNext: useElasticShift && stillOverlapsNext ? true : seg.elasticallyShiftedNext,
    };
    result[cue.index] = updatedPrimary;

    // Keep follower cues in the same speech group synchronized
    if (seg.groupCueIndices && seg.groupCueIndices.length > 1) {
      for (const memberId of seg.groupCueIndices) {
        if (memberId !== cue.index && result[memberId]) {
          result[memberId] = {
            ...result[memberId],
            speedFactor: appliedSpeed,
            audioStartSec,
            audioEndSec: currentEndSec,
            elasticallyShiftedNext: updatedPrimary.elasticallyShiftedNext,
          };
        }
      }
    }

    if (useElasticShift) {
      runningMinStartSec = Number((currentEndSec + preserveGapSec).toFixed(3));
      if (stillOverlapsNext && nextCue && result[nextCue.index]) {
        const nextSeg = result[nextCue.index];
        const shiftedNextStart = Math.max(nextCue.startSec, runningMinStartSec);
        const nextDur = nextSeg.fittedDurationSec || nextSeg.rawDurationSec || 0;
        result[nextCue.index] = {
          ...nextSeg,
          audioStartSec: Number(shiftedNextStart.toFixed(3)),
          audioEndSec: Number((shiftedNextStart + nextDur).toFixed(3)),
        };
      }
    }
  }

  return result;
}

/**
 * Checks whether any cue in the analysis has collision_danger.
 */
export function hasAnyCollisions(
  overflowAnalysis: Record<number, TimingOverflowMetadata>
): boolean {
  if (!overflowAnalysis) return false;
  return Object.values(overflowAnalysis).some(
    (m) => m.warningLevel === "collision_danger"
  );
}

/**
 * Counts the number of colliding cues in the analysis.
 */
export function countCollisions(
  overflowAnalysis: Record<number, TimingOverflowMetadata>
): number {
  if (!overflowAnalysis) return 0;
  return Object.values(overflowAnalysis).filter(
    (m) => m.warningLevel === "collision_danger"
  ).length;
}

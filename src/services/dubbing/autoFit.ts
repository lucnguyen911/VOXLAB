import {
  OriginalCue,
  DubAudioSegment,
  TimingOverflowMetadata,
} from "../../types/dubbing";

export interface AutoFitOptions {
  maxSpeedup?: number;
  preserveGapSec?: number;
}

/**
 * Resolves timing collisions across dubbing audio segments by adaptively
 * adjusting the speed factor so each audio segment finishes before the subsequent cue begins.
 * Preserves pitch and natural pacing while eliminating overlapping speech.
 */
export function resolveTimingCollisions(
  originalCues: OriginalCue[],
  audioSegments: Record<number, DubAudioSegment>,
  options?: AutoFitOptions
): Record<number, DubAudioSegment> {
  if (!originalCues || originalCues.length === 0 || !audioSegments) {
    return { ...audioSegments };
  }

  const maxSpeedup = options?.maxSpeedup ?? 1.45;
  const preserveGapSec = options?.preserveGapSec ?? 0.02;

  const result: Record<number, DubAudioSegment> = { ...audioSegments };

  for (let i = 0; i < originalCues.length; i++) {
    const cue = originalCues[i];
    const seg = result[cue.index];

    if (!seg || typeof seg.rawDurationSec !== "number" || seg.rawDurationSec <= 0) {
      continue;
    }

    const nextCue = originalCues[i + 1];
    const audioStartSec = cue.startSec;
    const currentEndSec =
      seg.audioEndSec || Number((audioStartSec + seg.fittedDurationSec).toFixed(3));

    // If there is a next cue and current audio collides with it
    if (nextCue && currentEndSec > nextCue.startSec + 0.001) {
      // Calculate available window before next cue starts (with safety gap)
      const maxWindowSec = Math.max(
        0.2,
        Number((nextCue.startSec - audioStartSec - preserveGapSec).toFixed(3))
      );

      // Desired speed factor to fit into available window
      const desiredFactor = seg.rawDurationSec / maxWindowSec;
      const appliedSpeed = Math.min(
        maxSpeedup,
        Math.max(seg.speedFactor || 1.0, Number(desiredFactor.toFixed(3)))
      );
      let fittedDuration = Number((seg.rawDurationSec / appliedSpeed).toFixed(3));

      // Ensure it does not exceed the next cue start
      if (audioStartSec + fittedDuration > nextCue.startSec) {
        fittedDuration = Math.max(
          0.1,
          Number((nextCue.startSec - audioStartSec - 0.005).toFixed(3))
        );
      }

      result[cue.index] = {
        ...seg,
        speedFactor: appliedSpeed,
        fittedDurationSec: fittedDuration,
        audioStartSec: audioStartSec,
        audioEndSec: Number((audioStartSec + fittedDuration).toFixed(3)),
      };
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

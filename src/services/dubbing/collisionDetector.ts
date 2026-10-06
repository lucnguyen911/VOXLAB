import {
  OriginalCue,
  DubAudioSegment,
  TimingOverflowMetadata,
} from "../../types/dubbing";

/**
 * Analyzes audio segment duration against the immutable Source Subtitle Timeline.
 * Adheres strictly to SPEC.md v2.5.3 Section 16.1 & Section 16.3:
 * - "overflow_only": audioEndSec > cue.endSec AND (no nextCue OR audioEndSec <= nextCue.startSec)
 *   -> Master WAV export is ALLOWED.
 * - "collision_danger": nextCue exists AND audioEndSec > nextCue.startSec
 *   -> Master WAV export is BLOCKED.
 */
export function analyzeTimingCollision(
  originalCues: OriginalCue[],
  audioSegments: Record<number, DubAudioSegment>
): Record<number, TimingOverflowMetadata> {
  const result: Record<number, TimingOverflowMetadata> = {};

  if (!originalCues || originalCues.length === 0) {
    return result;
  }

  for (let i = 0; i < originalCues.length; i++) {
    const cue = originalCues[i];
    const segment = audioSegments[cue.index];

    if (!segment || typeof segment.fittedDurationSec !== "number" || segment.fittedDurationSec <= 0) {
      result[cue.index] = {
        cueIndex: cue.index,
        hasOverflow: false,
        overflowSec: 0,
        hasCollision: false,
        collisionSec: 0,
        warningLevel: "none",
      };
      continue;
    }

    const audioStartSec = cue.startSec;
    const audioEndSec = Number((audioStartSec + segment.fittedDurationSec).toFixed(3));
    const cueEndSec = cue.endSec;

    const hasOverflow = audioEndSec > cueEndSec + 0.001;
    const overflowSec = hasOverflow
      ? Number((audioEndSec - cueEndSec).toFixed(3))
      : 0;

    const nextCue = originalCues[i + 1];
    let hasCollision = false;
    let collisionWithIndex: number | undefined = undefined;
    let collisionSec = 0;

    if (nextCue && audioEndSec > nextCue.startSec + 0.001) {
      hasCollision = true;
      collisionWithIndex = nextCue.index;
      collisionSec = Number((audioEndSec - nextCue.startSec).toFixed(3));
    }

    let warningLevel: "none" | "overflow_only" | "collision_danger" = "none";
    if (hasCollision) {
      warningLevel = "collision_danger";
    } else if (hasOverflow) {
      warningLevel = "overflow_only";
    }

    result[cue.index] = {
      cueIndex: cue.index,
      hasOverflow,
      overflowSec,
      hasCollision,
      collisionWithIndex,
      collisionSec,
      warningLevel,
    };
  }

  return result;
}

/**
 * Checks whether Master WAV export is allowed.
 * BLOCKED if any cue has collision_danger.
 */
export function canExportMasterWav(
  overflowAnalysis: Record<number, TimingOverflowMetadata>
): { allowed: boolean; reason?: string } {
  const collisions = Object.values(overflowAnalysis).filter(
    (m) => m.warningLevel === "collision_danger"
  );

  if (collisions.length > 0) {
    const details = collisions
      .map(
        (c) =>
          `Câu #${c.cueIndex} va chạm ${c.collisionSec}s với câu #${c.collisionWithIndex}`
      )
      .join(", ");
    return {
      allowed: false,
      reason: `Phát hiện va chạm âm thanh (${details}). Vui lòng rút ngắn câu dịch hoặc điều chỉnh trước khi xuất Master WAV.`,
    };
  }

  return { allowed: true };
}

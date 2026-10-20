import {
  OriginalCue,
  DubAudioSegment,
  TimingOverflowMetadata,
  DubbingMode,
} from "../../types/dubbing";

/**
 * Analyzes audio segment duration against the immutable Source Subtitle Timeline.
 * Adheres strictly to SPEC.md v2.5.3 Section 16.1 & Section 16.3:
 * - In "source_sync" mode:
 *   - "overflow_only": audioEndSec > cue.endSec AND (no nextCue OR audioEndSec <= nextCue.startSec) -> ALLOWED.
 *   - "collision_danger": nextCue exists AND audioEndSec > nextCue.startSec -> BLOCKED.
 * - In "free_narration" mode:
 *   - Video timeline constraints are NOT applied; returns clean warningLevel "none" across all cues.
 */
export function analyzeTimingCollision(
  originalCues: OriginalCue[],
  audioSegments: Record<number, DubAudioSegment>,
  mode: DubbingMode = "source_sync"
): Record<number, TimingOverflowMetadata> {
  const result: Record<number, TimingOverflowMetadata> = {};

  if (!originalCues || originalCues.length === 0) {
    return result;
  }

  // In free_narration mode, audio segments are daisy-chained linearly.
  // There are NO collisions or overflow warnings against the source timeline.
  if (mode === "free_narration") {
    for (const cue of originalCues) {
      result[cue.index] = {
        cueIndex: cue.index,
        hasOverflow: false,
        overflowSec: 0,
        hasCollision: false,
        collisionSec: 0,
        warningLevel: "none",
      };
    }
    return result;
  }

  const cuePosByIndex = new Map<number, number>();
  for (let i = 0; i < originalCues.length; i++) {
    cuePosByIndex.set(originalCues[i].index, i);
  }

  for (let i = 0; i < originalCues.length; i++) {
    const cue = originalCues[i];
    const segment = audioSegments[cue.index];

    if (
      !segment ||
      segment.isGroupPrimary === false ||
      typeof segment.fittedDurationSec !== "number" ||
      segment.fittedDurationSec <= 0
    ) {
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

    const audioStartSec =
      typeof segment.audioStartSec === "number" ? segment.audioStartSec : cue.startSec;
    const audioEndSec = Number((audioStartSec + segment.fittedDurationSec).toFixed(3));

    // Determine end of cue or speech group, and the next external cue after the group
    let lastCuePos = i;
    if (segment.groupCueIndices && segment.groupCueIndices.length > 0) {
      const lastGroupCueIdx = segment.groupCueIndices[segment.groupCueIndices.length - 1];
      const mappedPos = cuePosByIndex.get(lastGroupCueIdx);
      if (mappedPos !== undefined && mappedPos >= i) {
        lastCuePos = mappedPos;
      }
    }

    const cueEndSec = originalCues[lastCuePos].endSec;

    const hasOverflow = audioEndSec > cueEndSec + 0.001;
    const overflowSec = hasOverflow
      ? Number((audioEndSec - cueEndSec).toFixed(3))
      : 0;

    const nextCue = originalCues[lastCuePos + 1];
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
  overflowAnalysis: Record<number, TimingOverflowMetadata>,
  mode: DubbingMode = "source_sync"
): { allowed: boolean; reason?: string } {
  if (mode === "free_narration") {
    return { allowed: true };
  }

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

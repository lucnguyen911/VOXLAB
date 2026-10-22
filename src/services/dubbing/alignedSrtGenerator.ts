import {
  OriginalCue,
  TranslatedCue,
  DubbingSpeechGroup,
  DubAudioSegment,
} from "../../types/dubbing";
import { exportToSrt } from "../subtitle/exporter";

export interface AlignedSrtCue {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

export interface GenerateAlignedSrtOptions {
  speechGroups: DubbingSpeechGroup[];
  originalCues: OriginalCue[];
  translatedCues: TranslatedCue[];
  audioSegments: Record<number, DubAudioSegment>;
  pauseBetweenGroupsSec?: number;
  /**
   * "narration": Splits each Vietnamese narration speech group at natural clause/sentence boundaries
   *              into readable subtitle blocks (independent of original English cue count) and times
   *              them proportionally across the group's verified audio duration.
   * "group":     Outputs each speech group as a unified subtitle block (1 group = 1 cue).
   * "cue":       Outputs 1:1 with constituent original cues, timed proportionally
   *              to phrase lengths within the group's verified audio duration.
   */
  mode?: "narration" | "group" | "cue";
}

export interface GenerateAlignedSrtResult {
  ok: boolean;
  srtContent?: string;
  cues?: AlignedSrtCue[];
  totalDurationSec?: number;
  reason?: string;
}

/**
 * Calculates continuous narration timeline offsets for speech groups.
 * Linear daisy-chain:
 * - Group 0 starts at 0.000s
 * - Group k starts at (Group k-1 audioEndSec + pauseGapSec)
 * - Durations are strictly derived from actual verified WAV audio durations.
 */
export function calculateNarrationGroupOffsets(
  speechGroups: DubbingSpeechGroup[],
  audioSegments: Record<number, DubAudioSegment>,
  pauseBetweenGroupsSec = 0.45
): Map<string, { startSec: number; endSec: number; durationSec: number }> {
  const result = new Map<string, { startSec: number; endSec: number; durationSec: number }>();
  let runningSec = 0;

  for (let i = 0; i < speechGroups.length; i++) {
    const group = speechGroups[i];
    const headCueId = group.sourceCueIds[0];
    const seg = audioSegments[headCueId];
    const duration =
      seg && seg.fittedDurationSec > 0
        ? seg.fittedDurationSec
        : seg && seg.rawDurationSec > 0
        ? seg.rawDurationSec
        : 1.0;

    const startSec = Number(runningSec.toFixed(3));
    const endSec = Number((runningSec + duration).toFixed(3));

    result.set(group.groupId, {
      startSec,
      endSec,
      durationSec: duration,
    });

    runningSec = endSec;
    if (i < speechGroups.length - 1) {
      runningSec += Math.max(0, pauseBetweenGroupsSec);
    }
  }

  return result;
}

/**
 * Splits a Vietnamese narration sentence/paragraph into readable subtitle blocks (<= maxCharsPerCue)
 * at natural punctuation / clause boundaries, completely independent of source SRT cue count.
 */
export function splitNarrationGroupIntoSubtitlePhrases(
  text: string,
  maxCharsPerCue = 84
): string[] {
  const clean = (text || "").replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxCharsPerCue) return [clean];

  // First split by sentence/clause punctuation (. ? ! … ; : , — –)
  const rawClauses = clean
    .split(/(?<=[.?!…;:,—–])\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const phrases: string[] = [];
  let current = "";

  const pushWrapped = (segment: string) => {
    const words = segment.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      if (!line) {
        line = w;
      } else if (line.length + 1 + w.length <= maxCharsPerCue) {
        line += " " + w;
      } else {
        phrases.push(line);
        line = w;
      }
    }
    if (line) phrases.push(line);
  };

  for (const clause of rawClauses) {
    if (!current) {
      if (clause.length > maxCharsPerCue) {
        pushWrapped(clause);
      } else {
        current = clause;
      }
    } else if (current.length + 1 + clause.length <= maxCharsPerCue) {
      current += " " + clause;
    } else {
      phrases.push(current);
      if (clause.length > maxCharsPerCue) {
        pushWrapped(clause);
        current = "";
      } else {
        current = clause;
      }
    }
  }

  if (current) {
    phrases.push(current);
  }

  return phrases.length > 0 ? phrases : [clean];
}

/**
 * Generates a newly synchronized SRT subtitle file for Mode 2 (free_narration)
 * whose timestamps are derived 100% from the newly synthesized narration audio timeline.
 *
 * Guarantees:
 * - Does NOT reuse original video SRT timestamps.
 * - Grounded on actual synthesized audio duration of each speech group.
 * - Blocks generation if audio segments are not ready.
 */
export function generateNarrationAlignedSrt(
  options: GenerateAlignedSrtOptions
): GenerateAlignedSrtResult {
  const {
    speechGroups,
    translatedCues,
    audioSegments,
    pauseBetweenGroupsSec = 0.45,
    mode = "cue",
  } = options;

  if (!speechGroups || speechGroups.length === 0) {
    return { ok: false, reason: "Không có nhóm thoại nào để đồng bộ phụ đề." };
  }

  // Completeness check: all speech groups must have ready audio
  const unreadyGroups = speechGroups.filter((g) => {
    const headId = g.sourceCueIds[0];
    const seg = audioSegments[headId];
    return !seg || seg.status !== "ready";
  });

  if (unreadyGroups.length > 0) {
    return {
      ok: false,
      reason: `Có ${unreadyGroups.length} nhóm thoại chưa có âm thanh sẵn sàng. Vui lòng tạo audio trước khi xuất phụ đề đồng bộ.`,
    };
  }

  const offsets = calculateNarrationGroupOffsets(
    speechGroups,
    audioSegments,
    pauseBetweenGroupsSec
  );

  const transByCueId = new Map<number, TranslatedCue>();
  for (const tc of translatedCues) {
    transByCueId.set(tc.index, tc);
  }

  const alignedCues: AlignedSrtCue[] = [];
  let nextCueIndex = 1;

  if (mode === "narration") {
    // Natural Vietnamese narration subtitle blocks derived from speechGroup text + verified audio duration
    for (const group of speechGroups) {
      const offset = offsets.get(group.groupId);
      if (!offset) continue;

      const groupText =
        (group.translatedText || "").trim() ||
        (group.speechText || "").trim() ||
        group.sourceCueIds
          .map((id) => transByCueId.get(id)?.text || "")
          .join(" ")
          .trim();

      const phrases = splitNarrationGroupIntoSubtitlePhrases(groupText, 84);
      if (phrases.length <= 1) {
        alignedCues.push({
          index: nextCueIndex++,
          startSec: offset.startSec,
          endSec: offset.endSec,
          text: phrases[0] || groupText,
        });
      } else {
        const lengths = phrases.map((p) => Math.max(1, p.trim().length));
        const totalLen = lengths.reduce((acc, l) => acc + l, 0);
        let curStart = offset.startSec;

        for (let k = 0; k < phrases.length; k++) {
          const ratio = lengths[k] / totalLen;
          const cueDuration =
            k === phrases.length - 1
              ? Number((offset.endSec - curStart).toFixed(3))
              : Number((offset.durationSec * ratio).toFixed(3));
          const cueEnd = Number((curStart + cueDuration).toFixed(3));

          alignedCues.push({
            index: nextCueIndex++,
            startSec: Number(curStart.toFixed(3)),
            endSec: Math.min(offset.endSec, cueEnd),
            text: phrases[k],
          });

          curStart = cueEnd;
        }
      }
    }
  } else if (mode === "group") {
    // 1 group = 1 subtitle block
    for (const group of speechGroups) {
      const offset = offsets.get(group.groupId);
      if (!offset) continue;

      const groupText =
        group.translatedText ||
        group.speechText ||
        group.sourceCueIds
          .map((id) => transByCueId.get(id)?.text || "")
          .join(" ")
          .trim();

      alignedCues.push({
        index: nextCueIndex++,
        startSec: offset.startSec,
        endSec: offset.endSec,
        text: groupText,
      });
    }
  } else {
    // 1 cue per original cue, timed accurately across the group audio duration
    for (const group of speechGroups) {
      const offset = offsets.get(group.groupId);
      if (!offset) continue;

      if (group.sourceCueIds.length === 1) {
        const cueId = group.sourceCueIds[0];
        const tc = transByCueId.get(cueId);
        alignedCues.push({
          index: nextCueIndex++,
          startSec: offset.startSec,
          endSec: offset.endSec,
          text: tc?.subtitleText || tc?.text || group.speechText,
        });
      } else {
        // Multi-cue group: distribute duration across constituent cues based on character weights
        const memberCues = group.sourceCueIds.map((id) => transByCueId.get(id));
        const texts = memberCues.map((c) => c?.subtitleText || c?.text || "");
        const lengths = texts.map((t) => Math.max(1, t.trim().length));
        const totalLen = lengths.reduce((acc, l) => acc + l, 0);

        let curStart = offset.startSec;
        for (let k = 0; k < memberCues.length; k++) {
          const ratio = lengths[k] / totalLen;
          const cueDuration =
            k === memberCues.length - 1
              ? Number((offset.endSec - curStart).toFixed(3))
              : Number((offset.durationSec * ratio).toFixed(3));
          const cueEnd = Number((curStart + cueDuration).toFixed(3));

          alignedCues.push({
            index: nextCueIndex++,
            startSec: Number(curStart.toFixed(3)),
            endSec: Math.min(offset.endSec, cueEnd),
            text: texts[k],
          });

          curStart = cueEnd;
        }
      }
    }
  }

  const srtContent = exportToSrt(alignedCues);
  const totalDurationSec =
    alignedCues.length > 0 ? alignedCues[alignedCues.length - 1].endSec : 0;

  return {
    ok: true,
    srtContent,
    cues: alignedCues,
    totalDurationSec,
  };
}

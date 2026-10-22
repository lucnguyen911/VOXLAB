/**
 * Free Narration Script Reconstruction & Editing Service (`free_narration` mode).
 *
 * Implements the decoupled narration pipeline:
 * `SRT tiếng Anh → Khôi phục kịch bản TXT → Dịch tiếng Việt tự nhiên → Chỉnh sửa kịch bản → TTS → WAV/MP3 → SRT mới theo audio`
 *
 * Key Guarantees:
 * - Strips SRT cue indices and timestamps from the narration script.
 * - Reconstructs sentences broken across 2–4 SRT cues into complete, natural sentences.
 * - Preserves punctuation, paragraph structure, speaker labels, numbers, proper nouns, and short valid sentences.
 * - Allows direct editing of either individual reconstructed sentence blocks or the full continuous Vietnamese TXT script before TTS.
 */

import {
  OriginalCue,
  TranslatedCue,
  DubbingSpeechGroup,
  DubAudioSegment,
  DubAudioStatus,
} from "../../types/dubbing";
import {
  planDubbingSpeechGroups,
  normalizeCueTextForSpeech,
  extractSpeakerPrefix,
} from "./speechPlanner";
import { projectGroupTranslationToCues } from "../translation/groupProjection";

export interface ReconstructedNarrationScript {
  groups: DubbingSpeechGroup[];
  /** Full reconstructed source script without cue numbers or timestamps */
  sourceScriptText: string;
  /** Paragraph blocks reconstructed from source cues */
  sourceParagraphs: string[];
}

/**
 * Determines whether a speech group break should also insert a paragraph break (`\n\n`)
 * in the continuous narration TXT script.
 */
export function isParagraphBreakReason(breakReason: DubbingSpeechGroup["breakReason"]): boolean {
  return (
    breakReason === "chapter_header" ||
    breakReason === "speaker_change" ||
    breakReason === "pause_gap" ||
    breakReason === "user_break" ||
    breakReason === "end_of_script"
  );
}

/**
 * Reconstructs a clean, timestamp-free narration script from raw SRT/VTT cues.
 * Merges sentences split across 2–4 cues while preserving punctuation, speaker prefixes,
 * chapter headers, numbers, proper nouns, and short valid utterances.
 */
export function reconstructFreeNarrationScript(
  originalCues: OriginalCue[],
  translatedCues: TranslatedCue[] = [],
  audioSegments?: Record<number, DubAudioSegment>
): ReconstructedNarrationScript {
  if (!originalCues || originalCues.length === 0) {
    return {
      groups: [],
      sourceScriptText: "",
      sourceParagraphs: [],
    };
  }

  const groups = planDubbingSpeechGroups(originalCues, translatedCues, audioSegments);
  const paragraphs: string[] = [];
  let currentParagraphSentences: string[] = [];

  for (const group of groups) {
    const cleanSource = (group.sourceText || "").trim();
    if (cleanSource) {
      currentParagraphSentences.push(cleanSource);
    }
    if (isParagraphBreakReason(group.breakReason) && currentParagraphSentences.length > 0) {
      paragraphs.push(currentParagraphSentences.join(" "));
      currentParagraphSentences = [];
    }
  }

  if (currentParagraphSentences.length > 0) {
    paragraphs.push(currentParagraphSentences.join(" "));
  }

  return {
    groups,
    sourceScriptText: paragraphs.join("\n\n"),
    sourceParagraphs: paragraphs,
  };
}

/**
 * Builds the continuous Vietnamese narration TXT script from speechGroups.
 * Never includes SRT cue numbers or timestamps.
 */
export function buildTranslatedNarrationScriptText(
  speechGroups: DubbingSpeechGroup[],
  translatedCues: TranslatedCue[] = []
): string {
  if (!speechGroups || speechGroups.length === 0) {
    return translatedCues
      .map((c) => normalizeCueTextForSpeech(c.text))
      .filter(Boolean)
      .join("\n\n");
  }

  const transByCueId = new Map<number, TranslatedCue>();
  for (const tc of translatedCues) {
    transByCueId.set(tc.index, tc);
  }

  const blocks: string[] = [];
  for (const group of speechGroups) {
    const text =
      (group.translatedText || "").trim() ||
      (group.speechText || "").trim() ||
      group.sourceCueIds
        .map((id) => normalizeCueTextForSpeech(transByCueId.get(id)?.text || ""))
        .filter(Boolean)
        .join(" ")
        .trim();
    if (text) {
      blocks.push(text);
    }
  }

  return blocks.join("\n\n");
}

/**
 * Projects a group's full Vietnamese sentence onto its constituent `TranslatedCue[]`
 * for reference SRT compatibility, WITHOUT ever splitting or altering the group's
 * natural `translatedText` or `speechText` used for `free_narration` TTS.
 */
export function distributeNarrationGroupToReferenceCues(
  groupCues: OriginalCue[],
  groupTranslatedText: string,
  groupId: string,
  isEdited = false
): TranslatedCue[] {
  const cleanFull = normalizeCueTextForSpeech(groupTranslatedText);
  if (groupCues.length === 0) return [];

  if (groupCues.length === 1) {
    const cue = groupCues[0];
    return [
      {
        index: cue.index,
        startSec: cue.startSec,
        endSec: cue.endSec,
        originalText: cue.text,
        text: cleanFull,
        subtitleText: cleanFull,
        speechFragmentText: cleanFull,
        groupId,
        projectionNeedsReview: false,
        isEdited,
      },
    ];
  }

  const projection = projectGroupTranslationToCues(groupCues, cleanFull);
  if (projection.projectedTexts.length === groupCues.length) {
    return groupCues.map((cue, idx) => ({
      index: cue.index,
      startSec: cue.startSec,
      endSec: cue.endSec,
      originalText: cue.text,
      text: projection.projectedTexts[idx] || cleanFull,
      subtitleText: projection.projectedTexts[idx] || cleanFull,
      speechFragmentText: projection.projectedTexts[idx] || cleanFull,
      groupId,
      projectionNeedsReview: false,
      isEdited,
    }));
  }

  // Proportional word distribution fallback (never re-queries AI per cue)
  const words = cleanFull.split(/\s+/).filter(Boolean);
  const totalCount = groupCues.length;
  let cursor = 0;

  return groupCues.map((cue, idx) => {
    const remainingCues = totalCount - idx;
    const remainingWords = words.length - cursor;
    const takeCount =
      idx === totalCount - 1
        ? remainingWords
        : Math.max(1, Math.round(remainingWords / remainingCues));
    const slice = words.slice(cursor, cursor + takeCount).join(" ").trim();
    cursor += takeCount;
    const fragment = slice || cleanFull;
    return {
      index: cue.index,
      startSec: cue.startSec,
      endSec: cue.endSec,
      originalText: cue.text,
      text: fragment,
      subtitleText: fragment,
      speechFragmentText: fragment,
      groupId,
      projectionNeedsReview: false,
      isEdited,
    };
  });
}

/**
 * Updates a single reconstructed narration group's Vietnamese text directly
 * when the user edits a narration block in `free_narration` mode.
 */
export function updateNarrationGroupText(
  groups: DubbingSpeechGroup[],
  originalCues: OriginalCue[],
  translatedCues: TranslatedCue[],
  groupId: string,
  newGroupText: string,
  audioSegments: Record<number, DubAudioSegment>
): {
  updatedGroups: DubbingSpeechGroup[];
  updatedTranslatedCues: TranslatedCue[];
  updatedSegments: Record<number, DubAudioSegment>;
} {
  const targetGroup = groups.find((g) => g.groupId === groupId);
  if (!targetGroup) {
    return {
      updatedGroups: groups,
      updatedTranslatedCues: translatedCues,
      updatedSegments: audioSegments,
    };
  }

  const cleanText = newGroupText.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ");
  const trimmedSpeech = extractSpeakerPrefix(cleanText.trim()).bodyText || cleanText.trim();

  const updatedSegments: Record<number, DubAudioSegment> = { ...audioSegments };
  let hasExistingAudio = false;
  for (const cueId of targetGroup.sourceCueIds) {
    if (updatedSegments[cueId]) {
      hasExistingAudio = true;
      updatedSegments[cueId] = {
        ...updatedSegments[cueId],
        status: "modified",
        text:
          cueId === targetGroup.sourceCueIds[0]
            ? trimmedSpeech
            : updatedSegments[cueId].text,
      };
    }
  }

  const nextStatus: DubAudioStatus = hasExistingAudio ? "modified" : targetGroup.status;

  const updatedGroups = groups.map((g) =>
    g.groupId === groupId
      ? {
          ...g,
          translatedText: cleanText,
          speechText: trimmedSpeech,
          status: nextStatus,
          isUserModified: true,
        }
      : g
  );

  const origById = new Map<number, OriginalCue>();
  for (const c of originalCues) {
    origById.set(c.index, c);
  }
  const groupCues = targetGroup.sourceCueIds
    .map((id) => origById.get(id))
    .filter((c): c is OriginalCue => Boolean(c));

  const distributed = distributeNarrationGroupToReferenceCues(
    groupCues,
    cleanText.trim(),
    groupId,
    true
  );
  const distById = new Map<number, TranslatedCue>();
  for (const dc of distributed) {
    distById.set(dc.index, dc);
  }

  const updatedTranslatedCues = translatedCues.map((tc) => distById.get(tc.index) || tc);

  return {
    updatedGroups,
    updatedTranslatedCues,
    updatedSegments,
  };
}

/**
 * Applies a full-script Vietnamese TXT edit back to the narration `speechGroups` and `translatedCues`.
 * Paragraphs separated by blank lines (`\n\n`) or lines are mapped onto the narration groups.
 */
export function applyFullNarrationScriptEdit(
  groups: DubbingSpeechGroup[],
  originalCues: OriginalCue[],
  translatedCues: TranslatedCue[],
  fullScriptText: string,
  audioSegments: Record<number, DubAudioSegment>
): {
  updatedGroups: DubbingSpeechGroup[];
  updatedTranslatedCues: TranslatedCue[];
  updatedSegments: Record<number, DubAudioSegment>;
} {
  if (groups.length === 0) {
    return {
      updatedGroups: groups,
      updatedTranslatedCues: translatedCues,
      updatedSegments: audioSegments,
    };
  }

  const normalized = (fullScriptText || "").replace(/\r\n/g, "\n").trim();
  let paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (paragraphs.length === 1 && groups.length > 1 && normalized.includes("\n")) {
    const lines = normalized
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === groups.length) {
      paragraphs = lines;
    }
  }

  // Map paragraphs to groups:
  // - If paragraph count matches group count: 1:1 mapping
  // - Otherwise: distribute sentences/words proportionally across groups
  let groupTexts: string[];
  if (paragraphs.length === groups.length) {
    groupTexts = paragraphs;
  } else {
    const allSentences = normalized
      .replace(/\n+/g, " ")
      .split(/(?<=[.?!…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (allSentences.length >= groups.length) {
      groupTexts = [];
      let cursor = 0;
      for (let i = 0; i < groups.length; i++) {
        const remGroups = groups.length - i;
        const remSents = allSentences.length - cursor;
        const take =
          i === groups.length - 1 ? remSents : Math.max(1, Math.round(remSents / remGroups));
        groupTexts.push(allSentences.slice(cursor, cursor + take).join(" "));
        cursor += take;
      }
    } else {
      const allWords = normalized.replace(/\s+/g, " ").split(" ").filter(Boolean);
      groupTexts = [];
      let cursor = 0;
      for (let i = 0; i < groups.length; i++) {
        const remGroups = groups.length - i;
        const remWords = allWords.length - cursor;
        const take =
          i === groups.length - 1 ? remWords : Math.max(1, Math.round(remWords / remGroups));
        groupTexts.push(allWords.slice(cursor, cursor + take).join(" "));
        cursor += take;
      }
    }
  }

  let curGroups = [...groups];
  let curTranslated = [...translatedCues];
  let curSegments = { ...audioSegments };

  for (let i = 0; i < curGroups.length; i++) {
    const grp = curGroups[i];
    const nextText = groupTexts[i] ?? "";
    const prevText = (grp.translatedText || grp.speechText || "").trim();
    if (nextText !== prevText) {
      const res = updateNarrationGroupText(
        curGroups,
        originalCues,
        curTranslated,
        grp.groupId,
        nextText,
        curSegments
      );
      curGroups = res.updatedGroups;
      curTranslated = res.updatedTranslatedCues;
      curSegments = res.updatedSegments;
    }
  }

  return {
    updatedGroups: curGroups,
    updatedTranslatedCues: curTranslated,
    updatedSegments: curSegments,
  };
}

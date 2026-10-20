import {
  OriginalCue,
  TranslatedCue,
  DubAudioSegment,
  DubAudioStatus,
  DubbingSpeechGroup,
  SpeechGroupBreakReason,
} from "../../types/dubbing";
import { DEFAULT_SAFETY_GAP_SEC } from "./timingFit";

export interface SpeechPlannerOptions {
  /** Maximum pause gap (seconds) allowed inside a continuous speech group. Default: 0.75s */
  maxPauseGapSec?: number;
  /** Pause gap (seconds) that triggers a break when combined with a clause comma/semicolon. Default: 0.42s */
  clausePauseGapSec?: number;
  /** Soft character limit where clause boundary splitting is preferred. Default: 220 */
  softMaxChars?: number;
  /** Hard character limit per TTS group to prevent model attention degradation. Default: 340 */
  hardMaxChars?: number;
  /** Soft duration limit (seconds) where clause boundary splitting is preferred. Default: 15.0s */
  softMaxDurationSec?: number;
  /** Hard duration limit (seconds) per TTS group. Default: 24.0s */
  hardMaxDurationSec?: number;
  /** Explicit cue indices after which the user forced a group break */
  userBreakAfterIndices?: Set<number> | number[];
  /** Safety gap before the next speech group starts. Default: 0.02s */
  safetyGapSec?: number;
}

const COMMON_ABBREVIATIONS = new Set([
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
  "prof.",
  "sr.",
  "jr.",
  "st.",
  "vs.",
  "etc.",
  "e.g.",
  "i.e.",
  "fig.",
  "no.",
  "vol.",
  "gen.",
  "inc.",
  "ltd.",
  "co.",
  "corp.",
  "u.s.",
  "u.k.",
]);

const CONTINUATION_TAIL_WORDS = new Set([
  // English function words that strongly require the following phrase
  "the",
  "a",
  "an",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "with",
  "by",
  "from",
  "into",
  "across",
  "through",
  "between",
  "under",
  "over",
  "after",
  "before",
  "and",
  "or",
  "but",
  "nor",
  "so",
  "yet",
  "because",
  "although",
  "while",
  "if",
  "when",
  "where",
  "that",
  "which",
  "who",
  "whom",
  "whose",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "has",
  "have",
  "had",
  "can",
  "could",
  "will",
  "would",
  "shall",
  "should",
  "may",
  "might",
  "must",
  "not",
  "very",
  "more",
  "most",
  "around",
  "roughly",
  "nearly",
  "almost",
  // Vietnamese continuation words
  "và",
  "hoặc",
  "nhưng",
  "mà",
  "vì",
  "do",
  "bởi",
  "để",
  "của",
  "trong",
  "trên",
  "dưới",
  "với",
  "từ",
  "đến",
  "tại",
  "những",
  "các",
  "một",
  "đang",
  "đã",
  "sẽ",
  "vẫn",
  "cũng",
  "rất",
  "hơn",
  "nhất",
  "khoảng",
  "gần",
]);

const CLAUSE_START_CONJUNCTIONS = new Set([
  "and",
  "but",
  "or",
  "while",
  "whereas",
  "because",
  "although",
  "though",
  "since",
  "unless",
  "until",
  "which",
  "where",
  "when",
  "và",
  "nhưng",
  "hoặc",
  "tuy nhiên",
  "trong khi",
  "bởi vì",
  "vì vậy",
  "do đó",
  "cho nên",
  "nếu",
  "khi",
]);

/**
 * Normalizes multi-line subtitle cue text into a clean single-line phrase for translation and TTS.
 * - Replaces internal display line breaks (\r\n, \n) with spaces.
 * - Collapses redundant whitespace.
 * - Preserves all punctuation, numbers, currency symbols, and proper nouns.
 */
export function normalizeCueTextForSpeech(text: string): string {
  if (!text) return "";
  return text
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts speaker prefix if a cue begins with "Speaker Name: ..." or "- ...".
 */
export function extractSpeakerPrefix(text: string): {
  speakerPrefix?: string;
  bodyText: string;
  isDialogueTurn: boolean;
} {
  const normalized = normalizeCueTextForSpeech(text);
  if (!normalized) return { bodyText: "", isDialogueTurn: false };

  // Check explicit speaker label e.g. "Alice: Hello", "[Host]: ...", "Speaker 1: ..." or "Dr. Minh: ..."
  // Exclude chapter/part headers like "CHAPTER 1:" or "PART 2:"
  const speakerMatch = normalized.match(
    /^[\[({]?([A-ZÀ-Ỹ][A-Za-zÀ-ỹ0-9_.\s]{0,22}?)[\])}]?:\s+(.+)$/
  );
  if (speakerMatch) {
    const candidateLabel = speakerMatch[1].trim();
    if (!/^(CHAPTER|PART|SECTION|PHẦN|CHƯƠNG|TẬP|MỤC|NOTE|WARNING)\b/i.test(candidateLabel)) {
      return {
        speakerPrefix: candidateLabel,
        bodyText: speakerMatch[2].trim(),
        isDialogueTurn: true,
      };
    }
  }

  // Check leading dialogue dash "- Hello"
  if (/^[-–—]\s+\S/.test(normalized)) {
    return {
      speakerPrefix: "-",
      bodyText: normalized.replace(/^[-–—]\s+/, "").trim(),
      isDialogueTurn: true,
    };
  }

  return { bodyText: normalized, isDialogueTurn: false };
}

/**
 * Detects whether a cue is a standalone chapter/section heading.
 */
export function isChapterOrSectionHeader(text: string): boolean {
  const clean = normalizeCueTextForSpeech(text);
  if (!clean) return false;
  if (/^(CHAPTER|PART|SECTION|ACT|PHẦN|CHƯƠNG|HỒI|MỤC)\s+[0-9IVXLC]+/i.test(clean)) {
    return true;
  }
  // Short all-caps heading without terminal sentence punctuation
  const lettersOnly = clean.replace(/[^A-Za-zÀ-ỹ]/g, "");
  if (
    lettersOnly.length >= 4 &&
    clean.length <= 45 &&
    lettersOnly === lettersOnly.toUpperCase() &&
    !/[.?!]$/.test(clean)
  ) {
    return true;
  }
  return false;
}

/**
 * Checks if normalized text ends with genuine sentence-ending punctuation (., ?, !, …),
 * ignoring common abbreviations (Dr., Mr., U.S., etc.) and decimal numbers.
 */
export function endsWithTerminalPunctuation(text: string): boolean {
  const clean = normalizeCueTextForSpeech(text);
  if (!clean) return false;

  // Strip trailing closing quotes/brackets
  const stripped = clean.replace(/["'”’)\]]+$/g, "").trim();
  if (!stripped) return false;

  if (/[?!…]$/.test(stripped)) {
    return true;
  }

  if (stripped.endsWith(".")) {
    const tokens = stripped.split(/\s+/);
    const lastToken = (tokens[tokens.length - 1] || "").toLowerCase();
    if (COMMON_ABBREVIATIONS.has(lastToken)) {
      return false;
    }
    // Single uppercase initial like "J." or "A."
    if (/^[a-z]\.$/i.test(lastToken)) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Checks if normalized text ends with a clause boundary (, ; : — -).
 */
export function endsWithClausePunctuation(text: string): boolean {
  const clean = normalizeCueTextForSpeech(text);
  if (!clean) return false;
  return /[,;:—–-]$/.test(clean);
}

/**
 * Checks if the cue ends with a dangling function word or incomplete syntactic phrase,
 * or if the next cue starts with a lowercase continuation token.
 */
export function hasStrongSemanticContinuation(
  currentText: string,
  nextText: string
): boolean {
  const curClean = normalizeCueTextForSpeech(currentText);
  const nextClean = normalizeCueTextForSpeech(nextText);
  if (!curClean || !nextClean) return false;

  if (endsWithTerminalPunctuation(curClean)) {
    return false;
  }

  const curWords = curClean.split(/\s+/);
  const lastWord = (curWords[curWords.length - 1] || "")
    .replace(/[,;:—–"']+$/g, "")
    .toLowerCase();

  if (CONTINUATION_TAIL_WORDS.has(lastWord)) {
    return true;
  }

  // If current cue has no punctuation at the end at all, it is almost certainly mid-phrase
  if (!/[.?!…,;:—–-]["'”’)\]]*$/.test(curClean)) {
    return true;
  }

  // If next cue starts with a lowercase letter or number/currency continuation
  const firstNextChar = nextClean.charAt(0);
  if (
    firstNextChar &&
    firstNextChar === firstNextChar.toLowerCase() &&
    firstNextChar !== firstNextChar.toUpperCase()
  ) {
    return true;
  }

  return false;
}

/**
 * Checks whether the boundary between currentText and nextText is a natural grammatical clause boundary
 * suitable for splitting an overly long sentence.
 */
export function isNaturalClauseSplitBoundary(
  currentText: string,
  nextText: string
): boolean {
  const curClean = normalizeCueTextForSpeech(currentText);
  const nextClean = normalizeCueTextForSpeech(nextText);
  if (!curClean || !nextClean) return false;

  if (endsWithClausePunctuation(curClean)) {
    return true;
  }

  const nextWords = nextClean.split(/\s+/);
  const firstWord = (nextWords[0] || "").toLowerCase().replace(/^[,;:"'([—–-]+/, "");
  const firstTwoWords = nextWords
    .slice(0, 2)
    .join(" ")
    .toLowerCase()
    .replace(/^[,;:"'([—–-]+/, "");

  if (
    CLAUSE_START_CONJUNCTIONS.has(firstWord) ||
    CLAUSE_START_CONJUNCTIONS.has(firstTwoWords)
  ) {
    // Only split before a conjunction if the preceding cue doesn't end with a dangling determiner/preposition
    const curWords = curClean.split(/\s+/);
    const lastWord = (curWords[curWords.length - 1] || "").toLowerCase();
    if (!CONTINUATION_TAIL_WORDS.has(lastWord)) {
      return true;
    }
  }

  return false;
}

/**
 * Joins multiple cue text fragments into a single seamless spoken sentence/phrase.
 */
export function joinCueTextsForSpeech(texts: string[], stripSpeakerPrefix = false): string {
  const parts: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    let clean = normalizeCueTextForSpeech(texts[i]);
    if (!clean) continue;
    if (stripSpeakerPrefix && i === 0) {
      const extracted = extractSpeakerPrefix(clean);
      clean = extracted.bodyText || clean;
    }
    parts.push(clean);
  }
  return parts
    .join(" ")
    .replace(/\s+([,.;:?!…])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Derives aggregate group synthesis status from member DubAudioSegments.
 */
export function deriveGroupStatus(
  sourceCueIds: number[],
  audioSegments?: Record<number, DubAudioSegment>
): DubAudioStatus {
  if (!audioSegments || sourceCueIds.length === 0) {
    return "idle";
  }
  const headSeg = audioSegments[sourceCueIds[0]];
  if (!headSeg) return "idle";

  for (const cueId of sourceCueIds) {
    const seg = audioSegments[cueId];
    if (!seg) return "idle";
    if (seg.status === "generating") return "generating";
    if (seg.status === "failed") return "failed";
    if (seg.status === "modified") return "modified";
    if (seg.status === "needs_generation") return "needs_generation";
  }

  return headSeg.status;
}

/**
 * Plans sentence/clause speech groups across the subtitle timeline.
 *
 * Key Guarantees:
 * - Never alters OriginalCue[] or TranslatedCue[] indices or timestamps.
 * - Never uses a rigid "every 3-5 cues" rule.
 * - Never merges across speaker changes, chapter headers, user-defined breaks, or intentional pauses.
 * - Splits extra-long sentences at natural grammatical clause boundaries.
 */
export function planDubbingSpeechGroups(
  originalCues: OriginalCue[],
  translatedCues: TranslatedCue[] = [],
  audioSegments?: Record<number, DubAudioSegment>,
  options?: SpeechPlannerOptions
): DubbingSpeechGroup[] {
  if (!originalCues || originalCues.length === 0) {
    return [];
  }

  const maxPauseGapSec = options?.maxPauseGapSec ?? 0.75;
  const clausePauseGapSec = options?.clausePauseGapSec ?? 0.42;
  const softMaxChars = options?.softMaxChars ?? 220;
  const hardMaxChars = options?.hardMaxChars ?? 340;
  const softMaxDurationSec = options?.softMaxDurationSec ?? 15.0;
  const hardMaxDurationSec = options?.hardMaxDurationSec ?? 24.0;
  const safetyGapSec = options?.safetyGapSec ?? DEFAULT_SAFETY_GAP_SEC;

  const userBreakSet = new Set<number>(
    options?.userBreakAfterIndices ? Array.from(options.userBreakAfterIndices) : []
  );

  const transByIndex = new Map<number, TranslatedCue>();
  for (const tc of translatedCues) {
    transByIndex.set(tc.index, tc);
    if (tc.forceGroupBreakAfter) {
      userBreakSet.add(tc.index);
    }
  }

  const rawGroups: {
    cues: OriginalCue[];
    speakerPrefix?: string;
    breakReason: SpeechGroupBreakReason;
  }[] = [];

  let currentCues: OriginalCue[] = [];
  let currentSpeaker: string | undefined = undefined;
  let currentChars = 0;

  const flushGroup = (reason: SpeechGroupBreakReason) => {
    if (currentCues.length === 0) return;
    rawGroups.push({
      cues: [...currentCues],
      speakerPrefix: currentSpeaker,
      breakReason: reason,
    });
    currentCues = [];
    currentSpeaker = undefined;
    currentChars = 0;
  };

  for (let i = 0; i < originalCues.length; i++) {
    const cue = originalCues[i];
    const nextCue = originalCues[i + 1];
    const normSource = normalizeCueTextForSpeech(cue.text);
    const transCue = transByIndex.get(cue.index);
    const normTarget = transCue
      ? normalizeCueTextForSpeech(transCue.speechFragmentText || transCue.text)
      : normSource;

    const speakerInfo = extractSpeakerPrefix(normSource);

    if (currentCues.length === 0) {
      currentCues.push(cue);
      currentSpeaker = speakerInfo.speakerPrefix;
      currentChars = Math.max(normSource.length, normTarget.length);
    } else {
      currentCues.push(cue);
      currentChars += 1 + Math.max(normSource.length, normTarget.length);
    }

    // 1. Check if this is the final cue
    if (!nextCue) {
      flushGroup("end_of_script");
      break;
    }

    // 2. Check explicit user break after this cue
    if (userBreakSet.has(cue.index)) {
      flushGroup("user_break");
      continue;
    }

    // 3. Check if current cue or next cue is a standalone chapter/section header
    if (isChapterOrSectionHeader(normSource) || isChapterOrSectionHeader(nextCue.text)) {
      flushGroup("chapter_header");
      continue;
    }

    // 4. Check speaker change on next cue
    const nextSpeakerInfo = extractSpeakerPrefix(nextCue.text);
    if (
      nextSpeakerInfo.isDialogueTurn &&
      (nextSpeakerInfo.speakerPrefix !== currentSpeaker || nextSpeakerInfo.speakerPrefix === "-")
    ) {
      flushGroup("speaker_change");
      continue;
    }

    // 5. Check pause gap between current cue and next cue
    const pauseGapSec = Math.max(0, Number((nextCue.startSec - cue.endSec).toFixed(3)));
    if (pauseGapSec >= maxPauseGapSec) {
      flushGroup("pause_gap");
      continue;
    }

    // 6. Check terminal punctuation on source (or target if source lacks punctuation)
    if (endsWithTerminalPunctuation(normSource)) {
      flushGroup("terminal_punctuation");
      continue;
    }

    // 7. Medium pause + clause punctuation -> natural breath break
    if (pauseGapSec >= clausePauseGapSec && endsWithClausePunctuation(normSource)) {
      flushGroup("pause_gap");
      continue;
    }

    // 8. Check adaptive length & duration limits at natural clause boundaries
    const nextNormSource = normalizeCueTextForSpeech(nextCue.text);
    const nextTrans = transByIndex.get(nextCue.index);
    const nextNormTarget = nextTrans
      ? normalizeCueTextForSpeech(nextTrans.speechFragmentText || nextTrans.text)
      : nextNormSource;

    const projectedChars = currentChars + 1 + Math.max(nextNormSource.length, nextNormTarget.length);
    const currentGroupDuration = cue.endSec - currentCues[0].startSec;
    const projectedGroupDuration = nextCue.endSec - currentCues[0].startSec;

    const exceedsSoftLimit =
      currentChars >= softMaxChars ||
      projectedChars > hardMaxChars ||
      currentGroupDuration >= softMaxDurationSec;

    if (exceedsSoftLimit && isNaturalClauseSplitBoundary(normSource, nextNormSource)) {
      flushGroup("max_length_clause");
      continue;
    }

    // Hard safety cap: only split if projected group would exceed hard limits AND not breaking a tight determiner/auxiliary
    if (
      (projectedChars > hardMaxChars * 1.25 || projectedGroupDuration > hardMaxDurationSec) &&
      !hasStrongSemanticContinuation(normSource, nextNormSource)
    ) {
      flushGroup("max_length_clause");
      continue;
    }
  }

  if (currentCues.length > 0) {
    flushGroup("end_of_script");
  }

  // Convert rawGroups into DubbingSpeechGroup[] with exact timeline windows
  const groups: DubbingSpeechGroup[] = rawGroups.map((rg, idx) => {
    const firstCue = rg.cues[0];
    const lastCue = rg.cues[rg.cues.length - 1];
    const nextGroupFirstCue = rawGroups[idx + 1]?.cues[0];
    const sourceCueIds = rg.cues.map((c) => c.index);
    const groupId = `group_${firstCue.index}_${lastCue.index}`;

    const startSec = firstCue.startSec;
    const endSec = lastCue.endSec;
    const nextGroupStartSec = nextGroupFirstCue?.startSec;
    const naturalDuration = Math.max(0.4, Number((endSec - startSec).toFixed(3)));
    const availableDurationSec =
      nextGroupStartSec !== undefined
        ? Math.max(
            naturalDuration,
            Number((nextGroupStartSec - startSec - safetyGapSec).toFixed(3))
          )
        : Math.max(naturalDuration, Number((endSec - startSec + 2.0).toFixed(3)));

    const sourceText = joinCueTextsForSpeech(rg.cues.map((c) => c.text));
    const targetTexts = rg.cues.map((c) => {
      const tc = transByIndex.get(c.index);
      if (!tc) return "";
      return tc.speechFragmentText || tc.text || "";
    });
    const hasAllTranslations = targetTexts.every((t) => t.trim().length > 0);
    const speechText = hasAllTranslations
      ? joinCueTextsForSpeech(targetTexts, true)
      : "";
    const translatedText = hasAllTranslations
      ? joinCueTextsForSpeech(targetTexts, false)
      : "";

    const isUserModified = rg.cues.some((c) => Boolean(transByIndex.get(c.index)?.isEdited));
    const status = deriveGroupStatus(sourceCueIds, audioSegments);

    return {
      groupId,
      sourceCueIds,
      startSec,
      endSec,
      nextGroupStartSec,
      availableDurationSec,
      sourceText,
      translatedText,
      speechText,
      speakerPrefix: rg.speakerPrefix,
      breakReason: rg.breakReason,
      status,
      isUserModified,
    };
  });

  return groups;
}

/**
 * Finds the DubbingSpeechGroup containing a given 1-based cueIndex.
 */
export function findSpeechGroupByCueIndex(
  groups: DubbingSpeechGroup[],
  cueIndex: number
): DubbingSpeechGroup | undefined {
  return groups.find((g) => g.sourceCueIds.includes(cueIndex));
}

/**
 * Rebuilds the affected DubbingSpeechGroup and invalidates ONLY its audio segments
 * when a single TranslatedCue is edited by the user.
 */
export function rebuildGroupAfterCueEdit(
  groups: DubbingSpeechGroup[],
  translatedCues: TranslatedCue[],
  editedCueIndex: number,
  audioSegments: Record<number, DubAudioSegment>
): {
  updatedGroups: DubbingSpeechGroup[];
  updatedSegments: Record<number, DubAudioSegment>;
  affectedGroup?: DubbingSpeechGroup;
} {
  const transByIndex = new Map<number, TranslatedCue>();
  for (const tc of translatedCues) {
    transByIndex.set(tc.index, tc);
  }

  let affectedGroup: DubbingSpeechGroup | undefined;
  const updatedSegments: Record<number, DubAudioSegment> = { ...audioSegments };

  const updatedGroups = groups.map((group) => {
    if (!group.sourceCueIds.includes(editedCueIndex)) {
      return group;
    }

    const rebuiltSpeechText = joinCueTextsForSpeech(
      group.sourceCueIds.map((id) => {
        const tc = transByIndex.get(id);
        return tc?.text || "";
      }),
      true
    );

    const hasExistingAudio = group.sourceCueIds.some((id) => Boolean(updatedSegments[id]));
    const nextStatus: DubAudioStatus = hasExistingAudio ? "modified" : group.status;

    for (const id of group.sourceCueIds) {
      if (updatedSegments[id]) {
        updatedSegments[id] = {
          ...updatedSegments[id],
          status: "modified",
          text: id === group.sourceCueIds[0] ? rebuiltSpeechText : updatedSegments[id].text,
        };
      }
    }

    affectedGroup = {
      ...group,
      speechText: rebuiltSpeechText,
      status: nextStatus,
      isUserModified: true,
    };
    return affectedGroup;
  });

  return {
    updatedGroups,
    updatedSegments,
    affectedGroup,
  };
}

/**
 * Projects a synthesized group DubAudioSegment across all constituent cue indices in the group.
 * - Head cue (`sourceCueIds[0]`) holds the real timeline placement (`isGroupPrimary: true`, `fittedDurationSec`, `audioStartSec`, `audioEndSec`).
 * - Follower cues (`sourceCueIds[1..]`) mirror the `status`, `audioUrl`, `audioFilePath`, and `qualityReview` with `isGroupPrimary: false`
 *   so ReviewGrid displays ready status & allows playback on every row without double-inserting audio in Master WAV assembly.
 */
export function expandGroupSegmentToCueSegments(
  group: DubbingSpeechGroup,
  primarySegment: DubAudioSegment,
  originalCues: OriginalCue[]
): Record<number, DubAudioSegment> {
  const result: Record<number, DubAudioSegment> = {};
  const primaryCueIndex = group.sourceCueIds[0];
  const cueByIndex = new Map<number, OriginalCue>();
  for (const c of originalCues) {
    cueByIndex.set(c.index, c);
  }

  for (let i = 0; i < group.sourceCueIds.length; i++) {
    const cueIdx = group.sourceCueIds[i];
    const orig = cueByIndex.get(cueIdx);
    const isPrimary = i === 0;

    if (isPrimary) {
      result[cueIdx] = {
        ...primarySegment,
        cueIndex: primaryCueIndex,
        groupId: group.groupId,
        groupCueIndices: [...group.sourceCueIds],
        isGroupPrimary: true,
        primaryCueIndex,
      };
    } else {
      const cueStart = orig ? orig.startSec : group.startSec;
      const cueTargetDur = orig
        ? Math.max(0.2, Number((orig.endSec - orig.startSec).toFixed(3)))
        : 1.0;
      result[cueIdx] = {
        ...primarySegment,
        cueIndex: cueIdx,
        rawDurationSec: 0,
        targetDurationSec: cueTargetDur,
        fittedDurationSec: 0,
        audioStartSec: cueStart,
        audioEndSec: cueStart,
        groupId: group.groupId,
        groupCueIndices: [...group.sourceCueIds],
        isGroupPrimary: false,
        primaryCueIndex,
      };
    }
  }

  return result;
}

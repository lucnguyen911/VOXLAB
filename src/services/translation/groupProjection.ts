import { OriginalCue, TranslatedCue, DubbingSpeechGroup } from "../../types/dubbing";
import {
  normalizeCueTextForSpeech,
  joinCueTextsForSpeech,
} from "../dubbing/speechPlanner";

export interface GroupProjectionResult {
  projectedTexts: string[];
  speechText: string;
  reliable: boolean;
  needsReview: boolean;
  reason?: string;
}

const PHRASE_BREAK_BEFORE_WORDS = new Set([
  // Vietnamese clause / phrase starters
  "nhưng",
  "và",
  "hoặc",
  "hay",
  "mà",
  "vì",
  "bởi",
  "do",
  "để",
  "khi",
  "nếu",
  "dù",
  "tuy",
  "trong",
  "trên",
  "dưới",
  "với",
  "từ",
  "đến",
  "tại",
  "theo",
  "về",
  "như",
  "bằng",
  "cho",
  "của",
  "trước",
  "sau",
  "giữa",
  "ngoài",
  "rằng",
  "là",
  "được",
  "bị",
  "sẽ",
  "đang",
  "đã",
  // English clause / phrase starters (when targetLang is English)
  "and",
  "but",
  "or",
  "while",
  "because",
  "although",
  "since",
  "if",
  "when",
  "where",
  "which",
  "that",
  "who",
  "with",
  "from",
  "into",
  "for",
  "to",
  "in",
  "on",
  "at",
  "by",
  "over",
  "under",
  "after",
  "before",
]);

const DO_NOT_END_PHRASE_WORDS = new Set([
  // Determiners,classifiers, and numbers/prepositions that should stay attached to the following word
  "một",
  "những",
  "các",
  "mỗi",
  "mọi",
  "cái",
  "chiếc",
  "người",
  "con",
  "bộ",
  "sự",
  "việc",
  "rất",
  "quá",
  "hơi",
  "khá",
  "cực",
  "không",
  "chưa",
  "chẳng",
  "đừng",
  "hãy",
  "khoảng",
  "gần",
  "hơn",
  "dưới",
  "trên",
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "my",
  "your",
  "his",
  "her",
  "its",
  "our",
  "their",
  "no",
  "not",
  "very",
  "more",
  "most",
  "roughly",
  "around",
]);

const UNIT_FOLLOW_WORDS = new Set([
  "đô",
  "la",
  "usd",
  "vnd",
  "đồng",
  "tháng",
  "năm",
  "ngày",
  "giờ",
  "phút",
  "giây",
  "lần",
  "phần",
  "trăm",
  "tỷ",
  "triệu",
  "nghìn",
  "ngàn",
  "km",
  "kg",
  "wh",
  "kwh",
  "month",
  "year",
  "years",
  "day",
  "days",
  "hour",
  "hours",
  "percent",
  "million",
  "billion",
  "thousand",
]);

function cleanWordToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/^["'“”‘’([—–-]+|["'“”‘’)\],.;:?!…—–-]+$/g, "");
}

function isNumericOrCurrencyToken(token: string): boolean {
  return /[$€£¥₫0-9]/.test(token);
}

/**
 * Scores a candidate split position between `tokens[splitIdx - 1]` and `tokens[splitIdx]`.
 * Higher score = better grammatical phrase boundary.
 */
function scoreTokenBoundary(
  tokens: string[],
  splitIdx: number,
  idealIdx: number,
  searchRadius: number
): number {
  const prevToken = tokens[splitIdx - 1] || "";
  const nextToken = tokens[splitIdx] || "";
  const prevClean = cleanWordToken(prevToken);
  const nextClean = cleanWordToken(nextToken);

  // Distance penalty from ideal proportional index
  const dist = Math.abs(splitIdx - idealIdx);
  let score = 100 - (dist / Math.max(1, searchRadius)) * 45;

  // Strong bonus if prevToken ends with clause punctuation (, ; : —)
  if (/[,;:—–-]["'”’)\]]*$/.test(prevToken)) {
    score += 55;
  } else if (/[.?!…]["'”’)\]]*$/.test(prevToken)) {
    score += 65;
  }

  // Bonus if nextToken starts a new prepositional/conjunctive clause
  if (PHRASE_BREAK_BEFORE_WORDS.has(nextClean)) {
    score += 28;
  }

  // Heavy penalty for breaking right after a determiner, classifier, or negation
  if (DO_NOT_END_PHRASE_WORDS.has(prevClean)) {
    score -= 60;
  }

  // Heavy penalty for splitting a number/currency from its unit (e.g. "$6,000" -> "a month" or "6.000" -> "đô la")
  if (isNumericOrCurrencyToken(prevToken) && (UNIT_FOLLOW_WORDS.has(nextClean) || isNumericOrCurrencyToken(nextToken))) {
    score -= 80;
  }
  if (prevClean === "đô" && nextClean === "la") {
    score -= 100;
  }
  if (prevClean === "phần" && nextClean === "trăm") {
    score -= 100;
  }
  if ((prevClean === "mỗi" || prevClean === "một" || prevClean === "a" || prevClean === "per") && UNIT_FOLLOW_WORDS.has(nextClean)) {
    score -= 75;
  }

  return score;
}

/**
 * Projects a complete sentence/group translation onto its constituent subtitle cues
 * along natural grammatical phrase boundaries, and validates 100% content preservation.
 */
export function projectGroupTranslationToCues(
  groupCues: OriginalCue[],
  groupTranslatedText: string
): GroupProjectionResult {
  const normalizedSpeech = normalizeCueTextForSpeech(groupTranslatedText);

  if (!groupCues || groupCues.length === 0) {
    return {
      projectedTexts: [],
      speechText: normalizedSpeech,
      reliable: true,
      needsReview: false,
    };
  }

  if (groupCues.length === 1) {
    return {
      projectedTexts: [normalizedSpeech],
      speechText: normalizedSpeech,
      reliable: Boolean(normalizedSpeech),
      needsReview: !normalizedSpeech,
    };
  }

  const tokens = normalizedSpeech.split(/\s+/).filter(Boolean);
  const cueCount = groupCues.length;

  // If fewer words than cues, we cannot project without leaving empty cues
  if (tokens.length < cueCount) {
    return {
      projectedTexts: [],
      speechText: normalizedSpeech,
      reliable: false,
      needsReview: true,
      reason: `Bản dịch nhóm có quá ít từ (${tokens.length} từ) so với số cue (${cueCount}).`,
    };
  }

  // Compute relative weights for each cue combining source character length (70%) and cue duration (30%)
  const sourceCharLengths = groupCues.map((c) =>
    Math.max(4, normalizeCueTextForSpeech(c.text).length)
  );
  const cueDurations = groupCues.map((c) =>
    Math.max(0.4, c.endSec - c.startSec)
  );
  const totalSourceChars = sourceCharLengths.reduce((a, b) => a + b, 0);
  const totalDuration = cueDurations.reduce((a, b) => a + b, 0);

  const weights = groupCues.map((_, idx) => {
    const charRatio = sourceCharLengths[idx] / Math.max(1, totalSourceChars);
    const durRatio = cueDurations[idx] / Math.max(0.1, totalDuration);
    return charRatio * 0.72 + durRatio * 0.28;
  });

  const splitIndices: number[] = [0];
  let cumulativeWeight = 0;

  for (let k = 1; k < cueCount; k++) {
    cumulativeWeight += weights[k - 1];
    const prevSplit = splitIndices[k - 1];
    const remainingCues = cueCount - k;
    // Ensure at least 1 token per cue (prefer >= 2 tokens when possible)
    const minTokensPerCue = tokens.length >= cueCount * 2 ? 2 : 1;
    const minIdx = prevSplit + minTokensPerCue;
    const maxIdx = tokens.length - remainingCues * minTokensPerCue;

    if (minIdx >= maxIdx) {
      splitIndices.push(Math.min(tokens.length - remainingCues, Math.max(prevSplit + 1, minIdx)));
      continue;
    }

    const idealIdx = Math.min(
      maxIdx,
      Math.max(minIdx, Math.round(cumulativeWeight * tokens.length))
    );
    const searchRadius = Math.max(2, Math.min(6, Math.floor((maxIdx - minIdx) / 2) + 2));
    const startCand = Math.max(minIdx, idealIdx - searchRadius);
    const endCand = Math.min(maxIdx, idealIdx + searchRadius);

    let bestIdx = idealIdx;
    let bestScore = -Infinity;

    for (let cand = startCand; cand <= endCand; cand++) {
      const score = scoreTokenBoundary(tokens, cand, idealIdx, searchRadius);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = cand;
      }
    }

    splitIndices.push(bestIdx);
  }
  splitIndices.push(tokens.length);

  const projectedTexts: string[] = [];
  for (let k = 0; k < cueCount; k++) {
    const slice = tokens.slice(splitIndices[k], splitIndices[k + 1]).join(" ").trim();
    projectedTexts.push(slice);
  }

  // Validate completeness & non-emptiness
  const validation = validateProjectedCues(groupCues, projectedTexts, normalizedSpeech);
  return {
    projectedTexts,
    speechText: normalizedSpeech,
    reliable: validation.valid,
    needsReview: !validation.valid,
    reason: validation.reason,
  };
}

/**
 * Validates that projected cue texts:
 * 1. Match the exact count of groupCues and have zero empty strings.
 * 2. Reconstruct 100% of `speechText` tokens without dropping or duplicating words.
 * 3. Do not split numbers or leave invalid single-character fragments.
 */
export function validateProjectedCues(
  groupCues: OriginalCue[],
  projectedTexts: string[],
  speechText: string
): { valid: boolean; reason?: string } {
  if (projectedTexts.length !== groupCues.length) {
    return { valid: false, reason: "Số lượng đoạn chiếu ngược không khớp số cue." };
  }

  for (let i = 0; i < projectedTexts.length; i++) {
    const t = (projectedTexts[i] || "").trim();
    if (!t) {
      return { valid: false, reason: `Cue #${groupCues[i].index} bị rỗng sau khi chiếu ngược.` };
    }
  }

  const rejoined = joinCueTextsForSpeech(projectedTexts, false);
  const expectedClean = normalizeCueTextForSpeech(speechText);
  if (rejoined !== expectedClean) {
    return {
      valid: false,
      reason: "Nội dung ghép lại từ các cue không khớp tuyệt đối với văn bản đọc của nhóm.",
    };
  }

  return { valid: true };
}

/**
 * Re-synchronizes DubbingSpeechGroup[] with TranslatedCue[] so every group's `speechText`
 * and every cue's `groupId` / `subtitleText` / `speechFragmentText` are consistent.
 */
export function attachSpeechGroupsToTranslatedCues(
  originalCues: OriginalCue[],
  translatedCues: TranslatedCue[],
  groups: DubbingSpeechGroup[]
): {
  translatedCues: TranslatedCue[];
  speechGroups: DubbingSpeechGroup[];
} {
  const cueMap = new Map<number, TranslatedCue>();
  for (const tc of translatedCues) {
    cueMap.set(tc.index, { ...tc });
  }

  const updatedGroups: DubbingSpeechGroup[] = groups.map((g) => {
    const fragments: string[] = [];
    for (const cueId of g.sourceCueIds) {
      const tc = cueMap.get(cueId);
      if (tc) {
        tc.groupId = g.groupId;
        tc.subtitleText = tc.text;
        const frag = normalizeCueTextForSpeech(tc.speechFragmentText || tc.text);
        tc.speechFragmentText = frag;
        fragments.push(frag);
      }
    }
    const speechText =
      g.speechText && !g.isUserModified
        ? normalizeCueTextForSpeech(g.speechText)
        : joinCueTextsForSpeech(fragments, true);
    return {
      ...g,
      speechText,
    };
  });

  const updatedTranslatedCues = originalCues.map((orig) => {
    const existing = cueMap.get(orig.index);
    if (existing) return existing;
    return {
      index: orig.index,
      startSec: orig.startSec,
      endSec: orig.endSec,
      originalText: orig.text,
      text: orig.text,
      subtitleText: orig.text,
      speechFragmentText: normalizeCueTextForSpeech(orig.text),
      isEdited: false,
    };
  });

  return {
    translatedCues: updatedTranslatedCues,
    speechGroups: updatedGroups,
  };
}

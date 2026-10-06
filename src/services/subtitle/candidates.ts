import { SubtitleProfile } from "./types";
import { maskProtectedSpans } from "./protectedSpans";

export const STRONG_PUNCTUATION = [".", "?", "!", "…", "。"];
export const WEAKER_PUNCTUATION = [";", ":", "；", "："];
export const WEAKEST_PUNCTUATION = [",", "，", "、"];

export const CONJUNCTIONS = new Set([
  // English
  "and",
  "but",
  "or",
  "so",
  "because",
  "although",
  "though",
  "while",
  "when",
  "if",
  "however",
  "therefore",
  "meanwhile",
  "instead",
  "yet",
  "unless",
  // Vietnamese
  "và",
  "nhưng",
  "hoặc",
  "hay",
  "vì",
  "bởi_vì",
  "cho_nên",
  "nên",
  "mặc_dù",
  "tuy_nhiên",
  "do_đó",
  "nếu",
  "khi",
  "trong_khi",
  "để",
  "với",
  "cho",
  "tại",
  "về",
  "như",
  "rằng",
  "là",
  "thì",
  "mà",
]);

export const VIETNAMESE_COMPOUNDS = new Set([
  "mô hình",
  "giọng nói",
  "hệ thống",
  "thử nghiệm",
  "nhận diện",
  "bóc băng",
  "sản xuất",
  "nội dung",
  "âm thanh",
  "thời gian",
  "chính xác",
  "tiếng việt",
  "lồng tiếng",
  "lập tức",
  "quay trở lại",
  "tốc độ",
  "xử lý",
  "thời gian thực",
  "hôm nay",
  "chúng ta",
  "người dùng",
  "trên máy",
  "kịch bản",
  "phụ đề",
]);

export function isCompoundWordSplit(w1: string, w2: string): boolean {
  if (!w1 || !w2) return false;
  const clean1 = w1.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const clean2 = w2.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return VIETNAMESE_COMPOUNDS.has(`${clean1} ${clean2}`);
}

/**
 * Calculates display character width (double width for full-width/CJK characters).
 */
export function getDisplayWidth(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // East Asian wide / fullwidth character ranges
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Returns clean word count for a text string.
 */
export function getWordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/**
 * Splits raw text into sentence candidates using strong punctuation boundaries
 * (. ? ! …) while strictly respecting protected lexical spans (0.05, 15.000, $1,299.99, etc.).
 *
 * Blank lines (\n\n) or single newlines (\n) do NOT force cue creation.
 */
export function splitIntoSentences(rawText: string): string[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // Protect spans so that 0.05 or 15.000 are not split on '.'
  const { maskedText, restore } = maskProtectedSpans(trimmed);

  // Normalize internal line breaks and blank lines to single spaces
  const normalized = maskedText.replace(/\s*\n+\s*/g, " ");

  // Match strong sentence endings followed by space or end of text
  // e.g. "Sentence one. Sentence two!"
  const sentencePattern = /([^.!?…]+[.!?…]+["'”’»›)\]}]*|\S+)(?:\s+|$)/gu;
  const parts: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = sentencePattern.exec(normalized)) !== null) {
    const segment = match[1].trim();
    if (segment) {
      parts.push(restore(segment));
    }
  }

  // Fallback if regex didn't capture (e.g. no punctuation)
  if (parts.length === 0 && normalized.trim()) {
    parts.push(restore(normalized.trim()));
  }

  return parts;
}

/**
 * Splits a long sentence that exceeds profile constraints into natural clause candidates.
 *
 * Priority order:
 * 1. Semicolons / Colons (; :)
 * 2. Commas (,) - prioritizing splits before conjunctions (", but ...")
 * 3. Clause boundaries before conjunctions
 * 4. Safe word boundary fallback (avoiding number + unit or protected spans)
 */
export function splitLongSentenceIntoClauses(
  sentence: string,
  profile: SubtitleProfile
): string[] {
  const trimmed = sentence.trim();
  if (!trimmed) return [];

  const width = getDisplayWidth(trimmed);
  const words = getWordCount(trimmed);

  // If sentence comfortably fits within profile (considering multi-line capacity), DO NOT split!
  const maxCueWidth = profile.maxWidth * profile.maxLines;
  if (width <= maxCueWidth && words <= profile.maxWords) {
    return [trimmed];
  }

  const { maskedText, restore } = maskProtectedSpans(trimmed);

  // 1. Try splitting at Semicolon / Colon (; :)
  const semiColonMatches = Array.from(maskedText.matchAll(/([;:；：]+)(?:\s+|$)/gu));
  if (semiColonMatches.length > 0) {
    const clauses = splitAtBestMatch(maskedText, semiColonMatches, profile);
    if (clauses) {
      return clauses.flatMap((c) => splitLongSentenceIntoClauses(restore(c), profile));
    }
  }

  // 2. Try splitting at Commas (,), giving high bonus to splits before conjunctions
  const commaMatches = Array.from(maskedText.matchAll(/([,，、]+)\s+(?=\S)/gu));
  if (commaMatches.length > 0) {
    // Check if any comma is followed by a conjunction e.g. ", but", ", and", ", vì"
    const prioritizedMatches = [...commaMatches].sort((a, b) => {
      const aIndex = (a.index ?? 0) + a[0].length;
      const bIndex = (b.index ?? 0) + b[0].length;
      const aNextWord = maskedText.slice(aIndex).trim().split(/\s+/)[0]?.toLowerCase();
      const bNextWord = maskedText.slice(bIndex).trim().split(/\s+/)[0]?.toLowerCase();
      const aIsConj = aNextWord && CONJUNCTIONS.has(aNextWord) ? 1 : 0;
      const bIsConj = bNextWord && CONJUNCTIONS.has(bNextWord) ? 1 : 0;
      return bIsConj - aIsConj;
    });

    const clauses = splitAtBestMatch(maskedText, prioritizedMatches, profile);
    if (clauses) {
      return clauses.flatMap((c) => splitLongSentenceIntoClauses(restore(c), profile));
    }
  }

  // 3. Try splitting before conjunctions without comma
  const wordsList = maskedText.split(/\s+/);
  const midPoint = Math.floor(wordsList.length / 2);
  let bestConjIdx = -1;
  let minDistanceToCenter = 999;

  for (let i = 1; i < wordsList.length; i++) {
    // Never split inside compound words
    if (isCompoundWordSplit(wordsList[i - 1], wordsList[i])) {
      continue;
    }
    const w = wordsList[i].toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (CONJUNCTIONS.has(w)) {
      const dist = Math.abs(i - midPoint);
      if (dist < minDistanceToCenter) {
        minDistanceToCenter = dist;
        bestConjIdx = i;
      }
    }
  }

  if (bestConjIdx > 0) {
    const left = wordsList.slice(0, bestConjIdx).join(" ");
    const right = wordsList.slice(bestConjIdx).join(" "); // conjunction stays with right side!
    return [
      ...splitLongSentenceIntoClauses(restore(left), profile),
      ...splitLongSentenceIntoClauses(restore(right), profile),
    ];
  }

  // 4. Safe fallback: split at a grammatically sound word boundary (never inside compound words)
  if (wordsList.length >= 4) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 1; i < wordsList.length; i++) {
      // Disallow splitting inside compound words
      if (isCompoundWordSplit(wordsList[i - 1], wordsList[i])) {
        continue;
      }

      const dist = Math.abs(i - midPoint);
      let score = 100 - dist * 15;

      const w = wordsList[i].toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (CONJUNCTIONS.has(w) || ["để", "với", "cho", "tại", "về", "như", "trên", "khi"].includes(w)) {
        score += 50; // Bonus for conjunction/preposition boundary
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx > 0) {
      const left = wordsList.slice(0, bestIdx).join(" ");
      const right = wordsList.slice(bestIdx).join(" ");
      return [
        ...splitLongSentenceIntoClauses(restore(left), profile),
        ...splitLongSentenceIntoClauses(restore(right), profile),
      ];
    }
  }

  // If unbreakable, return original
  return [restore(maskedText)];
}

/**
 * Finds the candidate split match that creates the most balanced chunks closest to profile target.
 */
function splitAtBestMatch(
  text: string,
  matches: RegExpMatchArray[],
  profile: SubtitleProfile
): string[] | null {
  if (matches.length === 0) return null;

  let bestSplitIndex = -1;
  let bestScore = -Infinity;

  const targetWidth = profile.targetWidth;

  for (const m of matches) {
    const splitPoint = (m.index ?? 0) + m[1].length;
    const left = text.slice(0, splitPoint).trim();
    const right = text.slice(splitPoint).trim();

    if (!left || !right) continue;

    const leftWidth = getDisplayWidth(left);
    const rightWidth = getDisplayWidth(right);

    // Score based on distance to target width and balance
    const leftDiff = Math.abs(leftWidth - targetWidth);
    const balanceDiff = Math.abs(leftWidth - rightWidth);
    const score = -(leftDiff * 1.5 + balanceDiff);

    if (score > bestScore) {
      bestScore = score;
      bestSplitIndex = splitPoint;
    }
  }

  if (bestSplitIndex > 0) {
    const left = text.slice(0, bestSplitIndex).trim();
    const right = text.slice(bestSplitIndex).trim();
    return [left, right];
  }

  return null;
}

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

export const ENGLISH_COMPOUNDS = new Set([
  "instead of",
  "because of",
  "according to",
  "due to",
  "prior to",
  "thanks to",
  "such as",
  "as well",
  "at least",
  "at most",
  "at first",
  "at last",
  "up to",
  "out of",
  "in front",
  "in order",
  "in fact",
  "in case",
  "on board",
  "depend on",
  "depends on",
  "rely on",
  "relies on",
  "focus on",
  "focuses on",
  "based on",
  "look at",
  "looking at",
  "wait for",
  "waiting for",
  "wake up",
  "pick up",
  "picking up",
  "set up",
  "setting up",
  "shut down",
  "turn on",
  "turn off",
  "find out",
  "figure out",
  "work out",
  "point out",
  "carry out",
  "roll out",
  "sort out",
  "hand over",
  "take over",
  "each other",
  "one another",
  "even though",
  "even if",
  "as soon",
  "no longer",
  "right now",
  "per mile",
  "per hour",
  "per month",
  "per year",
  "per day",
  "a month",
  "a year",
  "a day",
  "an hour",
  "kilowatt hours",
  "kilowatt hour",
  "megawatt hours",
  "megawatt hour",
  "serve as",
  "serves as",
  "served as",
  "serving as",
  "come out",
  "comes out",
  "came out",
  "coming out",
  "lead to",
  "leads to",
  "led to",
  "neural network",
  "neural networks",
  "battery pack",
  "battery packs",
  "battery cell",
  "battery cells",
  "precision actuator",
  "precision actuators",
  "difficult component",
  "in-home care",
  "in home care",
  "in-home caregiver",
  "in home caregiver",
  "target price",
]);

export const REFLEXIVE_PRONOUNS = new Set([
  "itself",
  "himself",
  "herself",
  "themselves",
  "ourselves",
  "yourself",
  "yourselves",
  "myself",
]);

const ENTITY_DESIGNATOR_PREFIXES = new Set([
  "model",
  "optimus",
  "gen",
  "generation",
  "version",
  "option",
  "phase",
  "stage",
  "tier",
  "part",
  "section",
  "chapter",
  "figure",
  "step",
  "level",
  "type",
  "class",
  "grade",
  "mark",
  "block",
  "series",
]);

const NUMBER_UNIT_FOLLOWERS = new Set([
  "million",
  "billion",
  "trillion",
  "thousand",
  "hundred",
  "percent",
  "kwh",
  "kw",
  "mwh",
  "mw",
  "gwh",
  "gw",
  "gb",
  "tb",
  "mb",
  "kb",
  "hz",
  "khz",
  "mhz",
  "ghz",
  "mph",
  "km",
  "m",
  "cm",
  "mm",
  "kg",
  "g",
  "mg",
  "lbs",
  "pounds",
  "pound",
  "tons",
  "ton",
  "hours",
  "hour",
  "minutes",
  "minute",
  "seconds",
  "second",
  "days",
  "day",
  "weeks",
  "week",
  "months",
  "month",
  "years",
  "year",
  "miles",
  "mile",
  "meters",
  "meter",
  "feet",
  "foot",
  "dollars",
  "dollar",
  "cents",
  "cent",
  "kilowatt",
  "megawatt",
  "gigawatt",
]);

export function isCompoundWordSplit(w1: string, w2: string): boolean {
  if (!w1 || !w2) return false;
  // Never bridge across explicit punctuation at the end of w1
  if (/[.,;:!?…]$/u.test(w1.trim())) return false;
  const clean1 = w1.toLowerCase().replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, "");
  const clean2 = w2.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!clean1 || !clean2) return false;
  const pair = `${clean1} ${clean2}`;
  if (VIETNAMESE_COMPOUNDS.has(pair) || ENGLISH_COMPOUNDS.has(pair)) {
    return true;
  }
  if (REFLEXIVE_PRONOUNS.has(clean2)) {
    return true;
  }
  if (
    ENTITY_DESIGNATOR_PREFIXES.has(clean1) &&
    /^(\d+(\.\d+)?|[a-z]|i{1,3}|iv|v|vi{0,3}|one|two|three|four|five)$/i.test(clean2)
  ) {
    return true;
  }
  const isNumericOrRate1 =
    /^\$?\d+([.,]\d+)*%?$/.test(clean1) ||
    NUMBER_UNIT_FOLLOWERS.has(clean1) ||
    ["once", "twice", "thrice"].includes(clean1);
  if (isNumericOrRate1 && (NUMBER_UNIT_FOLLOWERS.has(clean2) || ["per", "a", "an"].includes(clean2))) {
    return true;
  }
  return false;
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

  // 3. Try splitting before conjunctions without comma (only when connecting two clauses or when neither side is a tight 2-noun pair)
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
      // Do not split a short coordinate noun pair like "vegetables and eggs" or "rau và trứng" at the end of a clause
      if (["and", "or", "và", "hay", "hoặc"].includes(w)) {
        const rightRemaining = wordsList.length - (i + 1);
        const nextWordClean =
          i + 1 < wordsList.length
            ? wordsList[i + 1].toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
            : "";
        if (rightRemaining <= 1 && !["then", "sau", "therefore", "so"].includes(nextWordClean)) {
          continue;
        }
      }
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

      const prevClean = wordsList[i - 1].toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (FORBIDDEN_ENDINGS.has(prevClean)) {
        score -= 250; // Never end a cue on a forbidden function word
      }

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

export const FORBIDDEN_ENDINGS = new Set([
  // English determiners, prepositions, auxiliaries, conjunctions, relatives, subject pronouns
  "a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our", "their",
  "of", "to", "for", "with", "from", "by", "at", "in", "on", "as", "into", "onto", "under", "over",
  "between", "among", "about", "around", "through", "across", "behind", "beyond", "per",
  "am", "is", "are", "was", "were", "be", "been", "being", "has", "have", "had", "do", "does", "did",
  "will", "would", "can", "could", "may", "might", "must", "should", "shall",
  "and", "but", "or", "so", "because", "although", "though", "while", "when", "if", "which", "who", "where",
  "i", "he", "she", "we", "they",
  // Vietnamese function words
  "và", "nhưng", "hoặc", "hay", "vì", "nên", "mà", "là", "của", "cho", "với", "tại", "trong", "trên",
  "dưới", "đến", "từ", "để", "khi", "nếu", "những", "các", "một", "đang", "sẽ", "đã", "vẫn", "rất",
]);

export function cleanWord(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/**
 * Normalizes common Blind ASR phonetic homophones and spurious possessives
 * in technical / robotics / energy transcripts when no reference script is provided.
 */
export function normalizeBlindAsrText(text: string): string {
  if (!text) return text;
  let result = text;
  if (/\b(optimus|tesla|robot|humanoid|actuator|battery)\b/i.test(result)) {
    result = result.replace(/\boptimists\b/gi, "Optimus").replace(/\boptimist\b/gi, "Optimus");
  }
  result = result.replace(
    /\b(water-resistant|water\s+resistant|waterproof|hermetic|environmental|dust|ip6[78])\s+ceiling([.,;:!?]?)/gi,
    "$1 sealing$2"
  );
  // Strip spurious "'s" only when NOT preceded by a preposition/determiner ("At Tesla's stated $20,000")
  // and when followed by a clause/complement introducer ("that", "how", "why", "the", "a", etc.)
  result = result.replace(
    /(^|[.,;:!?]\s+|\b(?:interviews|reports|statements),\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)['’]s\s+(emphasized|explained|stated|noted|said|shared|acknowledged|confirmed|announced|revealed|warned|argued|predicted|pointed|added|claimed|suggested)\s+(that|how|why|whether|what|if|when|where|who|to|the|a|an|his|her|its|their|our|this|these|those|he|she|it|they|we|you|there|one)\b/g,
    "$1$2 $3 $4"
  );
  // Heal false ASR comma in "such as the <Noun>, <Noun/Verb> <Preposition>"
  result = result.replace(
    /\b(such\s+as\s+(?:the|a|an)\s+[A-Za-z0-9-]+),\s+([a-z]+\s+(?:at|in|on|from|for|with|by|during|inside|into))\b/gi,
    "$1 $2"
  );
  // Plural non-restrictive relative clause agreement: "<plural noun>, which offers" -> "which offer"
  result = result.replace(
    /\b(cells|batteries|actuators|sensors|motors|robots|vehicles|cars|trucks|packs|panels|rates|grids|bills|homes|families|parents|insiders),\s+which\s+offers\b/gi,
    "$1, which offer"
  );
  return result;
}

/**
 * Wraps a subtitle cue text into 1 or 2 balanced lines strictly <= profile.maxWidth
 * when possible, avoiding forbidden endings, protected spans, and compound word splits.
 */
export function wrapCueTextBalanced(text: string, profile: SubtitleProfile): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || profile.maxLines <= 1) return normalized;

  const totalWidth = getDisplayWidth(normalized);
  if (totalWidth <= profile.targetWidth) {
    return normalized;
  }

  const { maskedText, restore } = maskProtectedSpans(normalized);
  const words = maskedText.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return normalized;

  let bestSplit = -1;
  let bestScore = Infinity;

  for (let i = 1; i < words.length; i++) {
    const rawLine1 = restore(words.slice(0, i).join(" "));
    const rawLine2 = restore(words.slice(i).join(" "));
    const w1 = getDisplayWidth(rawLine1);
    const w2 = getDisplayWidth(rawLine2);

    const overflow = Math.max(0, w1 - profile.maxWidth) + Math.max(0, w2 - profile.maxWidth);
    let score = Math.abs(w1 - w2) * 3.0 + overflow * 200;

    if (words.length >= 3 && (i === 1 || i === words.length - 1)) {
      score += 900;
    }

    if (isCompoundWordSplit(words[i - 1], words[i])) {
      score += 5000;
    }
    const leftRaw = restore(words[i - 1]).trim();
    const leftLastToken = leftRaw.split(/\s+/).pop() || leftRaw;
    const rightFirstToken = restore(words[i]).trim().split(/\s+/)[0] || "";
    const leftClean = cleanWord(leftLastToken);
    const rightClean = cleanWord(rightFirstToken);

    const isCopulaBeforeThat =
      ["is", "was", "are", "were"].includes(leftClean) &&
      ["that", "whether", "what", "why", "how", "where", "when", "who"].includes(rightClean);
    const isDeterminerBeforeLongWord =
      ["a", "an", "the", "this", "that", "its", "their", "our", "your"].includes(leftClean) &&
      getDisplayWidth(rightFirstToken) >= 15;

    if (/[.,;:!?…]$/u.test(leftRaw)) {
      score -= 40;
    } else if (isDeterminerBeforeLongWord) {
      score += 80;
    } else if (FORBIDDEN_ENDINGS.has(leftClean) && !isCopulaBeforeThat) {
      score += 1800;
    } else if (isCopulaBeforeThat) {
      score -= 20;
    }

    // Protect short coordinate noun pair at the end of a cue (e.g. "tables and chairs")
    if (
      ["and", "or", "và", "hay", "hoặc"].includes(rightClean) &&
      words.length - i === 2 &&
      !FORBIDDEN_ENDINGS.has(leftClean) &&
      !/[.,;:!?…]$/u.test(leftRaw)
    ) {
      score += 240;
    } else if (CONJUNCTIONS.has(rightClean)) {
      score -= 30;
    } else if (["from", "in", "on", "to", "for", "with", "into", "across", "through"].includes(rightClean)) {
      score -= 20;
    }

    if (["you", "it", "i", "he", "she", "we", "they", "who"].includes(leftClean)) {
      score += 350;
    }

    if (w1 < 6 || w2 < 6) {
      score += 250;
    } else if (w1 < 11 || w2 < 11) {
      score += 80;
    }

    if (score < bestScore) {
      bestScore = score;
      bestSplit = i;
    }
  }

  if (totalWidth <= profile.maxWidth) {
    const singleLineScore = (totalWidth - profile.targetWidth) * 4.0;
    if (bestSplit <= 0 || singleLineScore <= bestScore) {
      return normalized;
    }
  }

  if (bestSplit > 0) {
    const line1 = restore(words.slice(0, bestSplit).join(" "));
    const line2 = restore(words.slice(bestSplit).join(" "));
    return `${line1}\n${line2}`;
  }
  return normalized;
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

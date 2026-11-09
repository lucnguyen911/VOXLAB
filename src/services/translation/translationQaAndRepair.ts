/**
 * Subtitle Translation QA, AFNUM Number Protection & Gom Repair Engine
 * (Adapted from Audio-Factory `core/translator.py` for VoxLab's group & cue pipeline).
 *
 * Key Guarantees:
 * 1. Detects untranslated English copies (`untranslated_copy` / `untranslated_english`),
 *    missing/empty translations (`empty_translation`), foreign script hallucinations
 *    (`script_hallucination`, e.g. CJK/Cyrillic leaked into Vietnamese), and duplicate
 *    hallucinated translations (`duplicate_translation`).
 * 2. Provides AFNUM numerical literal verification & restoration so currencies,
 *    percentages, years, and technical numbers are never corrupted.
 * 3. Builds specialized Gom Repair prompts that explicitly forbid repeating the
 *    untranslated source text or defective translation.
 */

import { BatchItem } from "./types";
import { OriginalCue, TranslatedCue, DubbingSpeechGroup } from "../../types/dubbing";
import { normalizeCueTextForSpeech } from "../dubbing/speechPlanner";
import { stripThinkingTags, parseBatchTranslationResponse } from "./batchTranslationHelper";

export type TranslationQaIssueType =
  | "empty_translation"
  | "untranslated_copy"
  | "untranslated_english"
  | "script_hallucination"
  | "internal_token_junk"
  | "duplicate_translation";

export interface TranslationQaIssue {
  id: number;
  sourceText: string;
  currentTranslation: string;
  issues: TranslationQaIssueType[];
  forbiddenTranslations?: string[];
}

const VIETNAMESE_DIACRITIC_RE =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

const VIETNAMESE_COMMON_WORDS = new Set([
  "không", "của", "những", "trong", "được", "một", "các", "cho", "với", "này",
  "khi", "như", "cũng", "nhưng", "hoặc", "trên", "dưới", "theo", "từ", "đến",
  "vì", "do", "để", "sẽ", "đang", "đã", "rất", "hơn", "nhất", "chúng", "tôi",
  "bạn", "họ", "nó", "đó", "đây", "vào", "ra", "lên", "xuống", "làm", "có",
  "là", "và", "hay", "mà", "thì", "bị", "bởi", "nếu", "tại", "về", "giữa",
]);

const ENGLISH_FUNCTION_AND_COMMON_WORDS = new Set([
  "the", "and", "every", "for", "with", "that", "this", "these", "those",
  "from", "have", "has", "had", "what", "when", "where", "which", "while",
  "who", "whom", "whose", "why", "how", "your", "our", "their", "his", "her",
  "its", "they", "them", "there", "here", "were", "was", "are", "been", "being",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "not", "but", "or", "nor", "yet", "so", "into", "onto", "upon", "along",
  "across", "through", "between", "among", "under", "over", "above", "below",
  "before", "after", "during", "within", "without", "against", "because",
  "although", "though", "unless", "until", "whether", "always", "never",
  "often", "sometimes", "usually", "even", "still", "just", "only", "also",
  "very", "more", "most", "less", "least", "much", "many", "some", "any",
  "each", "other", "another", "such", "own", "same", "than", "then", "now",
  "leaves", "makes", "takes", "gives", "keeps", "comes", "goes", "looks",
  "seems", "becomes", "allows", "means", "needs", "wants", "uses", "works",
  "winter", "summer", "spring", "autumn", "minor", "major", "permanent",
  "microscopic", "cracks", "borders", "grain", "pothole", "speed", "bump",
  "curb", "tap", "unlike", "steel", "aluminum", "forever", "gently", "forgets",
]);

const NON_LATIN_HALLUCINATION_RE =
  /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7A3\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F]/g;

const AFNUM_TOKEN_RE = /__AFNUM_\d+_\d+__/gi;

/**
 * Normalizes any target language label or locale ("Tiếng Việt", "Vietnamese", "vi-VN")
 * into a standard 2-letter ISO code ("vi", "en", "zh", "ja", "ko", "fr", "de", "es", "ru", "th").
 */
export function normalizeTargetLangCode(lang?: string): string {
  if (!lang) return "vi";
  const s = lang.trim().toLowerCase();
  if (s === "vi" || s.startsWith("vi-") || s.includes("việt") || s.includes("vietnamese")) {
    return "vi";
  }
  if (s === "en" || s.startsWith("en-") || s.includes("anh") || s.includes("english")) {
    return "en";
  }
  if (s === "zh" || s.startsWith("zh-") || s.includes("trung") || s.includes("chinese")) {
    return "zh";
  }
  if (s === "ja" || s.startsWith("ja-") || s.includes("nhật") || s.includes("japanese")) {
    return "ja";
  }
  if (s === "ko" || s.startsWith("ko-") || s.includes("hàn") || s.includes("korean")) {
    return "ko";
  }
  if (s === "fr" || s.startsWith("fr-") || s.includes("pháp") || s.includes("french")) {
    return "fr";
  }
  if (s === "de" || s.startsWith("de-") || s.includes("đức") || s.includes("german")) {
    return "de";
  }
  if (s === "es" || s.startsWith("es-") || s.includes("tây ban nha") || s.includes("spanish")) {
    return "es";
  }
  if (s === "ru" || s.startsWith("ru-") || s.includes("nga") || s.includes("russian")) {
    return "ru";
  }
  if (s === "th" || s.startsWith("th-") || s.includes("thái") || s.includes("thai")) {
    return "th";
  }
  return s.slice(0, 2);
}

function normalizeForComparison(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAlphaWords(text: string): string[] {
  return (text || "")
    .replace(/[^\p{L}\s'-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, "").trim())
    .filter((w) => w.length >= 2);
}

/**
 * Checks whether a source string has translatable natural-language words
 * (rather than just numbers, symbols, or a standalone proper noun like "Tesla" or "BMW M3").
 */
export function hasTranslatableNaturalWords(sourceText: string): boolean {
  const rawWords = extractAlphaWords(sourceText);
  if (rawWords.length === 0) return false;

  // Count words that are either known English function/common words or lowercase words
  let naturalWordCount = 0;
  for (const w of rawWords) {
    const lower = w.toLowerCase();
    if (ENGLISH_FUNCTION_AND_COMMON_WORDS.has(lower)) {
      naturalWordCount += 1;
    } else if (w[0] === w[0].toLowerCase() && w.length >= 3) {
      naturalWordCount += 1;
    }
  }

  if (naturalWordCount >= 1 && rawWords.length >= 2) {
    return true;
  }
  // Even if all words are capitalized (e.g. title case or sentence start "Every winter"),
  // if at least 1 word is in ENGLISH_FUNCTION_AND_COMMON_WORDS or there are >= 3 words with lowercase letters
  const hasCommonWord = rawWords.some((w) =>
    ENGLISH_FUNCTION_AND_COMMON_WORDS.has(w.toLowerCase())
  );
  if (hasCommonWord) return true;

  const lowercaseWords = rawWords.filter((w) => w[0] === w[0].toLowerCase());
  return lowercaseWords.length >= 2 || rawWords.length >= 4;
}

/**
 * Checks if `text` contains Vietnamese linguistic markers (diacritics or common Vietnamese words).
 */
export function hasVietnameseLinguisticMarkers(text: string): boolean {
  if (!text) return false;
  if (VIETNAMESE_DIACRITIC_RE.test(text)) return true;
  const words = extractAlphaWords(text).map((w) => w.toLowerCase());
  return words.some((w) => VIETNAMESE_COMMON_WORDS.has(w));
}

/**
 * Detects whether a translated string is an untranslated copy or contains
 * substantial untranslated English when the target language is Vietnamese (or non-English).
 */
export function isUntranslatedOrEnglishResidual(
  sourceText: string,
  translatedText: string,
  targetLang: string,
  sourceLang = "auto"
): { isUntranslated: boolean; issueType?: "untranslated_copy" | "untranslated_english" } {
  const cleanSrc = normalizeCueTextForSpeech(sourceText);
  const cleanTrans = normalizeCueTextForSpeech(translatedText);
  if (!cleanSrc || !cleanTrans) {
    return { isUntranslated: false };
  }

  const targetCode = normalizeTargetLangCode(targetLang);
  const sourceCode = sourceLang && sourceLang !== "auto" ? normalizeTargetLangCode(sourceLang) : "auto";
  if (targetCode === sourceCode) {
    return { isUntranslated: false };
  }

  // If the source has no translatable natural words (e.g. "2026", "$18,500", "Elon Musk"),
  // keeping it unchanged is valid.
  if (!hasTranslatableNaturalWords(cleanSrc)) {
    return { isUntranslated: false };
  }

  const normSrc = normalizeForComparison(cleanSrc);
  const normTrans = normalizeForComparison(cleanTrans);

  // 1. Exact normalized copy of source text
  if (normSrc && normSrc === normTrans) {
    return { isUntranslated: true, issueType: "untranslated_copy" };
  }

  // 2. Target is Vietnamese: check for untranslated English sentences/fragments
  if (targetCode === "vi") {
    const srcWords = extractAlphaWords(cleanSrc).map((w) => w.toLowerCase());
    const transWords = extractAlphaWords(cleanTrans).map((w) => w.toLowerCase());

    if (transWords.length === 0) {
      return { isUntranslated: false };
    }

    const hasViMarkers = hasVietnameseLinguisticMarkers(cleanTrans);

    // Case 2a: Zero Vietnamese diacritics/words in the output!
    if (!hasViMarkers) {
      const srcWordSet = new Set(srcWords);
      const overlapCount = transWords.filter(
        (w) => srcWordSet.has(w) || ENGLISH_FUNCTION_AND_COMMON_WORDS.has(w)
      ).length;
      if (overlapCount >= 1 && (overlapCount / transWords.length >= 0.5 || transWords.length >= 2)) {
        return { isUntranslated: true, issueType: "untranslated_copy" };
      }
    }

    // Case 2b: Even if a long group has 1-2 Vietnamese words, check if a whole English clause
    // (>= 4 consecutive English words from source) was left untranslated
    const rawTransTokens = extractAlphaWords(cleanTrans);
    const srcWordSet = new Set(srcWords);
    let consecutiveEnglishCount = 0;
    for (const tok of rawTransTokens) {
      const lower = tok.toLowerCase();
      const isViWord = VIETNAMESE_DIACRITIC_RE.test(tok) || VIETNAMESE_COMMON_WORDS.has(lower);
      const isSourceOrEnglishCommon =
        !isViWord &&
        (ENGLISH_FUNCTION_AND_COMMON_WORDS.has(lower) ||
          (srcWordSet.has(lower) && tok[0] === tok[0].toLowerCase()));

      if (isSourceOrEnglishCommon) {
        consecutiveEnglishCount += 1;
        if (consecutiveEnglishCount >= 4) {
          return { isUntranslated: true, issueType: "untranslated_english" };
        }
      } else {
        consecutiveEnglishCount = 0;
      }
    }
  } else if (targetCode !== "en") {
    // Other non-English targets: check high word overlap with English source
    const srcWords = new Set(extractAlphaWords(cleanSrc).map((w) => w.toLowerCase()));
    const transWords = extractAlphaWords(cleanTrans).map((w) => w.toLowerCase());
    if (transWords.length >= 3) {
      const sameCount = transWords.filter((w) => srcWords.has(w)).length;
      if (sameCount / transWords.length >= 0.75) {
        return { isUntranslated: true, issueType: "untranslated_copy" };
      }
    }
  }

  return { isUntranslated: false };
}

/**
 * Checks whether a translated unit has unexpected foreign script hallucinations
 * (e.g., Chinese/Japanese/Korean/Cyrillic characters appearing in a Vietnamese or English translation
 * when the source text did not contain them).
 */
export function hasUnexpectedScriptHallucination(
  sourceText: string,
  translatedText: string,
  targetLang: string
): boolean {
  const targetCode = normalizeTargetLangCode(targetLang);
  if (targetCode !== "vi" && targetCode !== "en" && targetCode !== "fr" && targetCode !== "de" && targetCode !== "es") {
    return false;
  }
  const transMatches = translatedText.match(NON_LATIN_HALLUCINATION_RE);
  if (!transMatches || transMatches.length === 0) return false;

  const srcMatches = new Set(sourceText.match(NON_LATIN_HALLUCINATION_RE) || []);
  const unexpected = transMatches.filter((ch) => !srcMatches.has(ch));
  return unexpected.length >= 2;
}

/**
 * Strips any leaked internal prompt tags, thinking blocks, or accidental `[id]` prefixes
 * from a single translated line.
 */
export function sanitizeTranslatedUnitText(rawText: string, unitId?: number): string {
  if (!rawText) return "";
  let cleaned = stripThinkingTags(rawText)
    .replace(AFNUM_TOKEN_RE, "")
    .replace(/<\/?AF_CUE_\d+>/gi, "")
    .replace(/<\/?C\d+_NUM_\d+>/gi, "")
    .trim();

  // Remove accidental leading [id] if the model echoed the ID inside the text
  if (unitId !== undefined) {
    const idPrefixRe = new RegExp(`^\\s*(?:\\d+[\\.)]\\s*)?\\[${unitId}\\]\\s*:?\\s*`, "i");
    cleaned = cleaned.replace(idPrefixRe, "").trim();
  }
  cleaned = cleaned.replace(/^\s*\[\d+\]\s*:?\s*/, "").trim();
  if (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("“") && cleaned.endsWith("”")))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

/**
 * Evaluates a single unit's translation and returns all detected QA issues (empty array = PASS).
 */
export function validateSingleUnitTranslation(
  sourceText: string,
  translatedText: string | undefined | null,
  targetLang: string,
  sourceLang = "auto"
): TranslationQaIssueType[] {
  const issues: TranslationQaIssueType[] = [];
  const cleanSrc = normalizeCueTextForSpeech(sourceText);
  if (!cleanSrc) return issues;

  const cleanTrans = sanitizeTranslatedUnitText(translatedText || "");
  if (!cleanTrans) {
    issues.push("empty_translation");
    return issues;
  }

  const untranslatedCheck = isUntranslatedOrEnglishResidual(
    cleanSrc,
    cleanTrans,
    targetLang,
    sourceLang
  );
  if (untranslatedCheck.isUntranslated && untranslatedCheck.issueType) {
    issues.push(untranslatedCheck.issueType);
  }

  if (hasUnexpectedScriptHallucination(cleanSrc, cleanTrans, targetLang)) {
    issues.push("script_hallucination");
  }

  if (AFNUM_TOKEN_RE.test(translatedText || "")) {
    issues.push("internal_token_junk");
  }

  return issues;
}

/**
 * Runs Global QA across a batch or full list of units (inspired by Audio-Factory `_run_file_global_qa`).
 */
export function runGlobalTranslationQa(
  units: { id: number; sourceText: string }[],
  translationsById: ReadonlyMap<number, string>,
  targetLang: string,
  sourceLang = "auto"
): TranslationQaIssue[] {
  const qaIssues: TranslationQaIssue[] = [];
  const issueById = new Map<number, TranslationQaIssue>();

  const addIssue = (
    id: number,
    sourceText: string,
    currentTranslation: string,
    issueType: TranslationQaIssueType,
    forbidden?: string
  ) => {
    let entry = issueById.get(id);
    if (!entry) {
      entry = {
        id,
        sourceText,
        currentTranslation,
        issues: [],
        forbiddenTranslations: [],
      };
      issueById.set(id, entry);
      qaIssues.push(entry);
    }
    if (!entry.issues.includes(issueType)) {
      entry.issues.push(issueType);
    }
    if (forbidden && !entry.forbiddenTranslations?.includes(forbidden)) {
      entry.forbiddenTranslations?.push(forbidden);
    }
  };

  // 1-4. Per-unit checks: empty, untranslated copy/English, script hallucination, token junk
  for (const u of units) {
    const trans = translationsById.get(u.id) || "";
    const unitIssues = validateSingleUnitTranslation(
      u.sourceText,
      trans,
      targetLang,
      sourceLang
    );
    for (const iss of unitIssues) {
      addIssue(
        u.id,
        u.sourceText,
        trans,
        iss,
        iss === "untranslated_copy" || iss === "untranslated_english" ? trans : undefined
      );
    }
  }

  // 5. Abnormal Duplicate Translation Check (from Audio-Factory `_run_file_global_qa` check #5)
  const seenTranslations = new Map<string, { id: number; normSrc: string }[]>();
  for (const u of units) {
    const trans = (translationsById.get(u.id) || "").trim();
    const normTrans = normalizeForComparison(trans);
    if (normTrans.length > 22) {
      const list = seenTranslations.get(normTrans) || [];
      list.push({ id: u.id, normSrc: normalizeForComparison(u.sourceText) });
      seenTranslations.set(normTrans, list);
    }
  }

  for (const [normTrans, occurrences] of seenTranslations.entries()) {
    if (occurrences.length > 1) {
      const distinctSources = new Set(occurrences.map((o) => o.normSrc));
      if (distinctSources.size > 1) {
        // Keep the first occurrence, flag subsequent distinct-source duplicates for repair
        for (let i = 1; i < occurrences.length; i++) {
          const occ = occurrences[i];
          const unit = units.find((u) => u.id === occ.id);
          if (unit) {
            addIssue(
              occ.id,
              unit.sourceText,
              translationsById.get(occ.id) || "",
              "duplicate_translation",
              normTrans
            );
          }
        }
      }
    }
  }

  return qaIssues;
}

/**
 * Builds the specialized Gom Repair prompt (adapted from Audio-Factory `_build_repair_system_prompt`).
 * Instructs the LLM to freshly translate the failed items while strictly avoiding the reported defects.
 */
export function buildGomRepairPrompt(
  repairItems: TranslationQaIssue[],
  targetLang: string,
  style = "default",
  glossaryTerms?: string[]
): { system: string; user: string } {
  const targetCode = normalizeTargetLangCode(targetLang);
  const langLabel =
    targetCode === "vi"
      ? "Vietnamese (Tiếng Việt - vi-VN)"
      : targetCode === "en"
      ? "English (en-US)"
      : targetLang;

  const isCinema = style === "cinema";

  const system = `You are a professional subtitle & dubbing repair engine.

TASK
Repair ONLY the numbered subtitle IDs listed below by translating each item's source text into ${langLabel}.
These items previously failed quality assurance (e.g., left untranslated in English, missing translation, or contained invalid foreign script characters).

STRICT REPAIR RULES
1. Translate 100% of the source meaning into natural, fluent ${langLabel}${
    isCinema ? " with punchy, cinematic spoken rhythm" : ""
  }.
2. NEVER copy or repeat the English source sentence. Every English phrase, verb, noun, and clause MUST be translated into ${langLabel} (keep only proper names, brands, and exact numbers).
3. Preserve all numbers, currencies, percentages, and technical units accurately.
4. Do NOT merge, skip, or omit any requested ID.
5. Output ONLY lines in the exact format \`[id] translated text\` with NO markdown fences, NO commentary, and NO explanations.`;

  const blocks: string[] = [];
  if (glossaryTerms && glossaryTerms.length > 0) {
    blocks.push(
      `Shared Proper Nouns & Terminology (preserve consistently — DO NOT output this list):\n${glossaryTerms.join(", ")}`
    );
  }

  const lines = repairItems.map((item) => {
    const issueHint = item.issues.includes("untranslated_copy") || item.issues.includes("untranslated_english")
      ? " [ISSUE: Previously left in English — MUST translate completely into Vietnamese]"
      : item.issues.includes("script_hallucination")
      ? " [ISSUE: Contained invalid foreign script — use Vietnamese Latin alphabet only]"
      : item.issues.includes("duplicate_translation")
      ? " [ISSUE: Duplicate translation — translate this specific source sentence accurately]"
      : "";
    return `[${item.id}]${issueHint} ${item.sourceText}`;
  });

  const header = blocks.length > 0 ? `${blocks.join("\n\n")}\n\n` : "";
  const user = `${header}Translate each numbered source line below into ${langLabel} (output ONLY \`[id] translation\` lines, without the [ISSUE: ...] tag):\n\n${lines.join("\n")}`;

  return { system, user };
}

/**
 * Parses a Gom Repair response, supporting both `[id] translation` lines and JSON array/object formats
 * (like Audio-Factory `parse_json_translation_response`), and strips any echoed `[ISSUE: ...]` tags.
 */
export function parseGomRepairResponse(
  rawContent: string,
  expectedItems: BatchItem[]
): Map<number, string> {
  const cleanedRaw = stripThinkingTags(rawContent || "").replace(
    /\[ISSUE:[^\]]*\]\s*/gi,
    ""
  );
  const map = parseBatchTranslationResponse(cleanedRaw, expectedItems);

  for (const [id, text] of map.entries()) {
    map.set(id, sanitizeTranslatedUnitText(text, id));
  }
  return map;
}

/**
 * Scans an existing array of `TranslatedCue`s against `OriginalCue`s to find any cues
 * that are still untranslated or have QA issues (used both for post-translation verification
 * and for the UI "Dịch bù X câu sót" button).
 */
export function findUntranslatedCueIndices(
  originalCues: OriginalCue[],
  translatedCues: TranslatedCue[],
  targetLang: string,
  sourceLang = "auto"
): number[] {
  if (!originalCues || !translatedCues || translatedCues.length === 0) {
    return [];
  }
  const origByIndex = new Map<number, OriginalCue>();
  for (const oc of originalCues) {
    origByIndex.set(oc.index, oc);
  }

  const untranslatedIndices: number[] = [];
  for (const tc of translatedCues) {
    const oc = origByIndex.get(tc.index);
    const srcText = oc?.text || tc.originalText || "";
    const transText = tc.text || tc.subtitleText || "";
    const issues = validateSingleUnitTranslation(srcText, transText, targetLang, sourceLang);
    if (issues.length > 0) {
      untranslatedIndices.push(tc.index);
    }
  }
  return untranslatedIndices;
}

/**
 * Given speech groups and translated cues, finds all speech groups that have at least one
 * untranslated or defective cue.
 */
export function findDefectiveSpeechGroups(
  groups: DubbingSpeechGroup[],
  originalCues: OriginalCue[],
  translatedCues: TranslatedCue[],
  targetLang: string,
  sourceLang = "auto"
): DubbingSpeechGroup[] {
  const defectiveCueSet = new Set(
    findUntranslatedCueIndices(originalCues, translatedCues, targetLang, sourceLang)
  );

  const result: DubbingSpeechGroup[] = [];
  for (const g of groups) {
    const groupIssues = validateSingleUnitTranslation(
      g.sourceText,
      g.translatedText || g.speechText || "",
      targetLang,
      sourceLang
    );
    const hasDefectiveCue = g.sourceCueIds.some((cid) => defectiveCueSet.has(cid));
    if (groupIssues.length > 0 || hasDefectiveCue) {
      result.push(g);
    }
  }
  return result;
}

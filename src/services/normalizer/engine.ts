import { NormalizationResult, NormalizerGroupId } from "./types";
import { NORMALIZER_GROUPS, ALL_NORMALIZER_GROUPS, GROUP_APPLY_MAP, ORDERED_GROUP_IDS } from "./rules";
import { computeTokenDiff, computeWordDelta, computeCharDelta } from "./diff";
import {
  matchAndProtectPronunciations,
  restorePronunciations,
  getEffectiveRules,
  PronunciationRule,
} from "../pronunciation";

const STORAGE_KEY = "voxlab_normalization_enabled_groups";

export interface NormalizeOptions {
  pronunciationRules?: PronunciationRule[];
  projectId?: string;
}

/**
 * Returns default enabled group IDs (all 4 safe groups).
 */
export function getDefaultEnabledGroupIds(): NormalizerGroupId[] {
  return NORMALIZER_GROUPS.filter((g) => g.defaultEnabled).map((g) => g.id);
}

/**
 * Returns all available group IDs including custom pronunciation Option 5.
 */
export function getAllGroupIds(): NormalizerGroupId[] {
  return ALL_NORMALIZER_GROUPS.map((g) => g.id);
}

/**
 * Loads saved group selection from localStorage, falling back to defaults if not found or invalid.
 */
export function loadSavedGroupIds(): NormalizerGroupId[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return getDefaultEnabledGroupIds();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultEnabledGroupIds();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = new Set(getAllGroupIds());
      const filtered = parsed.filter((id): id is NormalizerGroupId => valid.has(id));
      return filtered.length > 0 ? filtered : getDefaultEnabledGroupIds();
    }
  } catch {
    // Fallback to default
  }
  return getDefaultEnabledGroupIds();
}

/**
 * Saves group selection to localStorage.
 */
export function saveGroupIds(groupIds: NormalizerGroupId[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(groupIds));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Executes normalization pipeline starting strictly from originalText using enabledGroupIds.
 * Guaranteed to be deterministic, pure, and free of accumulation errors.
 */
export function normalizeText(
  originalText: string,
  enabledGroupIds: NormalizerGroupId[],
  options?: NormalizeOptions
): NormalizationResult {
  const enabledSet = new Set(enabledGroupIds);
  let currentText = originalText;
  let replacements = new Map<string, string>();

  // If Option 5 (Phát âm tùy chỉnh) is ON: detect custom pronunciation matches on original source
  // and protect spans from generic normalizers (Options 1-4)
  if (enabledSet.has("pronunciation")) {
    const rules =
      options?.pronunciationRules ?? getEffectiveRules(options?.projectId);
    const matchResult = matchAndProtectPronunciations(currentText, rules);
    currentText = matchResult.protectedText;
    replacements = matchResult.replacements;
  }

  // Apply enabled groups 1-4 in fixed, deterministic order
  for (const groupId of ORDERED_GROUP_IDS) {
    if (enabledSet.has(groupId) && GROUP_APPLY_MAP[groupId]) {
      currentText = GROUP_APPLY_MAP[groupId](currentText);
    }
  }

  // If Option 5 is ON: restore protected placeholders with designated spoken replacements
  if (enabledSet.has("pronunciation") && replacements.size > 0) {
    currentText = restorePronunciations(currentText, replacements);
  }

  const normalizedText = currentText;
  const hasChanges = normalizedText !== originalText;

  // Words count helper
  const countWords = (str: string): number => {
    const trimmed = str.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  };

  const originalChars = originalText.length;
  const normalizedChars = normalizedText.length;
  const originalWords = countWords(originalText);
  const normalizedWords = countWords(normalizedText);

  // Compute token diff for visual presentation
  if (!hasChanges) {
    return {
      originalText,
      normalizedText,
      enabledGroupIds,
      hasChanges: false,
      totalChanges: 0,
      originalChars,
      normalizedChars,
      originalWords,
      normalizedWords,
      addedWords: 0,
      deletedWords: 0,
      addedChars: 0,
      deletedChars: 0,
      diffBefore: [{ text: originalText, type: "equal" }],
      diffAfter: [{ text: normalizedText, type: "equal" }],
    };
  }

  const { diffBefore, diffAfter, changeCount } = computeTokenDiff(
    originalText,
    normalizedText
  );

  const { addedWords, deletedWords } = computeWordDelta(diffBefore, diffAfter);
  const { addedChars, deletedChars } = computeCharDelta(diffBefore, diffAfter);

  return {
    originalText,
    normalizedText,
    enabledGroupIds,
    hasChanges: true,
    totalChanges: changeCount,
    originalChars,
    normalizedChars,
    originalWords,
    normalizedWords,
    addedWords,
    deletedWords,
    addedChars,
    deletedChars,
    diffBefore,
    diffAfter,
  };
}

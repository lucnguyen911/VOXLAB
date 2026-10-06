import { TranslationSettings } from "./types";

export const TRANSLATION_SETTINGS_KEY = "voxlab_translation_settings";

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  sourceLanguage: "auto",
  targetLanguage: "vi",
  translationProviderId: "google",
  geminiApiKey: "",
  deepseekApiKey: "",
  customModels: [],
  autoTranslate: false,
  translationStyle: "default",
};

/**
 * Loads TranslationSettings from localStorage with safe fallback to defaults.
 */
export function loadTranslationSettings(): TranslationSettings {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_TRANSLATION_SETTINGS };
  }

  try {
    const raw = localStorage.getItem(TRANSLATION_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_TRANSLATION_SETTINGS };

    const parsed = JSON.parse(raw);
    return {
      sourceLanguage: parsed.sourceLanguage || DEFAULT_TRANSLATION_SETTINGS.sourceLanguage || "auto",
      targetLanguage: parsed.targetLanguage || DEFAULT_TRANSLATION_SETTINGS.targetLanguage,
      translationProviderId: parsed.translationProviderId || DEFAULT_TRANSLATION_SETTINGS.translationProviderId,
      geminiApiKey: parsed.geminiApiKey || "",
      deepseekApiKey: parsed.deepseekApiKey || "",
      customModels: Array.isArray(parsed.customModels) ? parsed.customModels : [],
      autoTranslate: typeof parsed.autoTranslate === "boolean" ? parsed.autoTranslate : false,
      translationStyle: parsed.translationStyle === "cinema" ? "cinema" : "default",
    };
  } catch (err) {
    console.warn("Failed to load translation settings, using defaults:", err);
    return { ...DEFAULT_TRANSLATION_SETTINGS };
  }
}

/**
 * Saves partial or complete TranslationSettings into localStorage.
 */
export function saveTranslationSettings(settings: Partial<TranslationSettings>): TranslationSettings {
  const current = loadTranslationSettings();
  const updated: TranslationSettings = {
    ...current,
    ...settings,
    customModels: settings.customModels !== undefined ? settings.customModels : current.customModels,
  };

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(TRANSLATION_SETTINGS_KEY, JSON.stringify(updated));
    } catch (err) {
      console.warn("Failed to save translation settings to localStorage:", err);
    }
  }

  return updated;
}

/**
 * Idempotent migration that migrates legacy translation fields stored in
 * `voxlab_subtitle_settings` over to `voxlab_translation_settings`.
 * Preserves customModels, translationProviderId, targetLanguage, and cleans up legacy fields.
 */
export function migrateSubtitleAndTranslationSettings(): void {
  if (typeof localStorage === "undefined") return;

  try {
    const rawSubSettings = localStorage.getItem("voxlab_subtitle_settings");
    if (!rawSubSettings) return;

    const parsedSub = JSON.parse(rawSubSettings);
    let hasLegacyFields = false;

    // Check if legacy translation fields exist in subtitle settings
    if (
      parsedSub.targetLanguage !== undefined ||
      parsedSub.translationProviderId !== undefined ||
      parsedSub.customModels !== undefined ||
      parsedSub.autoTranslate !== undefined
    ) {
      hasLegacyFields = true;
    }

    if (hasLegacyFields) {
      const hasExistingTranslationSettings = !!localStorage.getItem(TRANSLATION_SETTINGS_KEY);
      const currentTranslation = loadTranslationSettings();

      // Only migrate if destination doesn't already have user custom models
      const migratedCustomModels =
        currentTranslation.customModels.length > 0
          ? currentTranslation.customModels
          : Array.isArray(parsedSub.customModels)
          ? parsedSub.customModels
          : [];

      const updatedTranslation: Partial<TranslationSettings> = {
        targetLanguage: hasExistingTranslationSettings
          ? currentTranslation.targetLanguage
          : parsedSub.targetLanguage || currentTranslation.targetLanguage,
        translationProviderId: hasExistingTranslationSettings
          ? currentTranslation.translationProviderId
          : parsedSub.translationProviderId || currentTranslation.translationProviderId,
        customModels: migratedCustomModels,
        autoTranslate: hasExistingTranslationSettings
          ? currentTranslation.autoTranslate
          : typeof parsedSub.autoTranslate === "boolean"
          ? parsedSub.autoTranslate
          : currentTranslation.autoTranslate,
      };

      saveTranslationSettings(updatedTranslation);

      // Clean up legacy translation fields from subtitle settings
      delete parsedSub.targetLanguage;
      delete parsedSub.translationProviderId;
      delete parsedSub.customModels;
      delete parsedSub.autoTranslate;

      localStorage.setItem("voxlab_subtitle_settings", JSON.stringify(parsedSub));
    }
  } catch (err) {
    console.warn("Failed to migrate subtitle and translation settings:", err);
  }
}

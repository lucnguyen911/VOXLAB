import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadTranslationSettings,
  saveTranslationSettings,
  migrateSubtitleAndTranslationSettings,
  DEFAULT_TRANSLATION_SETTINGS,
} from "../settings";

describe("Translation Settings & Migration Suite (Task 1.2)", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
    };
  });

  it("returns default settings when storage is empty", () => {
    const settings = loadTranslationSettings();
    assert.deepEqual(settings, DEFAULT_TRANSLATION_SETTINGS);
  });

  it("saves and reloads translation settings cleanly", () => {
    saveTranslationSettings({
      targetLanguage: "ja",
      translationProviderId: "gemini",
      autoTranslate: true,
    });

    const loaded = loadTranslationSettings();
    assert.equal(loaded.targetLanguage, "ja");
    assert.equal(loaded.translationProviderId, "gemini");
    assert.equal(loaded.autoTranslate, true);
    assert.deepEqual(loaded.customModels, []);
  });

  it("migrates legacy translation fields from voxlab_subtitle_settings safely", () => {
    // Setup legacy subtitle settings with embedded translation settings
    const legacySubtitleSettings = {
      audioLanguage: "en",
      whisperModel: "large-v3",
      speechSpeed: 0.9,
      processingSpeed: "2x",
      aspectRatio: "9:16",
      maxLines: 1,
      targetLanguage: "fr",
      translationProviderId: "custom_123",
      customModels: [
        {
          id: "custom_123",
          name: "Local Qwen",
          type: "lmstudio",
          endpoint: "http://localhost:1234/v1",
          model: "qwen2.5",
          createdAt: 1000,
        },
      ],
      autoTranslate: true,
    };
    mockStorage["voxlab_subtitle_settings"] = JSON.stringify(legacySubtitleSettings);

    // Run migration
    migrateSubtitleAndTranslationSettings();

    // Verify translation settings were migrated
    const migratedTranslation = loadTranslationSettings();
    assert.equal(migratedTranslation.targetLanguage, "fr");
    assert.equal(migratedTranslation.translationProviderId, "custom_123");
    assert.equal(migratedTranslation.customModels.length, 1);
    assert.equal(migratedTranslation.customModels[0].name, "Local Qwen");
    assert.equal(migratedTranslation.autoTranslate, true);

    // Verify subtitle settings were cleaned of legacy translation fields
    const cleanedSubtitle = JSON.parse(mockStorage["voxlab_subtitle_settings"]);
    assert.equal(cleanedSubtitle.audioLanguage, "en");
    assert.equal(cleanedSubtitle.whisperModel, "large-v3");
    assert.equal(cleanedSubtitle.aspectRatio, "9:16");
    assert.equal(cleanedSubtitle.targetLanguage, undefined);
    assert.equal(cleanedSubtitle.translationProviderId, undefined);
    assert.equal(cleanedSubtitle.customModels, undefined);
    assert.equal(cleanedSubtitle.autoTranslate, undefined);
  });

  it("is idempotent and does not overwrite updated translation settings on subsequent runs", () => {
    // User already has custom translation settings
    saveTranslationSettings({
      targetLanguage: "ko",
      translationProviderId: "deepseek",
    });

    // Old legacy settings exist
    mockStorage["voxlab_subtitle_settings"] = JSON.stringify({
      audioLanguage: "auto",
      targetLanguage: "vi",
      translationProviderId: "google",
    });

    migrateSubtitleAndTranslationSettings();

    const loaded = loadTranslationSettings();
    assert.equal(loaded.targetLanguage, "ko");
    assert.equal(loaded.translationProviderId, "deepseek");
  });
});

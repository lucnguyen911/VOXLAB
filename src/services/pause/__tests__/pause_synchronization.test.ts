import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PUNCTUATION_PAUSES,
  isLegacyPunctuationPauses,
  sanitizePunctuationPauses,
  migratePunctuationPauseDefaults,
} from "../punctuationPause";
import { DEFAULT_TTS_SETTINGS } from "../../../components/inspector/TtsInspector";
import { DEFAULT_DIALOGUE_SETTINGS } from "../../../types/dialogue";
import { DEFAULT_GLOBAL_SETTINGS } from "../../../views/BatchWorkspacePrototype";

describe("Gate Pause Sync: Canonical Punctuation Pause Alignment Across All Tabs", () => {
  it("CANONICAL DEFAULTS: Baseline punctuation pauses match the Text-to-Speech gold standard", () => {
    assert.equal(DEFAULT_PUNCTUATION_PAUSES.comma, 0.3, "Dấu phẩy ( , ) phải là 0.3s");
    assert.equal(DEFAULT_PUNCTUATION_PAUSES.period, 0.6, "Dấu chấm ( . ) phải là 0.6s");
    assert.equal(DEFAULT_PUNCTUATION_PAUSES.questionExclamation, 0.7, "Hỏi / Than ( ? ! ) phải là 0.7s");
    assert.equal(DEFAULT_PUNCTUATION_PAUSES.colonSemicolon, 0.4, "Hai chấm ( : ; ) phải là 0.4s");
  });

  it("CROSS-TAB EQUIVALENCE: All tab default settings match DEFAULT_PUNCTUATION_PAUSES exactly", () => {
    // 1. Text-to-Speech Tab
    assert.deepEqual(
      DEFAULT_TTS_SETTINGS.pauses,
      DEFAULT_PUNCTUATION_PAUSES,
      "TTS Tab default pauses must match canonical pauses"
    );

    // 2. Dialogue Tab
    assert.deepEqual(
      DEFAULT_DIALOGUE_SETTINGS.pauses,
      DEFAULT_PUNCTUATION_PAUSES,
      "Dialogue Tab default pauses must match canonical pauses"
    );

    // 3. Batch Global Defaults (TTS, Dialogue, Dubbing)
    assert.deepEqual(
      DEFAULT_GLOBAL_SETTINGS.tts.pauses,
      DEFAULT_PUNCTUATION_PAUSES,
      "Batch TTS default pauses must match canonical pauses"
    );
    assert.deepEqual(
      DEFAULT_GLOBAL_SETTINGS.dialogue.pauses,
      DEFAULT_PUNCTUATION_PAUSES,
      "Batch Dialogue default pauses must match canonical pauses"
    );
    assert.deepEqual(
      DEFAULT_GLOBAL_SETTINGS.dubbing.pauses,
      DEFAULT_PUNCTUATION_PAUSES,
      "Batch Dubbing default pauses must match canonical pauses"
    );
  });

  it("LEGACY DETECTION: isLegacyPunctuationPauses accurately identifies early placeholder pauses", () => {
    // Legacy Dialogue default (comma: 0.5, period: 0.5, questionExclamation: 1.0, colonSemicolon: 0.6)
    assert.equal(
      isLegacyPunctuationPauses({ comma: 0.5, period: 0.5, questionExclamation: 1.0, colonSemicolon: 0.6 }),
      true,
      "Identifies legacy dialogue default with floating 1.0"
    );
    assert.equal(
      isLegacyPunctuationPauses({ comma: 0.5, period: 0.5, questionExclamation: 1, colonSemicolon: 0.6 }),
      true,
      "Identifies legacy dialogue default with integer 1"
    );
    assert.equal(
      isLegacyPunctuationPauses({ comma: 0.5, period: 1.0, questionExclamation: 1.0, colonSemicolon: 0.6 }),
      true,
      "Identifies legacy UI sample comment values"
    );

    // Modern TTS canonical default is not legacy
    assert.equal(
      isLegacyPunctuationPauses(DEFAULT_PUNCTUATION_PAUSES),
      false,
      "Canonical TTS defaults must not be flagged as legacy"
    );

    // Custom user pause override is not legacy
    assert.equal(
      isLegacyPunctuationPauses({ comma: 0.4, period: 0.8, questionExclamation: 1.2, colonSemicolon: 0.5 }),
      false,
      "Custom user overrides must not be flagged as legacy"
    );
  });

  it("SANITIZATION: sanitizePunctuationPauses converts legacy defaults to TTS standards and keeps custom values", () => {
    // Legacy defaults replaced by canonical values
    const fromLegacy = sanitizePunctuationPauses({
      comma: 0.5,
      period: 0.5,
      questionExclamation: 1.0,
      colonSemicolon: 0.6,
    });
    assert.deepEqual(
      fromLegacy,
      DEFAULT_PUNCTUATION_PAUSES,
      "Legacy pauses must be cleanly sanitized to TTS standard"
    );

    // Null or undefined replaced by canonical values
    assert.deepEqual(sanitizePunctuationPauses(null), DEFAULT_PUNCTUATION_PAUSES);
    assert.deepEqual(sanitizePunctuationPauses(undefined), DEFAULT_PUNCTUATION_PAUSES);

    // Partial user customization preserves customized field and supplies defaults for missing fields
    const partialCustom = sanitizePunctuationPauses({ comma: 0.45 });
    assert.equal(partialCustom.comma, 0.45, "Preserves custom comma override");
    assert.equal(partialCustom.period, 0.6, "Fills period with TTS default");
    assert.equal(partialCustom.questionExclamation, 0.7, "Fills questionExclamation with TTS default");
    assert.equal(partialCustom.colonSemicolon, 0.4, "Fills colonSemicolon with TTS default");
  });

  it("MIGRATION: migratePunctuationPauseDefaults safely upgrades stored localStorage entries across all workspaces", () => {
    const mockStorage: Record<string, string> = {
      // Legacy dialogue settings from old user session
      voxlab_dialogue_settings: JSON.stringify({
        model: "Omni Voice",
        masterVolume: 1.0,
        pauses: { comma: 0.5, period: 0.5, questionExclamation: 1.0, colonSemicolon: 0.6 },
        concurrency: 1,
      }),
      // Legacy dubbing settings
      voxlab_dubbing_voice_settings: JSON.stringify({
        speed: 1.0,
        volume: 1.0,
        pauses: { comma: 0.5, period: 0.5, questionExclamation: 1, colonSemicolon: 0.6 },
      }),
      // Custom user TTS settings that should NOT be wiped
      voxlab_tts_settings: JSON.stringify({
        speed: 1.1,
        pauses: { comma: 0.35, period: 0.75, questionExclamation: 0.85, colonSemicolon: 0.45 },
      }),
    };

    (globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, val: string) => {
        mockStorage[key] = val;
      },
    };

    // Execute migration
    migratePunctuationPauseDefaults();

    // Verify dialogue settings were upgraded
    const migratedDialogue = JSON.parse(mockStorage.voxlab_dialogue_settings);
    assert.deepEqual(
      migratedDialogue.pauses,
      DEFAULT_PUNCTUATION_PAUSES,
      "Dialogue pauses in localStorage must be migrated to TTS standards"
    );

    // Verify dubbing settings were upgraded
    const migratedDubbing = JSON.parse(mockStorage.voxlab_dubbing_voice_settings);
    assert.deepEqual(
      migratedDubbing.pauses,
      DEFAULT_PUNCTUATION_PAUSES,
      "Dubbing pauses in localStorage must be migrated to TTS standards"
    );

    // Verify custom TTS settings were preserved
    const preservedTts = JSON.parse(mockStorage.voxlab_tts_settings);
    assert.equal(preservedTts.pauses.comma, 0.35, "Custom TTS comma pause must be preserved");
    assert.equal(preservedTts.pauses.period, 0.75, "Custom TTS period pause must be preserved");

    // Clean up
    delete (globalThis as any).localStorage;
  });
});

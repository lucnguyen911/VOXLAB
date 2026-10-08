import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getDefaultTtsAdvancedSettings,
  sanitizeTtsAdvancedSettings,
  sanitizeOmniVoiceSettings,
  sanitizeChatterboxSettings,
  sanitizeQwenSettings,
  OMNIVOICE_DEFAULT_SETTINGS,
  CHATTERBOX_DEFAULT_SETTINGS,
  QWEN_DEFAULT_SETTINGS,
  getEngineAdvancedSettings,
  getTtsAdvancedSettingsSnapshot,
  loadTtsAdvancedSettings,
  saveTtsAdvancedSettings,
  saveModelTtsAdvancedSettings,
  resetModelTtsAdvancedSettings,
  StoredTtsAdvancedSettings,
  TTS_ADVANCED_SETTINGS_FILE,
} from "../ttsAdvancedSettings";
import {
  _setMockSaveError,
  _setMockReadError,
  clearMemoryStorage,
  setMemoryFile,
} from "../../storage/tauriFsBridge";

describe("Global Advanced TTS Settings - Model Configuration & Sanitization", () => {
  it("provides valid official defaults for all 3 models", () => {
    const defaults = getDefaultTtsAdvancedSettings();
    assert.equal(defaults.version, 1);

    // OmniVoice: 5 visible + internal
    assert.equal(defaults.omnivoice.settings.num_step, 32);
    assert.equal(defaults.omnivoice.settings.guidance_scale, 2.0);
    assert.equal(defaults.omnivoice.settings.position_temperature, 5.0);
    assert.equal(defaults.omnivoice.settings.class_temperature, 0.0);
    assert.equal(defaults.omnivoice.settings.denoise, true);
    assert.equal(defaults.omnivoice.settings.t_shift, 0.1);
    assert.equal(defaults.omnivoice.settings.layer_penalty_factor, 5.0);
    assert.equal(defaults.omnivoice.settings.duration, null);

    // Chatterbox Turbo: 4 visible + internal top_k=1000
    assert.deepEqual(defaults.chatterbox.settings, CHATTERBOX_DEFAULT_SETTINGS);
    assert.equal(defaults.chatterbox.settings.temperature, 0.8);
    assert.equal(defaults.chatterbox.settings.top_p, 0.95);
    assert.equal(defaults.chatterbox.settings.repetition_penalty, 1.2);
    assert.equal(defaults.chatterbox.settings.norm_loudness, true);
    assert.equal(defaults.chatterbox.settings.top_k, 1000);

    // Qwen3-TTS Base: 4 visible + internal
    assert.deepEqual(defaults.qwen.settings, QWEN_DEFAULT_SETTINGS);
    assert.equal(defaults.qwen.settings.temperature, 0.9);
    assert.equal(defaults.qwen.settings.top_p, 1.0);
    assert.equal(defaults.qwen.settings.repetition_penalty, 1.05);
    assert.equal(defaults.qwen.settings.x_vector_only_mode, false);
    assert.equal(defaults.qwen.settings.top_k, 50);
    assert.equal(defaults.qwen.settings.do_sample, true);
    assert.equal(defaults.qwen.settings.subtalker_dosample, true);
    assert.equal(defaults.qwen.settings.subtalker_top_k, 50);
    assert.equal(defaults.qwen.settings.subtalker_top_p, 1.0);
    assert.equal(defaults.qwen.settings.subtalker_temperature, 0.9);
    assert.equal(defaults.qwen.settings.max_new_tokens, 2048);
    assert.equal(defaults.qwen.settings.non_streaming_mode, false);
  });

  it("clamps and sanitizes OmniVoice visible parameters while locking internal parameters", () => {
    const outOfBounds = {
      num_step: 9999,
      guidance_scale: -10,
      position_temperature: 999,
      class_temperature: -5,
      denoise: "not_a_bool" as any,
      // Attempt to tamper with internal parameters
      t_shift: 999.0,
      layer_penalty_factor: -10.0,
      duration: 50.0,
    };
    const sanitized = sanitizeOmniVoiceSettings(outOfBounds);

    // 5 visible parameters are clamped properly:
    assert.equal(sanitized.num_step, 128);
    assert.equal(sanitized.guidance_scale, 1.0);
    assert.equal(sanitized.position_temperature, 20.0);
    assert.equal(sanitized.class_temperature, 0.0);
    assert.equal(sanitized.denoise, true); // fallback for invalid non-boolean

    // Hidden internal parameters are strictly locked to official defaults:
    assert.equal(sanitized.t_shift, 0.1);
    assert.equal(sanitized.layer_penalty_factor, 5.0);
    assert.equal(sanitized.duration, null);
    assert.equal(sanitized.preprocess_prompt, true);
    assert.equal(sanitized.postprocess_output, true);
    assert.equal(sanitized.pad_duration, 0.1);
    assert.equal(sanitized.fade_duration, 0.1);
    assert.equal(sanitized.audio_chunk_duration, 15.0);
    assert.equal(sanitized.audio_chunk_threshold, 30.0);
  });

  it("clamps and sanitizes Chatterbox Turbo visible parameters while locking top_k=1000", () => {
    const outOfBounds = {
      temperature: 5.0,
      top_p: 0.0,
      repetition_penalty: 0.1,
      norm_loudness: false,
      top_k: 99999,
    };
    const sanitized = sanitizeChatterboxSettings(outOfBounds);
    assert.equal(sanitized.temperature, 2.0);
    assert.equal(sanitized.top_p, 0.1);
    assert.equal(sanitized.repetition_penalty, 1.0);
    assert.equal(sanitized.norm_loudness, false);
    // Locked internal parameter
    assert.equal(sanitized.top_k, 1000);
  });

  it("clamps and sanitizes Qwen3-TTS Base visible parameters while locking internal parameters", () => {
    const outOfBounds = {
      temperature: -2,
      top_p: 1.5,
      repetition_penalty: 10,
      x_vector_only_mode: true,
      // Internal params
      top_k: 999,
      do_sample: false,
      subtalker_dosample: false,
      max_new_tokens: 100,
    };
    const sanitized = sanitizeQwenSettings(outOfBounds);
    assert.equal(sanitized.temperature, 0.1);
    assert.equal(sanitized.top_p, 1.0);
    assert.equal(sanitized.repetition_penalty, 2.0);
    assert.equal(sanitized.x_vector_only_mode, true);

    // Locked internal parameters
    assert.equal(sanitized.top_k, 50);
    assert.equal(sanitized.do_sample, true);
    assert.equal(sanitized.subtalker_dosample, true);
    assert.equal(sanitized.subtalker_top_k, 50);
    assert.equal(sanitized.subtalker_top_p, 1.0);
    assert.equal(sanitized.subtalker_temperature, 0.9);
    assert.equal(sanitized.max_new_tokens, 2048);
    assert.equal(sanitized.non_streaming_mode, false);
  });

  it("gracefully migrates old data with presets, preserving visible edits and locking internals", () => {
    const oldConfig = {
      version: 1,
      omnivoice: {
        preset: "custom",
        settings: {
          num_step: 48,
          guidance_scale: 3.2,
          position_temperature: 4.0,
          class_temperature: 0.1,
          denoise: false,
          t_shift: 0.5, // old custom hidden value -> should be locked to 0.1
        },
      },
      chatterbox: {
        preset: "expressive",
        settings: {
          temperature: 0.88,
          top_p: 0.92,
          repetition_penalty: 1.25,
          norm_loudness: false,
          top_k: 1500, // old hidden value -> should be locked to 1000
        },
      },
      qwen: {
        preset: "stable",
        settings: {
          temperature: 0.75,
          top_p: 0.95,
          repetition_penalty: 1.1,
          x_vector_only_mode: true,
          top_k: 30, // old hidden value -> should be locked to 50
        },
      },
    };

    const migrated = sanitizeTtsAdvancedSettings(oldConfig);

    // OmniVoice
    assert.equal(migrated.omnivoice.settings.num_step, 48);
    assert.equal(migrated.omnivoice.settings.guidance_scale, 3.2);
    assert.equal(migrated.omnivoice.settings.position_temperature, 4.0);
    assert.equal(migrated.omnivoice.settings.class_temperature, 0.1);
    assert.equal(migrated.omnivoice.settings.denoise, false);
    assert.equal(migrated.omnivoice.settings.t_shift, 0.1); // reset to official internal

    // Chatterbox
    assert.equal(migrated.chatterbox.settings.temperature, 0.88);
    assert.equal(migrated.chatterbox.settings.top_p, 0.92);
    assert.equal(migrated.chatterbox.settings.repetition_penalty, 1.25);
    assert.equal(migrated.chatterbox.settings.norm_loudness, false);
    assert.equal(migrated.chatterbox.settings.top_k, 1000); // reset to official internal

    // Qwen
    assert.equal(migrated.qwen.settings.temperature, 0.75);
    assert.equal(migrated.qwen.settings.top_p, 0.95);
    assert.equal(migrated.qwen.settings.repetition_penalty, 1.1);
    assert.equal(migrated.qwen.settings.x_vector_only_mode, true);
    assert.equal(migrated.qwen.settings.top_k, 50); // reset to official internal
  });

  it("resolves engine parameters correctly for sidecar execution", () => {
    const omni = getEngineAdvancedSettings("omnivoice");
    assert.equal(omni.num_step, 32);
    assert.equal(omni.t_shift, 0.1);

    const chatter = getEngineAdvancedSettings("chatterbox-turbo");
    assert.equal(chatter.temperature, 0.8);
    assert.equal(chatter.top_k, 1000);

    const qwen = getEngineAdvancedSettings("qwen3-tts-1.7b-base");
    assert.equal(qwen.temperature, 0.9);
    assert.equal(qwen.repetition_penalty, 1.05);
    assert.equal(qwen.top_k, 50);
    assert.equal(qwen.subtalker_temperature, 0.9);
  });
});

describe("Global Advanced TTS Settings - Storage Persistence, Atomic Reset & Model Isolation", () => {
  beforeEach(async () => {
    clearMemoryStorage();
    await saveTtsAdvancedSettings(getDefaultTtsAdvancedSettings());
  });

  it("persists and reads back settings reliably", async () => {
    const modified: StoredTtsAdvancedSettings = getDefaultTtsAdvancedSettings();
    modified.omnivoice.settings.num_step = 40;
    modified.chatterbox.settings.temperature = 0.65;

    await saveTtsAdvancedSettings(modified);

    // Verify snapshot reflects changes immediately
    const snap = getTtsAdvancedSettingsSnapshot();
    assert.equal(snap.omnivoice.settings.num_step, 40);
    assert.equal(snap.chatterbox.settings.temperature, 0.65);

    // Reload from file
    const reloaded = await loadTtsAdvancedSettings();
    assert.equal(reloaded.omnivoice.settings.num_step, 40);
    assert.equal(reloaded.chatterbox.settings.temperature, 0.65);
  });

  it("saves a single model atomically while completely isolating other models", async () => {
    // 1. Initial state
    const initial = getDefaultTtsAdvancedSettings();
    initial.chatterbox.settings.temperature = 0.72;
    await saveTtsAdvancedSettings(initial);

    // 2. Save only OmniVoice with num_step=50
    const omniDraft = { ...OMNIVOICE_DEFAULT_SETTINGS, num_step: 50 };
    const result = await saveModelTtsAdvancedSettings("omnivoice", omniDraft);

    assert.equal(result.omnivoice.settings.num_step, 50);
    assert.equal(result.chatterbox.settings.temperature, 0.72, "Chatterbox settings must remain untouched");

    // 3. Verify on disk
    const reloaded = await loadTtsAdvancedSettings();
    assert.equal(reloaded.omnivoice.settings.num_step, 50);
    assert.equal(reloaded.chatterbox.settings.temperature, 0.72);
  });

  it("resets a single model to defaults in one atomic operation and saves to disk", async () => {
    // 1. Set customized values for all 3 models
    const custom = getDefaultTtsAdvancedSettings();
    custom.omnivoice.settings.num_step = 64;
    custom.omnivoice.settings.guidance_scale = 3.5;
    custom.chatterbox.settings.temperature = 0.6;
    custom.qwen.settings.temperature = 0.7;

    await saveTtsAdvancedSettings(custom);

    // 2. User clicks 'Khôi phục mặc định' on OmniVoice
    // Single operation: resets OmniVoice, saves to App Data, updates cache
    const afterReset = await resetModelTtsAdvancedSettings("omnivoice");

    // OmniVoice must be exactly official defaults
    assert.equal(afterReset.omnivoice.settings.num_step, 32);
    assert.equal(afterReset.omnivoice.settings.guidance_scale, 2.0);
    assert.equal(afterReset.omnivoice.settings.position_temperature, 5.0);
    assert.equal(afterReset.omnivoice.settings.class_temperature, 0.0);
    assert.equal(afterReset.omnivoice.settings.denoise, true);

    // Chatterbox and Qwen must be 100% preserved
    assert.equal(afterReset.chatterbox.settings.temperature, 0.6);
    assert.equal(afterReset.qwen.settings.temperature, 0.7);

    // 3. Verify disk file directly
    const reloaded = await loadTtsAdvancedSettings();
    assert.equal(reloaded.omnivoice.settings.num_step, 32);
    assert.equal(reloaded.chatterbox.settings.temperature, 0.6);
    assert.equal(reloaded.qwen.settings.temperature, 0.7);
  });

  it("throws error and preserves existing cached settings when disk save fails during reset", async () => {
    // 1. Initial state with customized OmniVoice
    const initial = getDefaultTtsAdvancedSettings();
    initial.omnivoice.settings.num_step = 64;
    await saveTtsAdvancedSettings(initial);
    assert.equal(getTtsAdvancedSettingsSnapshot().omnivoice.settings.num_step, 64);

    // 2. Simulate disk I/O failure (permission denied, disk full)
    _setMockSaveError(new Error("Disk I/O error: Access is denied"));

    // 3. Attempt resetModelTtsAdvancedSettings -> MUST reject
    await assert.rejects(
      async () => {
        await resetModelTtsAdvancedSettings("omnivoice");
      },
      (err: any) => {
        assert.match(err.message, /Access is denied/);
        return true;
      }
    );

    // 4. In-memory cached settings MUST NOT have been updated to 32!
    // No false success, no desync between RAM and disk
    const snapAfterFailure = getTtsAdvancedSettingsSnapshot();
    assert.equal(
      snapAfterFailure.omnivoice.settings.num_step,
      64,
      "cachedSettings must not be updated when disk write fails"
    );

    // 5. Retry after fixing error -> succeeds
    _setMockSaveError(null);
    const snapAfterRetry = await resetModelTtsAdvancedSettings("omnivoice");
    assert.equal(snapAfterRetry.omnivoice.settings.num_step, 32);
  });

  it("safely handles loadTtsAdvancedSettings when file does not exist vs disk read error vs corrupt JSON", async () => {
    // 1. Initial state with customized settings in cache
    const custom = getDefaultTtsAdvancedSettings();
    custom.omnivoice.settings.num_step = 48;
    await saveTtsAdvancedSettings(custom);
    assert.equal(getTtsAdvancedSettingsSnapshot().omnivoice.settings.num_step, 48);

    // 2. Case: Disk read error (permission denied / I/O error)
    _setMockReadError(new Error("Hardware failure reading block"));
    const retainedAfterReadError = await loadTtsAdvancedSettings();
    assert.equal(
      retainedAfterReadError.omnivoice.settings.num_step,
      48,
      "Existing cached settings must be retained when disk read fails"
    );
    _setMockReadError(null);

    // 3. Case: Corrupt JSON in file (partial write from power outage)
    setMemoryFile(TTS_ADVANCED_SETTINGS_FILE, "INVALID_JSON_CONTENT{{{");
    const retainedAfterCorruptJson = await loadTtsAdvancedSettings();
    assert.equal(
      retainedAfterCorruptJson.omnivoice.settings.num_step,
      48,
      "Existing cached settings must be retained when file contains corrupt JSON"
    );

    // 4. Case: Missing file (first run / fresh install)
    clearMemoryStorage();
    const freshDefaults = await loadTtsAdvancedSettings();
    assert.equal(
      freshDefaults.omnivoice.settings.num_step,
      32,
      "First run with missing file should cleanly return default settings"
    );
  });
});

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getDefaultTtsAdvancedSettings,
  sanitizeTtsAdvancedSettings,
  sanitizeOmniVoiceSettings,
  sanitizeChatterboxSettings,
  sanitizeQwenSettings,
  OMNIVOICE_DEFAULT_SETTINGS,
  OMNIVOICE_PRESETS,
  CHATTERBOX_DEFAULT_SETTINGS,
  CHATTERBOX_PRESETS,
  QWEN_DEFAULT_SETTINGS,
  QWEN_PRESETS,
  getEngineAdvancedSettings,
  getTtsAdvancedSettingsSnapshot,
  loadTtsAdvancedSettings,
  saveTtsAdvancedSettings,
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
  it("provides valid defaults for all 3 models", () => {
    const defaults = getDefaultTtsAdvancedSettings();
    assert.equal(defaults.version, 1);
    assert.equal(defaults.omnivoice.preset, "balanced");
    assert.deepEqual(defaults.omnivoice.settings, OMNIVOICE_DEFAULT_SETTINGS);

    assert.equal(defaults.chatterbox.preset, "balanced");
    assert.deepEqual(defaults.chatterbox.settings, CHATTERBOX_DEFAULT_SETTINGS);

    assert.equal(defaults.qwen.preset, "balanced");
    assert.deepEqual(defaults.qwen.settings, QWEN_DEFAULT_SETTINGS);
  });

  it("defines distinct, valid presets for each model", () => {
    // OmniVoice
    assert.equal(OMNIVOICE_PRESETS.stable.num_step, 40);
    assert.equal(OMNIVOICE_PRESETS.stable.guidance_scale, 2.5);
    assert.equal(OMNIVOICE_PRESETS.expressive.num_step, 32);
    assert.equal(OMNIVOICE_PRESETS.expressive.class_temperature, 0.2);

    // Chatterbox Turbo
    assert.equal(CHATTERBOX_PRESETS.stable.temperature, 0.6);
    assert.equal(CHATTERBOX_PRESETS.stable.top_k, 500);
    assert.equal(CHATTERBOX_PRESETS.expressive.temperature, 0.95);
    assert.equal(CHATTERBOX_PRESETS.expressive.top_k, 1500);

    // Qwen3-TTS
    assert.equal(QWEN_PRESETS.stable.temperature, 0.7);
    assert.equal(QWEN_PRESETS.stable.top_k, 30);
    assert.equal(QWEN_PRESETS.expressive.temperature, 1.0);
    assert.equal(QWEN_PRESETS.expressive.top_k, 70);
  });

  it("clamps and sanitizes OmniVoice parameters safely", () => {
    const outOfBounds = {
      num_step: 9999,
      guidance_scale: -10,
      denoise: "not_a_bool" as any,
      position_temperature: 999,
      class_temperature: -5,
      postprocess_output: true,
      t_shift: 100.0,
      layer_penalty_factor: -5.0,
      duration: 500.0,
      preprocess_prompt: false,
      pad_duration: 10.0,
      fade_duration: -2.0,
      audio_chunk_duration: 120.0,
      audio_chunk_threshold: 5.0,
    };
    const sanitized = sanitizeOmniVoiceSettings(outOfBounds);
    assert.equal(sanitized.num_step, 128);
    assert.equal(sanitized.guidance_scale, 1.0);
    assert.equal(sanitized.denoise, true); // fallback for invalid non-boolean
    assert.equal(sanitized.position_temperature, 20.0);
    assert.equal(sanitized.class_temperature, 0.0);
    assert.equal(sanitized.postprocess_output, true);
    assert.equal(sanitized.t_shift, 5.0);
    assert.equal(sanitized.layer_penalty_factor, 0.0);
    assert.equal(sanitized.duration, 300.0);
    assert.equal(sanitized.preprocess_prompt, false);
    assert.equal(sanitized.pad_duration, 2.0);
    assert.equal(sanitized.fade_duration, 0.0);
    assert.equal(sanitized.audio_chunk_duration, 60.0);
    assert.equal(sanitized.audio_chunk_threshold, 10.0);

    // Verify null duration remains null (Auto)
    const autoDuration = sanitizeOmniVoiceSettings({ duration: null });
    assert.equal(autoDuration.duration, null);
  });

  it("clamps and sanitizes Chatterbox Turbo parameters safely", () => {
    const outOfBounds = {
      temperature: 5.0,
      top_p: 0.0,
      top_k: 99999,
      repetition_penalty: 0.1,
      norm_loudness: false,
    };
    const sanitized = sanitizeChatterboxSettings(outOfBounds);
    assert.equal(sanitized.temperature, 2.0);
    assert.equal(sanitized.top_p, 0.1);
    assert.equal(sanitized.top_k, 2000);
    assert.equal(sanitized.repetition_penalty, 1.0);
    assert.equal(sanitized.norm_loudness, false);
  });

  it("clamps and sanitizes Qwen3-TTS Base parameters safely", () => {
    const outOfBounds = {
      temperature: -2,
      top_p: 1.5,
      top_k: 0,
      repetition_penalty: 10,
      do_sample: false,
      x_vector_only_mode: true,
      subtalker_dosample: false,
      subtalker_top_k: 9999,
      subtalker_top_p: -1.0,
      subtalker_temperature: 10.0,
      max_new_tokens: 50,
      non_streaming_mode: true,
    };
    const sanitized = sanitizeQwenSettings(outOfBounds);
    assert.equal(sanitized.temperature, 0.1);
    assert.equal(sanitized.top_p, 1.0);
    assert.equal(sanitized.top_k, 1);
    assert.equal(sanitized.repetition_penalty, 2.0);
    assert.equal(sanitized.do_sample, false);
    assert.equal(sanitized.x_vector_only_mode, true);
    assert.equal(sanitized.subtalker_dosample, false);
    assert.equal(sanitized.subtalker_top_k, 200);
    assert.equal(sanitized.subtalker_top_p, 0.1);
    assert.equal(sanitized.subtalker_temperature, 2.0);
    assert.equal(sanitized.max_new_tokens, 256);
    assert.equal(sanitized.non_streaming_mode, true);
  });

  it("gracefully restores defaults on corrupted or empty input", () => {
    const emptySanitized = sanitizeTtsAdvancedSettings({});
    assert.equal(emptySanitized.version, 1);
    assert.equal(emptySanitized.omnivoice.preset, "balanced");
    assert.equal(emptySanitized.omnivoice.settings.num_step, 32);
    assert.equal(emptySanitized.chatterbox.settings.temperature, 0.8);
    assert.equal(emptySanitized.qwen.settings.top_k, 50);

    const nullSanitized = sanitizeTtsAdvancedSettings(null);
    assert.equal(nullSanitized.version, 1);
    assert.equal(nullSanitized.omnivoice.preset, "balanced");
  });

  it("resolves engine parameters correctly by engine or model id", () => {
    const omni = getEngineAdvancedSettings("omnivoice");
    assert.equal(omni.num_step, 32);

    const chatter = getEngineAdvancedSettings("chatterbox-turbo");
    assert.equal(chatter.top_k, 1000);

    const qwen = getEngineAdvancedSettings("qwen3-tts-1.7b-base");
    assert.equal(qwen.repetition_penalty, 1.05);
  });
});

describe("Global Advanced TTS Settings - Storage Persistence & Isolation", () => {
  beforeEach(async () => {
    // Reset to defaults before test
    await saveTtsAdvancedSettings(getDefaultTtsAdvancedSettings());
  });

  it("persists and reads back settings reliably", async () => {
    const modified: StoredTtsAdvancedSettings = getDefaultTtsAdvancedSettings();
    modified.omnivoice.preset = "expressive";
    modified.omnivoice.settings = { ...OMNIVOICE_PRESETS.expressive };
    modified.chatterbox.preset = "stable";
    modified.chatterbox.settings = { ...CHATTERBOX_PRESETS.stable };

    await saveTtsAdvancedSettings(modified);

    // Verify snapshot reflects changes immediately
    const snap = getTtsAdvancedSettingsSnapshot();
    assert.equal(snap.omnivoice.preset, "expressive");
    assert.equal(snap.omnivoice.settings.class_temperature, 0.2);
    assert.equal(snap.chatterbox.preset, "stable");
    assert.equal(snap.chatterbox.settings.temperature, 0.6);

    // Reload from file
    const reloaded = await loadTtsAdvancedSettings();
    assert.equal(reloaded.omnivoice.preset, "expressive");
    assert.equal(reloaded.chatterbox.preset, "stable");
  });

  it("resets an individual model while preserving others", async () => {
    const modified: StoredTtsAdvancedSettings = getDefaultTtsAdvancedSettings();
    modified.omnivoice.preset = "custom";
    modified.omnivoice.settings.num_step = 64;
    modified.chatterbox.preset = "expressive";
    modified.chatterbox.settings = { ...CHATTERBOX_PRESETS.expressive };

    await saveTtsAdvancedSettings(modified);

    // Reset only omnivoice
    const afterReset = await resetModelTtsAdvancedSettings("omnivoice");
    assert.equal(afterReset.omnivoice.preset, "balanced");
    assert.equal(afterReset.omnivoice.settings.num_step, 32);
    // Chatterbox must still be expressive
    assert.equal(afterReset.chatterbox.preset, "expressive");
    assert.equal(afterReset.chatterbox.settings.temperature, 0.95);
  });

  it("preserves unsaved edits in other models when resetting active model draft in memory", async () => {
    // 1. Initial saved state: all default
    await saveTtsAdvancedSettings(getDefaultTtsAdvancedSettings());

    // 2. User edits Chatterbox in draft (temperature = 0.7) without saving to disk
    const draft: StoredTtsAdvancedSettings = JSON.parse(JSON.stringify(getDefaultTtsAdvancedSettings()));
    draft.chatterbox.preset = "custom";
    draft.chatterbox.settings.temperature = 0.7;

    // 3. User switches to OmniVoice and modifies it to num_step = 64
    draft.omnivoice.preset = "custom";
    draft.omnivoice.settings.num_step = 64;

    // 4. User hits "Khôi phục mặc định cho OmniVoice"
    // UI logic: only reset OmniVoice in draftSettings in memory without touching chatterbox
    draft.omnivoice = {
      preset: "balanced",
      settings: { ...OMNIVOICE_DEFAULT_SETTINGS },
    };

    // Verify Chatterbox draft is intact
    assert.equal(draft.chatterbox.settings.temperature, 0.7, "Chatterbox draft edit must not be lost");
    assert.equal(draft.omnivoice.settings.num_step, 32, "OmniVoice must be reset to balanced default");

    // 5. User clicks "Lưu cài đặt TTS"
    await saveTtsAdvancedSettings(draft);

    // 6. Reload from disk to verify durable persistence of both
    const reloaded = await loadTtsAdvancedSettings();
    assert.equal(reloaded.chatterbox.settings.temperature, 0.7, "Chatterbox 0.7 must be persisted to disk");
    assert.equal(reloaded.omnivoice.settings.num_step, 32, "OmniVoice 32 must be persisted to disk");
  });

  it("throws error and preserves existing cached settings when disk save fails", async () => {
    // 1. Initial known good state
    const initial = getDefaultTtsAdvancedSettings();
    initial.omnivoice.settings.num_step = 32;
    await saveTtsAdvancedSettings(initial);
    assert.equal(getTtsAdvancedSettingsSnapshot().omnivoice.settings.num_step, 32);

    // 2. Prepare modified settings
    const modified: StoredTtsAdvancedSettings = JSON.parse(JSON.stringify(initial));
    modified.omnivoice.preset = "custom";
    modified.omnivoice.settings.num_step = 64;

    // 3. Simulate disk write failure (e.g. disk full, permission denied, locked file)
    _setMockSaveError(new Error("Disk I/O error: Access is denied"));

    // 4. Attempt save -> MUST reject
    await assert.rejects(
      async () => {
        await saveTtsAdvancedSettings(modified);
      },
      (err: any) => {
        assert.match(err.message, /Access is denied/);
        return true;
      }
    );

    // 5. In-memory cached settings MUST NOT have been updated to 64!
    const snapAfterFailure = getTtsAdvancedSettingsSnapshot();
    assert.equal(
      snapAfterFailure.omnivoice.settings.num_step,
      32,
      "cachedSettings must not be updated when disk write fails"
    );

    // 6. User retries after disk issue resolved -> succeeds
    _setMockSaveError(null);
    await saveTtsAdvancedSettings(modified);

    const snapAfterRetry = getTtsAdvancedSettingsSnapshot();
    assert.equal(
      snapAfterRetry.omnivoice.settings.num_step,
      64,
      "cachedSettings should be updated after successful retry"
    );
  });

  it("safely handles loadTtsAdvancedSettings when file does not exist vs disk read error vs corrupt JSON", async () => {
    // 1. Initial state with customized settings in cache
    const custom = getDefaultTtsAdvancedSettings();
    custom.omnivoice.settings.num_step = 48;
    await saveTtsAdvancedSettings(custom);
    assert.equal(getTtsAdvancedSettingsSnapshot().omnivoice.settings.num_step, 48);

    // 2. Case: Disk read error (permission denied / I/O error)
    // Must NOT silently wipe cache to defaults! Must retain 48 and log error.
    _setMockReadError(new Error("Hardware failure reading block"));
    const retainedAfterReadError = await loadTtsAdvancedSettings();
    assert.equal(
      retainedAfterReadError.omnivoice.settings.num_step,
      48,
      "Existing cached settings must be retained when disk read fails"
    );
    _setMockReadError(null);

    // 3. Case: Corrupt JSON in file (e.g. partial write from power outage)
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


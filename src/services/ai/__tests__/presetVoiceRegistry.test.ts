import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePresetVoiceReference,
  resolveUnifiedVoiceReference,
  setPresetVoicesAppDataDir,
} from "../presetVoiceRegistry";
import { LocalAiServices, type AiFs } from "../localAiServices";
import { RecordingAiBackend } from "../testing/recordingAiBackend";

describe("Preset Voice Registry & Unified Resolution Suite", () => {
  const TEST_APPDATA = "C:/TestVoxLab/AppData";
  setPresetVoicesAppDataDir(TEST_APPDATA);

  it("resolves Sarah (kokoro_af_sarah) with correct reference audio and authoritative transcript", () => {
    const ref = resolvePresetVoiceReference("kokoro_af_sarah", TEST_APPDATA);
    assert.ok(ref, "Sarah reference must exist");
    assert.match(ref.refAudioPath || "", /kokoro_af_sarah\.wav/i);
    assert.equal(ref.language, "en");
    assert.equal(
      ref.refText,
      "Hello, this is Sarah with a clear and professional voice sample for presentations and news on VoxLab."
    );
  });

  it("resolves Heart (kokoro_af_heart) and Adam (kokoro_am_adam) for built-in Kokoro voices", () => {
    const heart = resolvePresetVoiceReference("kokoro_af_heart", TEST_APPDATA);
    assert.ok(heart, "Heart reference must exist");
    assert.match(heart.refAudioPath || "", /kokoro_af_heart\.wav/i);
    assert.equal(heart.language, "en");

    const adam = resolvePresetVoiceReference("kokoro_am_adam", TEST_APPDATA);
    assert.ok(adam, "Adam reference must exist");
    assert.match(adam.refAudioPath || "", /kokoro_am_adam\.wav/i);
    assert.equal(adam.language, "en");
  });

  it("resolves George UK (kokoro_bm_george) for British English", () => {
    const george = resolvePresetVoiceReference("kokoro_bm_george", TEST_APPDATA);
    assert.ok(george, "George UK reference must exist");
    assert.match(george.refAudioPath || "", /kokoro_bm_george\.wav/i);
    assert.equal(george.language, "en");
  });

  it("falls back to default_local when an unknown local voice ID is queried", () => {
    const fallback = resolveUnifiedVoiceReference("unknown_custom_id_999", TEST_APPDATA);
    assert.ok(fallback, "Must fall back to default_local");
    assert.match(fallback.refAudioPath || "", /default_local\.mp3/i);
    assert.equal(fallback.refText, "Xin chào, đây là bản nghe thử giọng đọc mẫu trên VoxLab.");
  });

  it("integrates seamlessly into LocalAiServices.resolveEngine for both Kokoro-82M and OmniVoice", () => {
    const mockFs: AiFs = {
      readText: async () => "",
      writeText: async () => {},
      listDir: async () => [],
      removeFile: async () => {},
      scratchDir: async (n) => `scratch/${n}`,
    };

    const ai = new LocalAiServices(
      new RecordingAiBackend(),
      mockFs,
      () => ({
        modelsDir: "C:/TestModels",
        device: "cuda",
        asrModelId: "faster-whisper-small",
      }),
      (voiceId) => resolveUnifiedVoiceReference(voiceId, TEST_APPDATA)
    );

    // 1. Kokoro-82M resolves without reference audio (uses native voices-v1.0.bin embedding)
    const kokoroResolved = ai.resolveEngine(
      "kokoro_82m",
      "kokoro_af_sarah",
      "Testing pre-bundled Kokoro-82M synthesis."
    );
    assert.equal(kokoroResolved.caps.engine, "kokoro");
    assert.equal(kokoroResolved.ref, null);

    // 2. OmniVoice resolves with Sarah's WAV reference audio and transcript
    const omniResolved = ai.resolveEngine(
      "omnivoice",
      "kokoro_af_sarah",
      "Testing chunk speech consistency with Sarah reference."
    );
    assert.equal(omniResolved.caps.engine, "omnivoice");
    assert.ok(omniResolved.ref, "Voice reference must be populated for Sarah on OmniVoice");
    assert.match(omniResolved.ref.refAudioPath || "", /kokoro_af_sarah\.wav/i);
    assert.equal(omniResolved.language, "en");
  });
});

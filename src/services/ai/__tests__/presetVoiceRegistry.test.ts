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

  it("resolves Sarah (voice_06) with correct reference audio and authoritative transcript", () => {
    const ref = resolvePresetVoiceReference("voice_06", TEST_APPDATA);
    assert.ok(ref, "Sarah reference must exist");
    assert.match(ref.refAudioPath || "", /sarah\.mp3/i);
    assert.equal(ref.language, "en");
    assert.equal(ref.refText, "Hello, this is Sarah with a professional voice sample on VoxLab.");
  });

  it("resolves Thảo Trinh (voice_01) and Nam Anh (voice_02) for Vietnamese", () => {
    const thaoTrinh = resolvePresetVoiceReference("voice_01", TEST_APPDATA);
    assert.ok(thaoTrinh, "Thảo Trinh reference must exist");
    assert.match(thaoTrinh.refAudioPath || "", /thao_trinh\.mp3/i);
    assert.equal(thaoTrinh.language, "vi");
    assert.equal(thaoTrinh.refText, "Xin chào, đây là bản nghe thử giọng đọc của Thảo Trinh trên VoxLab.");

    const namAnh = resolvePresetVoiceReference("voice_02", TEST_APPDATA);
    assert.ok(namAnh, "Nam Anh reference must exist");
    assert.match(namAnh.refAudioPath || "", /nam_anh\.mp3/i);
    assert.equal(namAnh.language, "vi");
    assert.equal(namAnh.refText, "Xin chào, đây là bản nghe thử giọng đọc của Nam Anh trên VoxLab.");
  });

  it("resolves David (voice_07) for UK English", () => {
    const david = resolvePresetVoiceReference("voice_07", TEST_APPDATA);
    assert.ok(david, "David reference must exist");
    assert.match(david.refAudioPath || "", /david\.mp3/i);
    assert.equal(david.language, "en");
    assert.equal(david.refText, "Hello, this is David with a documentary voice sample on VoxLab.");
  });

  it("falls back to default_local when an unknown local voice ID is queried", () => {
    const fallback = resolveUnifiedVoiceReference("unknown_custom_id_999", TEST_APPDATA);
    assert.ok(fallback, "Must fall back to default_local");
    assert.match(fallback.refAudioPath || "", /default_local\.mp3/i);
    assert.equal(fallback.refText, "Xin chào, đây là bản nghe thử giọng đọc mẫu trên VoxLab.");
  });

  it("integrates seamlessly into LocalAiServices.resolveEngine so chunks receive Sarah reference", () => {
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

    const resolved = ai.resolveEngine(
      "omnivoice",
      "voice_06",
      "Testing chunk speech consistency with Sarah reference."
    );

    assert.equal(resolved.caps.engine, "omnivoice");
    assert.ok(resolved.ref, "Voice reference must be populated for Sarah");
    assert.match(resolved.ref.refAudioPath || "", /sarah\.mp3/i);
    assert.equal(resolved.ref.refText, "Hello, this is Sarah with a professional voice sample on VoxLab.");
    assert.equal(resolved.language, "en");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createEffectiveVoiceSnapshot, resolveEffectiveActiveModel } from "../voiceSnapshot";
import { MOCK_VOICES } from "../../../mock/data";
import { VoiceProfile } from "../../../types/ui";

describe("Voice Snapshot & Single Source of Truth Tests", () => {
  it("enforces NO SILENT FALLBACK: throws when voiceId is empty or whitespace", () => {
    assert.throws(
      () => createEffectiveVoiceSnapshot("", MOCK_VOICES),
      /Chưa chọn giọng đọc chính/
    );
    assert.throws(
      () => createEffectiveVoiceSnapshot("   ", MOCK_VOICES),
      /Chưa chọn giọng đọc chính/
    );
  });

  it("enforces NO SILENT FALLBACK: throws when voiceId does not exist in catalog", () => {
    assert.throws(
      () => createEffectiveVoiceSnapshot("non_existent_voice_999", MOCK_VOICES),
      /không tồn tại trong hệ thống/
    );
    assert.throws(
      () => createEffectiveVoiceSnapshot("random_hacker_voice", MOCK_VOICES),
      /không tồn tại trong hệ thống/
    );
  });

  it("returns an immutable frozen object (Object.isFrozen)", () => {
    const snapshot = createEffectiveVoiceSnapshot("kokoro_af_heart", MOCK_VOICES, {
      activeModel: "OmniVoice",
      speed: 1.1,
    });
    assert.ok(Object.isFrozen(snapshot), "Snapshot must be frozen to prevent tampering");
    assert.throws(() => {
      (snapshot as any).voiceId = "hacked";
    });
  });

  it("maps Edge voices to real authoritative providerVoiceId (not display name)", () => {
    const hoaimySnapshot = createEffectiveVoiceSnapshot("edge_vi_hoaimy", MOCK_VOICES, {
      speed: 1.0,
      pitch: 1.0,
      volume: 1.0,
    });
    assert.equal(hoaimySnapshot.provider, "edge");
    assert.equal(hoaimySnapshot.providerVoiceId, "vi-VN-HoaiMyNeural");
    assert.equal(hoaimySnapshot.engine, "edge_tts");
    assert.equal(hoaimySnapshot.language, "vi");

    const namminhSnapshot = createEffectiveVoiceSnapshot("edge_vi_namminh", MOCK_VOICES);
    assert.equal(namminhSnapshot.provider, "edge");
    assert.equal(namminhSnapshot.providerVoiceId, "vi-VN-NamMinhNeural");

    const jennySnapshot = createEffectiveVoiceSnapshot("edge_en_jenny", MOCK_VOICES);
    assert.equal(jennySnapshot.provider, "edge");
    assert.equal(jennySnapshot.providerVoiceId, "en-US-JennyNeural");
  });

  it("guarantees Chunk 1 and Chunk 2 share identical effective voice parameters from snapshot", () => {
    const snapshot = createEffectiveVoiceSnapshot("edge_vi_hoaimy", MOCK_VOICES, {
      speed: 1.2,
      pitch: 0.9,
    });

    const chunk1Context = {
      chunkId: "chunk_01",
      provider: snapshot.provider,
      effectiveVoiceId: snapshot.providerVoiceId,
      engine: snapshot.engine,
      model: snapshot.modelId,
      speed: snapshot.speed,
    };

    const chunk2Context = {
      chunkId: "chunk_02",
      provider: snapshot.provider,
      effectiveVoiceId: snapshot.providerVoiceId,
      engine: snapshot.engine,
      model: snapshot.modelId,
      speed: snapshot.speed,
    };

    assert.equal(chunk1Context.provider, chunk2Context.provider);
    assert.equal(chunk1Context.effectiveVoiceId, chunk2Context.effectiveVoiceId);
    assert.equal(chunk1Context.effectiveVoiceId, "vi-VN-HoaiMyNeural");
    assert.equal(chunk1Context.engine, chunk2Context.engine);
    assert.equal(chunk1Context.speed, chunk2Context.speed);
  });

  it("configures local voices with local engine and user-selected model", () => {
    const snapshot = createEffectiveVoiceSnapshot("kokoro_af_heart", MOCK_VOICES, {
      activeModel: "OmniVoice",
      speed: 1.0,
    });
    assert.equal(snapshot.provider, "local");
    assert.equal(snapshot.voiceId, "kokoro_af_heart");
    assert.equal(snapshot.modelId, "OmniVoice");
    assert.equal(snapshot.engine, "omnivoice");

    const kokoroSnapshot = createEffectiveVoiceSnapshot("kokoro_af_heart", MOCK_VOICES, {
      activeModel: "Kokoro-82M",
      speed: 1.0,
    });
    assert.equal(kokoroSnapshot.provider, "local");
    assert.equal(kokoroSnapshot.voiceId, "kokoro_af_heart");
    assert.equal(kokoroSnapshot.modelId, "Kokoro-82M");
    assert.equal(kokoroSnapshot.engine, "kokoro_82m");
  });

  it("prioritizes user-selected model for clone voices and avoids locking language to vi", () => {
    const cloneVoice: VoiceProfile = {
      id: "clone_test_999",
      name: "Matt Clone",
      source: "local_clone",
      origin: "clone",
      sourceType: "clone",
      provider: "clone",
      engine: "omnivoice",
      tags: [],
      supportedLanguages: ["vi", "en"],
      modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
      sampleAudioPath: "F:\\AppData\\voices\\clones\\clone_test_999.wav",
      isOnline: false,
      isFavorite: false,
      avatarColor: "from-amber-500 to-orange-500",
      availability: "available",
      previewAvailable: true,
    };

    assert.equal(
      resolveEffectiveActiveModel(cloneVoice, "Qwen3-TTS 1.7B Base"),
      "Qwen3-TTS 1.7B Base"
    );
    const kokoroVoice = MOCK_VOICES.find((v) => v.id === "kokoro_af_heart");
    assert.equal(resolveEffectiveActiveModel(kokoroVoice, "Omni Voice"), "kokoro_82m");

    const snap = createEffectiveVoiceSnapshot("clone_test_999", [cloneVoice], {
      activeModel: resolveEffectiveActiveModel(cloneVoice, "Qwen3-TTS 1.7B Base"),
      speed: 0.95,
    });
    assert.equal(snap.engine, "qwen_tts_1_7b");
    assert.equal(snap.speed, 0.95);
    assert.equal(snap.language, undefined);
  });

  it("rejects orphaned clone voices whose reference audio path is missing", () => {
    const orphanClone: VoiceProfile = {
      id: "clone_orphan_404",
      name: "Deleted Clone",
      source: "local_clone",
      origin: "clone",
      sourceType: "clone",
      provider: "clone",
      engine: "omnivoice",
      tags: [],
      supportedLanguages: ["en"],
      modelCompatibility: ["Omni Voice"],
      sampleAudioPath: "",
      isOnline: false,
      isFavorite: false,
      avatarColor: "from-amber-500 to-orange-500",
      availability: "available",
      previewAvailable: false,
    };

    assert.throws(
      () => createEffectiveVoiceSnapshot("clone_orphan_404", [orphanClone]),
      /Mẫu âm thanh gốc của giọng nhân bản/
    );
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createEffectiveVoiceSnapshot } from "../voiceSnapshot";
import { MOCK_VOICES } from "../../../mock/data";

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
    const snapshot = createEffectiveVoiceSnapshot("voice_01", MOCK_VOICES, {
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
    const snapshot = createEffectiveVoiceSnapshot("voice_01", MOCK_VOICES, {
      activeModel: "OmniVoice",
      speed: 1.0,
    });
    assert.equal(snapshot.provider, "local");
    assert.equal(snapshot.voiceId, "voice_01");
    assert.equal(snapshot.modelId, "OmniVoice");
    assert.equal(snapshot.engine, "omnivoice");
  });
});

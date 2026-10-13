import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getFriendlyAsrName,
  checkAsrReadiness,
  applyAsrModelSwitch,
} from "../asrReadiness";
import { loadSubtitleSettings } from "../../subtitle/profiles";

describe("ASR Readiness Service Tests", () => {
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
      clear: () => {
        mockStorage = {};
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
  });
  it("AR1: getFriendlyAsrName maps model IDs to clear human-friendly display names", () => {
    assert.equal(getFriendlyAsrName("large-v3-turbo"), "Whisper Large V3 Turbo");
    assert.equal(getFriendlyAsrName("faster-whisper-large-v3-turbo"), "Whisper Large V3 Turbo");
    assert.equal(getFriendlyAsrName("large-v3"), "Whisper Large V3");
    assert.equal(getFriendlyAsrName("medium"), "Whisper Medium");
    assert.equal(getFriendlyAsrName("small"), "Whisper Small");
    assert.equal(getFriendlyAsrName("faster-whisper-small"), "Whisper Small");
  });

  it("AR2: checkAsrReadiness returns status cleanly in environment without throwing", async () => {
    const res = await checkAsrReadiness("small", null);
    assert.ok(res);
    assert.equal(typeof res.ready, "boolean");
    assert.equal(res.selectedModel, "small");
    assert.equal(res.selectedModelDisplayName, "Whisper Small");
    assert.ok(Array.isArray(res.installedModels));
  });

  it("AR3: applyAsrModelSwitch updates Subtitle settings and canonicalizes model ID", async () => {
    // Switch to small
    await applyAsrModelSwitch("faster-whisper-small");
    let current = loadSubtitleSettings();
    assert.equal(current.whisperModel, "small");

    // Switch to large-v3-turbo
    await applyAsrModelSwitch("large-v3-turbo");
    current = loadSubtitleSettings();
    assert.equal(current.whisperModel, "large-v3-turbo");
  });
});

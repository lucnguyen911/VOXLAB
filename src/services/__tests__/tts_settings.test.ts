import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadStoredTtsSettings,
  saveStoredTtsSettings,
} from "../../components/inspector/TtsInspector";

describe("TTS Settings Storage & Speed Range Suite", () => {
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
      key: () => null,
      length: 0,
    };
  });

  it("returns default speed of 1.0 when storage is empty", () => {
    const settings = loadStoredTtsSettings();
    assert.equal(settings.speed, 1.0);
    assert.equal(settings.pitch, 1.0);
    assert.equal(settings.volume, 1.0);
  });

  it("clamps speed greater than 1.5 to 1.5 maximum", () => {
    mockStorage["voxlab_tts_settings"] = JSON.stringify({ speed: 2.0 });
    const settings = loadStoredTtsSettings();
    assert.equal(settings.speed, 1.5);
  });

  it("clamps speed lower than 0.5 to 0.5 minimum", () => {
    mockStorage["voxlab_tts_settings"] = JSON.stringify({ speed: 0.2 });
    const settings = loadStoredTtsSettings();
    assert.equal(settings.speed, 0.5);
  });

  it("preserves valid speed within range [0.5, 1.5]", () => {
    mockStorage["voxlab_tts_settings"] = JSON.stringify({ speed: 1.25 });
    const settings = loadStoredTtsSettings();
    assert.equal(settings.speed, 1.25);
  });

  it("saves and reloads valid speed correctly", () => {
    saveStoredTtsSettings({ speed: 1.15 });
    const settings = loadStoredTtsSettings();
    assert.equal(settings.speed, 1.15);
  });

  it("safely ignores legacy optimizeClarity in storage and loads defaults cleanly", () => {
    mockStorage["voxlab_tts_settings"] = JSON.stringify({ optimizeClarity: true, speed: 1.1 });
    const settings = loadStoredTtsSettings();
    assert.equal(settings.speed, 1.1);
    assert.equal(settings.concurrency, 1);
  });
});

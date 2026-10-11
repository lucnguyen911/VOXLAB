import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadStoredTtsSettings, saveStoredTtsSettings } from "../../../components/inspector/TtsInspector";
import {
  loadBatchOutputSettings,
  saveBatchOutputSettings,
  loadStoredDubbingSettings,
  saveStoredDubbingSettings,
  loadStoredDialogueSettings,
  saveStoredDialogueSettings,
  DUBBING_VOICE_SETTINGS_KEY,
  DIALOGUE_SETTINGS_STORAGE_KEY,
  BATCH_OUTPUT_SETTINGS_STORAGE_KEY,
} from "../../../views/BatchWorkspacePrototype";
import { BatchConcurrencyQueue } from "../../concurrencyExecutor";

describe("Processing Speed 1x-4x Removal & Unified Concurrency Verification", () => {
  it("C1: loadStoredTtsSettings sanitizes legacy concurrency (2, 3, 4, 8) to 1 while preserving audio settings", () => {
    const mockStorage: Record<string, string> = {
      voxlab_tts_settings: JSON.stringify({
        speed: 1.2,
        pitch: 0.9,
        volume: 1.4,
        pauses: { comma: 0.35, period: 0.7, questionExclamation: 0.8, colonSemicolon: 0.45 },
        concurrency: 4,
        exportSrt: true,
      }),
    };

    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
    };

    const loaded = loadStoredTtsSettings();
    assert.equal(loaded.concurrency, 1, "Concurrency must be clamped to 1");
    assert.equal(loaded.speed, 1.2, "Voice playback speed must be preserved");
    assert.equal(loaded.pitch, 0.9, "Pitch must be preserved");
    assert.equal(loaded.volume, 1.4, "Volume must be preserved");
    assert.equal(loaded.pauses.comma, 0.35, "Pauses must be preserved");
    assert.equal(loaded.exportSrt, true, "exportSrt must be preserved");

    // Saving also enforces concurrency: 1
    saveStoredTtsSettings({ speed: 1.3 });
    const updated = loadStoredTtsSettings();
    assert.equal(updated.speed, 1.3);
    assert.equal(updated.concurrency, 1);

    delete (globalThis as any).localStorage;
  });

  it("C2: loadStoredDubbingSettings sanitizes legacy concurrency to 1 while preserving voice and timing settings", () => {
    const mockStorage: Record<string, string> = {
      [DUBBING_VOICE_SETTINGS_KEY]: JSON.stringify({
        ttsModel: "Chatterbox Turbo",
        speed: 1.1,
        pitch: 1.05,
        volume: 1.2,
        pauses: { comma: 0.3, period: 0.6, questionExclamation: 0.7, colonSemicolon: 0.4 },
        concurrency: 3,
        autoFit: true,
      }),
    };

    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
    };

    const loaded = loadStoredDubbingSettings();
    assert.equal(loaded.concurrency, 1, "Dubbing concurrency must be clamped to 1");
    assert.equal(loaded.speed, 1.1, "Voice speed must be preserved");
    assert.equal(loaded.pitch, 1.05, "Voice pitch must be preserved");
    assert.equal(loaded.volume, 1.2, "Voice volume must be preserved");
    assert.equal(loaded.autoFit, true, "AutoFit must be preserved");

    // Saving also enforces concurrency: 1
    saveStoredDubbingSettings({ speed: 1.2 });
    const updated = loadStoredDubbingSettings();
    assert.equal(updated.speed, 1.2);
    assert.equal(updated.concurrency, 1);

    delete (globalThis as any).localStorage;
  });

  it("C3: loadStoredDialogueSettings sanitizes legacy concurrency to 1 while preserving dialogue settings", () => {
    const mockStorage: Record<string, string> = {
      [DIALOGUE_SETTINGS_STORAGE_KEY]: JSON.stringify({
        model: "Omni Voice",
        masterVolume: 1.3,
        turnPauseSec: 0.5,
        sameSpeakerPauseSec: 0.2,
        pauses: { comma: 0.3, period: 0.6, questionExclamation: 0.7, colonSemicolon: 0.4 },
        concurrency: 2,
        exportSrt: true,
      }),
    };

    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
    };

    const loaded = loadStoredDialogueSettings();
    assert.equal(loaded.concurrency, 1, "Dialogue concurrency must be clamped to 1");
    assert.equal(loaded.masterVolume, 1.3, "Master volume must be preserved");
    assert.equal(loaded.exportSrt, true, "exportSrt must be preserved");

    // Saving also enforces concurrency: 1
    saveStoredDialogueSettings({ masterVolume: 1.4 });
    const updated = loadStoredDialogueSettings();
    assert.equal(updated.masterVolume, 1.4);
    assert.equal(updated.concurrency, 1);

    delete (globalThis as any).localStorage;
  });

  it("C4: loadBatchOutputSettings enforces concurrency = 1 regardless of legacy storage", () => {
    const mockStorage: Record<string, string> = {
      [BATCH_OUTPUT_SETTINGS_STORAGE_KEY]: JSON.stringify({
        saveInSourceFolder: true,
        outputPath: "E:/BatchOut",
        collisionPolicy: "auto_rename",
        outputAudioFormat: "wav",
        outputSubtitleFormat: "srt",
        concurrency: 4,
      }),
    };

    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
    };

    const loaded = loadBatchOutputSettings();
    assert.equal(loaded.concurrency, 1, "Batch output concurrency must be clamped to 1");
    assert.equal(loaded.saveInSourceFolder, true);
    assert.equal(loaded.outputPath, "E:/BatchOut");

    // Saving also enforces concurrency: 1
    saveBatchOutputSettings({ outputPath: "E:/NewBatchOut" });
    const updated = loadBatchOutputSettings();
    assert.equal(updated.outputPath, "E:/NewBatchOut");
    assert.equal(updated.concurrency, 1);

    delete (globalThis as any).localStorage;
  });

  it("C5: BatchConcurrencyQueue defaults to concurrency 1 when omitted", async () => {
    const queue = new BatchConcurrencyQueue();
    const items = [10, 20, 30];
    const order: number[] = [];

    const telemetry = await queue.runBatch(items, {
      processItem: async (item) => {
        order.push(item);
      },
    });

    assert.equal(telemetry.concurrencyLevel, 1, "Default concurrency level must be 1");
    assert.equal(telemetry.completedCount, 3);
    assert.deepEqual(order, [10, 20, 30]);
  });
});

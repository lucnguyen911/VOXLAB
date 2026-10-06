import test from "node:test";
import assert from "node:assert/strict";
import {
  saveDubbingSessionBackup,
  loadDubbingSessionBackup,
  clearDubbingSessionBackup,
  DUBBING_SESSION_STORAGE_KEY,
} from "../sessionStorage";
import { OriginalCue, TranslatedCue, DubAudioSegment } from "../../../types/dubbing";

// Mock sessionStorage in Node.js environment
const mockStorage: Record<string, string> = {};
(globalThis as any).sessionStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    for (const k of Object.keys(mockStorage)) {
      delete mockStorage[k];
    }
  },
};

test("Dubbing SessionStorage Lifecycle", async (t) => {
  await t.test("strips binary/blob URLs and preserves lightweight metadata", () => {
    const originalCues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 2.0, text: "Xin chào thế giới" },
      { index: 2, startSec: 2.5, endSec: 5.0, text: "Tôi là trợ lý AI" },
    ];

    const translatedCues: TranslatedCue[] = [
      {
        index: 1,
        startSec: 0.0,
        endSec: 2.0,
        originalText: "Xin chào thế giới",
        text: "Hello world edited",
        isEdited: true,
      },
      {
        index: 2,
        startSec: 2.5,
        endSec: 5.0,
        originalText: "Tôi là trợ lý AI",
        text: "I am an AI assistant",
        isEdited: false,
      },
    ];

    const audioSegments: Record<number, DubAudioSegment> = {
      1: {
        cueIndex: 1,
        status: "ready",
        rawDurationSec: 2.4,
        targetDurationSec: 2.0,
        fittedDurationSec: 2.0,
        speedFactor: 1.2,
        audioStartSec: 0.0,
        audioEndSec: 2.0,
        audioUrl: "blob:http://localhost:5173/mock-audio-blob-1",
        fittedAudioUrl: "blob:http://localhost:5173/mock-fitted-blob-1",
      },
      2: {
        cueIndex: 2,
        status: "ready",
        rawDurationSec: 2.5,
        targetDurationSec: 2.5,
        fittedDurationSec: 2.5,
        speedFactor: 1.0,
        audioStartSec: 2.5,
        audioEndSec: 5.0,
        audioUrl: "blob:http://localhost:5173/mock-audio-blob-2",
      },
    };

    saveDubbingSessionBackup({
      sourceMediaName: "presentation.mp4",
      sourceDurationSec: 5.0,
      sourceLang: "vi",
      targetLang: "en",
      selectedProviderId: "google",
      selectedVoiceId: "voice_01",
      originalCues,
      translatedCues,
      audioSegments,
      overflowAnalysis: {},
    });

    const storedRaw = mockStorage[DUBBING_SESSION_STORAGE_KEY];
    assert.ok(storedRaw, "Session backup must be present in sessionStorage");

    // Binary / Blob URLs must NOT be in the stored string
    assert.ok(!storedRaw.includes("mock-audio-blob"), "Storage payload must strip blob URLs");
    assert.ok(!storedRaw.includes("mock-fitted-blob"), "Storage payload must strip fitted blob URLs");

    // Lightweight size check: should be small (< 5KB for 2 cues)
    assert.ok(storedRaw.length < 5000, `Stored payload size (${storedRaw.length} chars) should be well within quota`);
  });

  await t.test("on reload, marks previously generated audio segments as needs_generation", () => {
    const loaded = loadDubbingSessionBackup();
    assert.ok(loaded, "Must successfully restore session");

    const { backup, restoredAudioSegments } = loaded;
    assert.equal(backup.originalCues.length, 2);
    assert.equal(backup.translatedCues.length, 2);
    assert.equal(backup.translatedCues[0].text, "Hello world edited");
    assert.equal(backup.translatedCues[0].isEdited, true);

    // Verify audio status turned to needs_generation
    assert.ok(restoredAudioSegments[1]);
    assert.equal(restoredAudioSegments[1].status, "needs_generation");
    assert.equal(restoredAudioSegments[1].audioUrl, undefined);
    assert.equal(restoredAudioSegments[1].fittedAudioUrl, undefined);

    assert.ok(restoredAudioSegments[2]);
    assert.equal(restoredAudioSegments[2].status, "needs_generation");
  });

  await t.test("clearDubbingSessionBackup removes entry from storage", () => {
    clearDubbingSessionBackup();
    assert.equal(mockStorage[DUBBING_SESSION_STORAGE_KEY], undefined);
    const loaded = loadDubbingSessionBackup();
    assert.equal(loaded, null);
  });
});

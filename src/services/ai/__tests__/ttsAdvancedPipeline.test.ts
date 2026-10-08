import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeTestAi } from "../testing/recordingAiBackend";
import {
  saveTtsAdvancedSettings,
  getDefaultTtsAdvancedSettings,
  OMNIVOICE_PRESETS,
  CHATTERBOX_PRESETS,
} from "../ttsAdvancedSettings";
import { TtsExecutor } from "../../batch/executors/ttsExecutor";
import { BatchJob } from "../../../types/batch";

describe("Global Advanced TTS Settings - Pipeline Transmission & Snapshot Freeze", () => {
  beforeEach(async () => {
    await saveTtsAdvancedSettings(getDefaultTtsAdvancedSettings());
  });

  it("automatically attaches active global settings to LocalAiServices.synthesize", async () => {
    // 1. Configure OmniVoice with Stable preset
    const customSettings = getDefaultTtsAdvancedSettings();
    customSettings.omnivoice.preset = "stable";
    customSettings.omnivoice.settings = { ...OMNIVOICE_PRESETS.stable };
    await saveTtsAdvancedSettings(customSettings);

    const { ai, backend } = makeTestAi();

    // Call synthesize without explicit advancedSettings
    await ai.synthesize({
      model: "omnivoice",
      voiceId: "default",
      text: "Xin chào thế giới",
      outputPath: "test.wav",
    });

    const synthCall = backend.calls.find((c) => c.method === "tts.synthesize");
    assert.ok(synthCall, "tts.synthesize must be invoked");
    const adv = synthCall.params.advancedSettings as Record<string, unknown>;
    assert.ok(adv, "advancedSettings must be present in params");
    assert.equal(adv.num_step, 40);
    assert.equal(adv.guidance_scale, 2.5);
    assert.equal(adv.denoise, true);
  });

  it("attaches engine-specific settings when switching engines", async () => {
    // Configure Chatterbox with Expressive preset
    const customSettings = getDefaultTtsAdvancedSettings();
    customSettings.chatterbox.preset = "expressive";
    customSettings.chatterbox.settings = { ...CHATTERBOX_PRESETS.expressive };
    await saveTtsAdvancedSettings(customSettings);

    const { ai, backend } = makeTestAi();

    // Call Chatterbox
    await ai.synthesize({
      model: "chatterbox-turbo",
      voiceId: "default",
      text: "Hello from Chatterbox Turbo",
      outputPath: "chatter.wav",
    });

    const chatterCall = backend.calls.find((c) => c.method === "tts.synthesize");
    assert.ok(chatterCall);
    const adv = chatterCall.params.advancedSettings as Record<string, unknown>;
    assert.equal(adv.temperature, 0.95);
    assert.equal(adv.top_k, 1500);
    assert.equal(adv.repetition_penalty, 1.15);
  });

  it("respects explicit task snapshot over current global settings", async () => {
    // Current global is Balanced (num_step = 32)
    const { ai, backend } = makeTestAi();

    // Explicit task snapshot with num_step = 64
    const frozenSnapshot = {
      num_step: 64,
      guidance_scale: 3.5,
      denoise: false,
    };

    await ai.synthesize({
      model: "omnivoice",
      voiceId: "default",
      text: "Testing snapshot override",
      outputPath: "override.wav",
      advancedSettings: frozenSnapshot,
    });

    const call = backend.calls.find((c) => c.method === "tts.synthesize");
    assert.ok(call);
    const adv = call.params.advancedSettings as Record<string, unknown>;
    assert.equal(adv.num_step, 64);
    assert.equal(adv.guidance_scale, 3.5);
    assert.equal(adv.denoise, false);
  });

  it("freezes snapshot for TtsExecutor so mid-flight setting changes do not alter job execution", async () => {
    // 1. Initial setting: num_step = 32
    await saveTtsAdvancedSettings(getDefaultTtsAdvancedSettings());

    const { ai, backend } = makeTestAi();

    const job: BatchJob = {
      id: "job-freeze-test",
      stage: "queued",
      queueOrder: 1,
      sourceFilePath: "D:/Test/script.txt",
      sourceFileName: "script.txt",
      sourceFileSize: 1024,
      sourceFileMtime: 1000,
      fileKind: "text",
      selectedTasks: ["tts"],
      executionSequence: ["tts"],
      currentStepIndex: 0,
      hasCustomConfig: false,
      stepResults: {},
      configOverrides: {
        tts: {
          model: "omnivoice",
          voiceId: "omnivoice-auto",
          speed: 1.0,
          pitch: 0,
          volume: 100,
        },
      },
      outputSnapshot: {
        saveInSourceFolder: false,
        resolvedOutputDirectory: "C:/VoxLabExports",
        collisionPolicy: "auto_rename",
        outputAudioFormat: "wav",
        outputSubtitleFormat: "srt",
      },
      artifacts: { ownedArtifactPaths: [] },
      status: "waiting",
      progressPct: 0,
      createdAt: 1000,
    };

    // Execute TTS job with 2 chunks via [PAUSE] token
    const textContent = "Câu thứ nhất rất rõ ràng. [PAUSE 500ms] Câu thứ hai tiếp nối mượt mà.";
    const resultPromise = TtsExecutor.execute(job, {
      textContent,
      ai,
      writeFile: async () => {},
    });

    // Mid-flight: modify global settings to num_step = 96
    const modified = getDefaultTtsAdvancedSettings();
    modified.omnivoice.settings.num_step = 96;
    await saveTtsAdvancedSettings(modified);

    const stepResult = await resultPromise;
    assert.equal(stepResult.status, "completed", `Job failed with: ${stepResult.error}`);

    // Verify all synthesized chunks used the initial frozen snapshot (num_step = 32)
    const synthCalls = backend.calls.filter((c) => c.method === "tts.synthesize");
    assert.ok(synthCalls.length >= 2, "Expected at least 2 synthesized chunks");
    for (const sc of synthCalls) {
      const adv = sc.params.advancedSettings as Record<string, unknown>;
      assert.equal(adv.num_step, 32, "Job chunk must use frozen snapshot num_step=32, not modified 96");
    }
  });
});

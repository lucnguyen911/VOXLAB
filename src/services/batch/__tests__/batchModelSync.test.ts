import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  RecordingAiBackend,
  memoryAiFs,
  makeTestAi,
} from "../../ai/testing/recordingAiBackend";
import { LocalAiServices } from "../../ai/localAiServices";
import { TranscriptionExecutor } from "../executors/transcriptionExecutor";
import { TtsExecutor } from "../executors/ttsExecutor";
import { DialogueExecutor } from "../executors/dialogueExecutor";
import { DubbingExecutor } from "../executors/dubbingExecutor";
import { BatchOrchestrator } from "../batchOrchestrator";
import {
  edgeTtsProvider,
  googleTranslateTtsProvider,
} from "../../providers";
import {
  resolveBatchVoiceTarget,
  resolveBatchModelForVoiceProfile,
  resolveBatchWhisperModelId,
} from "../batchModelResolver";
import { hydrateBatchGlobalDefaultsFromWorkspaces } from "../batchWorkspaceSync";
import {
  upsertCloneVoice,
  removeCloneVoice,
  listCloneVoices,
} from "../../ai/cloneVoiceRegistry";
import { BatchJob } from "../../../types/batch";

function createBaseJob(overrides: Partial<BatchJob> = {}): BatchJob {
  return {
    id: "job-sync-1",
    stage: "queued",
    queueOrder: 1,
    sourceFilePath: "D:/Media/su_that_1.mp4",
    sourceFileName: "su_that_1.mp4",
    sourceFileSize: 1024,
    sourceFileMtime: 1000,
    fileKind: "media",
    selectedTasks: ["transcription"],
    executionSequence: ["transcription"],
    currentStepIndex: 0,
    configOverrides: {},
    hasCustomConfig: false,
    outputSnapshot: {
      saveInSourceFolder: false,
      resolvedOutputDirectory: "F:/VoxLabExports",
      collisionPolicy: "auto_rename",
      outputAudioFormat: "wav",
      outputSubtitleFormat: "srt",
    },
    artifacts: { ownedArtifactPaths: [] },
    status: "waiting",
    progressPct: 0,
    stepResults: {},
    createdAt: 1000,
    ...overrides,
  };
}

describe("Batch Model & Voice Synchronization Suite (All 5 Tasks)", () => {
  const registeredCloneIds: string[] = [];

  afterEach(async () => {
    for (const id of registeredCloneIds.splice(0)) {
      await removeCloneVoice(id).catch(() => {});
    }
  });

  it("resolves short Whisper model IDs to faster-whisper-<id> in custom modelsDir and forwards modelsDir to asr.load", async () => {
    for (const [rawId, expectedCanonical, expectedFolder] of [
      ["large-v3-turbo", "large-v3-turbo", "faster-whisper-large-v3-turbo"],
      ["large-v3", "large-v3", "faster-whisper-large-v3"],
      ["medium", "medium", "faster-whisper-medium"],
      ["small", "small", "faster-whisper-small"],
      ["auto", "large-v3-turbo", "faster-whisper-large-v3-turbo"],
    ] as const) {
      assert.equal(resolveBatchWhisperModelId(rawId), expectedCanonical);
      const backend = new RecordingAiBackend({
        asrSegments: [{ id: 0, startSec: 0.2, endSec: 1.8, text: "Test subtitle cue." }],
      });
      const ai = new LocalAiServices(backend, memoryAiFs(), () => ({
        modelsDir: "F:/Model AI Local",
        device: "cuda",
        asrModelId: "faster-whisper-small",
      }));

      const job = createBaseJob({
        id: `job-whisper-${rawId}`,
        configOverrides: {
          transcription: {
            audioLanguage: "en",
            whisperModel: rawId,
            speechSpeed: 1.0,
            outputFormat: "srt",
          },
        },
      });

      const res = await TranscriptionExecutor.execute(job, {
        ai,
        writeFile: async () => {},
      });
      assert.equal(res.status, "completed");

      const loadCall = backend.calls.find((c) => c.method === "asr.load");
      assert.ok(loadCall, "asr.load must be called");
      assert.equal(loadCall.params.modelDir, `F:/Model AI Local/${expectedFolder}`);
      assert.equal(loadCall.params.modelsDir, "F:/Model AI Local");
      assert.equal(loadCall.params.modelId, expectedCanonical);
    }
  });

  it("sets retryFromStep = 'transcription' when step 0 fails on media job (never mislabels failed step as TTS)", async () => {
    const orchestrator = BatchOrchestrator.getInstance();
    orchestrator._resetForTest();
    try {
      const { ai } = makeTestAi({
        failOn: {
          method: "asr.load",
          code: "MODEL_NOT_FOUND",
          message: "faster-whisper model 'large-v3-turbo' not found on disk",
        },
      });
      orchestrator.ai = ai;

      const mediaJob = createBaseJob({
        id: "job-su-that-1",
        stage: "queued",
        selectedTasks: ["transcription"],
        executionSequence: ["transcription"],
      });
      orchestrator.setJobs([mediaJob]);
      await orchestrator.startQueue();

      const updated = orchestrator.getJobs().find((j) => j.id === "job-su-that-1");
      assert.ok(updated);
      assert.equal(updated.status, "failed");
      assert.equal(updated.retryFromStep, "transcription");

      // Retrying resets the failed transcription step to waiting
      orchestrator.retryJob("job-su-that-1");
      const retried = orchestrator.getJobs().find((j) => j.id === "job-su-that-1");
      assert.equal(retried?.stepResults.transcription?.status, "waiting");
    } finally {
      orchestrator._resetForTest();
    }
  });

  it("dispatches Chatterbox Turbo and Qwen3-TTS cloned voices to their bound engine even when snapshot model is default 'omnivoice'", async () => {
    const cbCloneId = "clone_cb_sync_test";
    await upsertCloneVoice({
      id: cbCloneId,
      name: "Chatterbox Clone",
      refAudioPath: "D:/Voices/cb_ref.wav",
      refText: "Hello world reference sample.",
      engine: "chatterbox_turbo",
      language: "en",
      durationSec: 7.5,
      createdAt: Date.now(),
    });
    registeredCloneIds.push(cbCloneId);

    const qwenCloneId = "clone_qwen_sync_test";
    await upsertCloneVoice({
      id: qwenCloneId,
      name: "Qwen Clone",
      refAudioPath: "D:/Voices/qwen_ref.wav",
      refText: "Hello world reference sample.",
      engine: "qwen_tts_1_7b",
      language: "en",
      durationSec: 7.5,
      createdAt: Date.now(),
    });
    registeredCloneIds.push(qwenCloneId);

    assert.ok(listCloneVoices().some((v) => v.id === cbCloneId));
    assert.equal(
      resolveBatchVoiceTarget(cbCloneId, "omnivoice").model,
      "chatterbox_turbo"
    );
    assert.equal(
      resolveBatchVoiceTarget(qwenCloneId, "omnivoice").model,
      "qwen_tts_1_7b"
    );
    assert.equal(
      resolveBatchVoiceTarget("kokoro_af_heart", "omnivoice").model,
      "kokoro_82m"
    );

    // Execute TtsExecutor with clone_cb_sync_test while snapshot.model is default "omnivoice"
    const backend = new RecordingAiBackend();
    const ai = new LocalAiServices(
      backend,
      memoryAiFs(),
      () => ({
        modelsDir: "F:/Model AI Local",
        device: "cuda",
        asrModelId: "faster-whisper-large-v3-turbo",
      }),
      (voiceId) =>
        voiceId === cbCloneId
          ? {
              refAudioPath: "D:/Voices/cb_ref.wav",
              refText: "Hello world reference sample.",
              language: "en",
            }
          : null
    );

    const ttsJob = createBaseJob({
      id: "job-tts-cb-clone",
      fileKind: "text",
      sourceFileName: "script.txt",
      sourceFilePath: "D:/Scripts/script.txt",
      selectedTasks: ["tts"],
      executionSequence: ["tts"],
      configOverrides: {
        tts: {
          model: "omnivoice", // static schema default must NOT shadow cloneBoundEngine!
          voiceId: cbCloneId,
          speed: 1.0,
          pitch: 1.0,
          volume: 100,
        },
      },
    });

    const res = await TtsExecutor.execute(ttsJob, {
      textContent: "Hello everyone, welcome back to our robotics channel.",
      ai,
      writeFile: async () => {},
    });
    assert.equal(res.status, "completed");

    const ttsLoad = backend.calls.find((c) => c.method === "tts.load");
    assert.ok(ttsLoad);
    assert.equal(ttsLoad.runtime, "chatterbox");
    assert.equal(ttsLoad.params.engine, "chatterbox");
    assert.equal(ttsLoad.params.modelDir, "F:/Model AI Local/chatterbox-turbo");
  });

  it("supports online Edge TTS and Google TTS in DubbingExecutor and DialogueExecutor without requiring local OmniVoice", async () => {
    const origEdgeSynth = edgeTtsProvider.synthesize.bind(edgeTtsProvider);
    const origGoogleSynth = googleTranslateTtsProvider.synthesize.bind(
      googleTranslateTtsProvider
    );
    const edgeCalls: string[] = [];
    const googleCalls: string[] = [];

    (edgeTtsProvider as { synthesize: typeof edgeTtsProvider.synthesize }).synthesize =
      async (opts) => {
        edgeCalls.push(opts.outputPath);
        return {
          outputPath: opts.outputPath,
          durationSec: 1.2,
          sampleRate: 24000,
          sizeBytes: 4096,
          format: "mp3",
        };
      };
    (
      googleTranslateTtsProvider as {
        synthesize: typeof googleTranslateTtsProvider.synthesize;
      }
    ).synthesize = async (opts) => {
      googleCalls.push(opts.outputPath);
      return {
        outputPath: opts.outputPath,
        durationSec: 1.2,
        sampleRate: 24000,
        sizeBytes: 4096,
        format: "wav",
      };
    };

    try {
      // Simulate CPU-only machine where CUDA-only OmniVoice would fail if resolveEngine were called!
      const backend = new RecordingAiBackend();
      const ai = new LocalAiServices(backend, memoryAiFs(), () => ({
        modelsDir: "F:/Model AI Local",
        device: "cpu",
        asrModelId: "faster-whisper-small",
      }));

      // 1. DubbingExecutor with Edge online voice
      const dubJob = createBaseJob({
        id: "job-dub-edge",
        selectedTasks: ["dubbing"],
        executionSequence: ["dubbing"],
        configOverrides: {
          dubbing: {
            ttsModel: "omnivoice",
            voiceId: "edge_vi_hoaimy",
            speedMultiplier: 1.0,
            turnPauseSec: 0.3,
          },
        },
      });
      const dubRes = await DubbingExecutor.execute(dubJob, {
        subtitleContent:
          "1\n00:00:01,000 --> 00:00:04,000\nXin chào mọi người.\n",
        ai,
        writeFile: async () => {},
      });
      assert.equal(dubRes.status, "completed");
      assert.equal(edgeCalls.length, 1);
      assert.ok(edgeCalls[0].endsWith(".mp3"));
      assert.equal(
        backend.calls.filter((c) => c.method === "tts.load" || c.method === "tts.synthesize")
          .length,
        0,
        "Online Edge voice must never load local TTS models"
      );

      // 2. DialogueExecutor with mixed Google TTS + Edge TTS character voices
      const dlgJob = createBaseJob({
        id: "job-dlg-online",
        fileKind: "text",
        sourceFileName: "dialogue.txt",
        sourceFilePath: "D:/Scripts/dialogue.txt",
        selectedTasks: ["dialogue"],
        executionSequence: ["dialogue"],
        configOverrides: {
          dialogue: {
            model: "omnivoice",
            defaultVoiceId: "edge_vi_hoaimy",
            sameSpeakerPauseSec: 0.3,
            characterVoices: {
              Alex: "google_en_us",
              Mai: "edge_vi_hoaimy",
            },
            exportSrt: true,
          },
        },
      });
      const dlgRes = await DialogueExecutor.execute(dlgJob, {
        scriptContent: "[Alex]: Hello from Google TTS.\n[Mai]: Xin chào từ Edge TTS.",
        ai,
        writeFile: async () => {},
      });
      assert.equal(dlgRes.status, "completed");
      assert.equal(googleCalls.length, 1);
      assert.ok(googleCalls[0].endsWith(".wav"));
      assert.equal(edgeCalls.length, 2);
      assert.equal(
        backend.calls.filter((c) => c.method === "tts.load" || c.method === "tts.synthesize")
          .length,
        0
      );
    } finally {
      (edgeTtsProvider as { synthesize: typeof edgeTtsProvider.synthesize }).synthesize =
        origEdgeSynth;
      (
        googleTranslateTtsProvider as {
          synthesize: typeof googleTranslateTtsProvider.synthesize;
        }
      ).synthesize = origGoogleSynth;
    }
  });

  it("maps voice profiles to their exact canonical batch model IDs and hydrates workspace defaults", () => {
    assert.equal(
      resolveBatchModelForVoiceProfile(
        { id: "kokoro_af_heart", provider: "local", engine: "kokoro_82m" },
        "omnivoice"
      ),
      "kokoro_82m"
    );
    assert.equal(
      resolveBatchModelForVoiceProfile(
        { id: "clone_custom_1", origin: "clone", provider: "clone", engine: "qwen_tts_1_7b" },
        "omnivoice"
      ),
      "qwen_tts_1_7b"
    );

    const hydrated = hydrateBatchGlobalDefaultsFromWorkspaces({
      tts: { model: "omnivoice", voiceId: "omnivoice-auto", speed: 1, pitch: 1, volume: 100 },
      dialogue: {
        model: "omnivoice",
        defaultVoiceId: "omnivoice-auto",
        sameSpeakerPauseSec: 0.3,
        exportSrt: true,
      },
      dubbing: {
        ttsModel: "omnivoice",
        voiceId: "omnivoice-auto",
        speedMultiplier: 1,
        turnPauseSec: 0.3,
      },
    });
    assert.notEqual(hydrated.tts?.voiceId, "omnivoice-auto");
    assert.notEqual(hydrated.dialogue?.defaultVoiceId, "omnivoice-auto");
    assert.notEqual(hydrated.dubbing?.voiceId, "omnivoice-auto");
    assert.ok(hydrated.transcription?.whisperModel);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TranslationExecutor } from "../executors/translationExecutor";
import { DubbingExecutor } from "../executors/dubbingExecutor";
import { BatchJob } from "../../../types/batch";
import { makeTestAi } from "../../ai/testing/recordingAiBackend";

describe("Translation & Dubbing Step Executors (TASK-09 / AC-05, AC-07, AC-08, AC-11, AC-18)", () => {
  const sampleSrt = `1
00:00:01,000 --> 00:00:04,000
Hello everyone and welcome to our show.

2
00:00:05,000 --> 00:00:08,000
Today we will explore artificial intelligence in voice dubbing.
`;

  const baseJob: BatchJob = {
    id: "job-trans-dub-1",
    stage: "queued",
    queueOrder: 1,
    sourceFilePath: "D:/Videos/tech_talk.mp4",
    sourceFileName: "tech_talk.mp4",
    sourceFileSize: 2048,
    sourceFileMtime: 1000,
    fileKind: "media",
    selectedTasks: ["translation", "dubbing"],
    executionSequence: ["translation", "dubbing"],
    currentStepIndex: 0,
    configOverrides: {
      translation: {
        providerId: "google",
        sourceLanguage: "en",
        targetLanguage: "vi",
        style: "default",
        outputFormat: "srt",
      },
      dubbing: {
        ttsModel: "omnivoice",
        voiceId: "omnivoice-auto",
        speedMultiplier: 1.0,
        turnPauseSec: 0.5,
      },
    },
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
  };

  describe("TranslationExecutor", () => {
    it("translates subtitle cues 1:1 and outputs translated SRT", async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (url: string | URL | Request) => {
        const u = String(url);
        const match = u.match(/[?&]q=([^&]+)/);
        const text = match ? decodeURIComponent(match[1]) : "Dịch mẫu";
        return new Response(JSON.stringify([[["Bản dịch: " + text, text]]]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      try {
        const writtenFiles = new Map<string, Uint8Array | string>();
        const result = await TranslationExecutor.execute(baseJob, {
          subtitleContent: sampleSrt,
          sourceLanguage: "en",
          writeFile: async (path, content) => {
            writtenFiles.set(path, content);
          },
        });

        assert.equal(result.status, "completed");
        assert.equal(result.progressPct, 100);
        assert.ok(result.outputArtifactPaths.length > 0);

        const srtPath = result.outputArtifactPaths[0];
        assert.ok(srtPath.includes("_vi.srt"));

        const srtContent = writtenFiles.get(srtPath) as string;
        assert.ok(srtContent.includes("00:00:01,000 --> 00:00:04,000"));
        assert.ok(srtContent.includes("00:00:05,000 --> 00:00:08,000"));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("skips translation when detected sourceLanguage matches targetLanguage (AC-07)", async () => {
      const sameLangJob: BatchJob = {
        ...baseJob,
        stepResults: {
          transcription: {
            task: "transcription",
            status: "completed",
            progressPct: 100,
            outputArtifactPaths: ["out.srt"],
            stageMessage: "Ngôn ngữ nhận diện: vi",
          },
        },
      };

      const result = await TranslationExecutor.execute(sameLangJob, {
        subtitleContent: sampleSrt,
        sourceLanguage: "vi", // matches targetLanguage: "vi"
      });

      assert.equal(result.status, "skipped");
      assert.equal(result.outputArtifactPaths.length, 0);
      assert.ok(result.skipReason?.includes("trùng"));
    });

    it("cancels immediately when isCancelled returns true", async () => {
      const result = await TranslationExecutor.execute(baseJob, {
        subtitleContent: sampleSrt,
        isCancelled: () => true,
      });

      assert.equal(result.status, "cancelled");
      assert.equal(result.outputArtifactPaths.length, 0);
    });
  });

  describe("DubbingExecutor", () => {
    it("synthesizes audio cues, passes collision analysis, and exports Master WAV", async () => {
      const { ai, backend } = makeTestAi({ durationFor: () => 1.5 });
      const result = await DubbingExecutor.execute(baseJob, {
        subtitleContent: sampleSrt,
        writeFile: async () => {},
        ai,
      });

      assert.equal(result.status, "completed");
      assert.equal(result.progressPct, 100);
      assert.ok(result.outputArtifactPaths.length > 0);

      const audioPath = result.outputArtifactPaths.find((p) => p.endsWith(".wav"));
      assert.ok(audioPath, "Master WAV path must be registered");

      // Master is a timeline assembly of the real per-cue TTS files placed at cue start times.
      const synths = backend.calls.filter((c) => c.method === "tts.synthesize");
      assert.ok(synths.length >= 2);
      const assemble = backend.calls.find((c) => c.method === "audio.assemble");
      assert.equal(assemble?.params.mode, "timeline");
      assert.equal(assemble?.params.outputPath, audioPath);
      const inputs = assemble?.params.inputs as { path: string; startSec: number }[];
      assert.deepEqual(inputs.map((i) => i.startSec), [1, 5]);
    });

    it("CRITICAL AC-11: When collision_danger detected, blocks Master WAV and returns completed_with_warning", async () => {
      const result = await DubbingExecutor.execute(baseJob, {
        subtitleContent: sampleSrt,
        forceCollisionDangerForTest: true,
        ai: makeTestAi().ai,
      });

      assert.equal(result.status, "completed_with_warning");
      assert.equal(result.outputArtifactPaths.length, 0);
      assert.ok(result.warning?.includes("collision_danger"));
      assert.ok(result.warning?.includes("chặn tạo tệp Master audio"));
    });

    it("AC-11: Technical error returns failed without corrupting state", async () => {
      const result = await DubbingExecutor.execute(baseJob, {
        subtitleContent: sampleSrt,
        forceTechnicalErrorForTest: true,
        ai: makeTestAi().ai,
      });

      assert.equal(result.status, "failed");
      assert.ok(result.error?.includes("Sự cố kỹ thuật"));
    });

    it("fails explicitly when the local AI runtime is unavailable", async () => {
      const result = await DubbingExecutor.execute(baseJob, { subtitleContent: sampleSrt });
      assert.equal(result.status, "failed");
      assert.equal(result.outputArtifactPaths.length, 0);
    });

    it("rejects an engine that cannot speak the target language (no silent fallback)", async () => {
      const job: BatchJob = {
        ...baseJob,
        configOverrides: { ...baseJob.configOverrides, dubbing: { ...baseJob.configOverrides.dubbing!, ttsModel: "qwen_tts_1_7b" } },
      };
      const { ai, backend } = makeTestAi();
      const result = await DubbingExecutor.execute(job, { subtitleContent: "1\n00:00:01,000 --> 00:00:03,000\nXin chào các bạn.\n", ai });
      assert.equal(result.status, "failed");
      assert.equal(backend.calls.filter((c) => c.method === "tts.synthesize").length, 0);
    });

    it("cancels cleanly when isCancelled returns true", async () => {
      const result = await DubbingExecutor.execute(baseJob, {
        subtitleContent: sampleSrt,
        isCancelled: () => true,
        ai: makeTestAi().ai,
      });

      assert.equal(result.status, "cancelled");
      assert.equal(result.outputArtifactPaths.length, 0);
    });
  });
});

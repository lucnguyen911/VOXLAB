import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TranscriptionExecutor } from "../executors/transcriptionExecutor";
import { BatchJob } from "../../../types/batch";
import { makeTestAi } from "../../ai/testing/recordingAiBackend";

describe("ASR Transcription Step Executor (TASK-08 / AC-09, AC-10, AC-20)", () => {
  const baseMediaJob: BatchJob = {
    id: "job-asr-1",
    stage: "queued",
    queueOrder: 1,
    sourceFilePath: "D:/Videos/interview.mp4",
    sourceFileName: "interview.mp4",
    sourceFileSize: 1048576,
    sourceFileMtime: 1000,
    fileKind: "media",
    selectedTasks: ["transcription"],
    executionSequence: ["transcription"],
    currentStepIndex: 0,
    configOverrides: {
      transcription: {
        audioLanguage: "auto",
        whisperModel: "base",
        speechSpeed: 1.0,
        outputFormat: "srt",
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

  it("CRITICAL INVARIANT: Text files strictly never run Whisper ASR (skipped with reason)", async () => {
    const textJob: BatchJob = {
      ...baseMediaJob,
      id: "job-text-asr",
      fileKind: "text",
    };

    const result = await TranscriptionExecutor.execute(textJob);

    assert.equal(result.status, "skipped");
    assert.equal(result.outputArtifactPaths.length, 0);
    assert.ok(result.skipReason?.includes("không sử dụng Whisper ASR"));
  });

  it("transcribes media file via the ASR runtime, remaps timeline, and exports SRT subtitle", async () => {
    const writtenFiles = new Map<string, Uint8Array | string>();
    const progressUpdates: number[] = [];
    const { ai, backend } = makeTestAi({
      asrLanguage: "vi",
      asrSegments: [{ id: 0, startSec: 0.4, endSec: 2.1, text: " Xin chào các bạn." }],
    });

    const result = await TranscriptionExecutor.execute(baseMediaJob, {
      onProgress: (pct) => progressUpdates.push(pct),
      writeFile: async (path, content) => {
        writtenFiles.set(path, content);
      },
      ai,
    });

    assert.equal(result.status, "completed");
    assert.equal(result.progressPct, 100);
    assert.ok(result.outputArtifactPaths.length > 0);
    assert.ok(result.stageMessage?.includes("vi"));

    const srtPath = result.outputArtifactPaths.find((p) => p.endsWith(".srt"));
    assert.ok(srtPath, "SRT path must be registered");

    const srtContent = writtenFiles.get(srtPath!) as string;
    assert.ok(srtContent.includes("00:00:00,400 --> 00:00:02,100"));
    assert.ok(srtContent.includes("Xin chào"));

    const t = backend.calls.find((c) => c.method === "asr.transcribe");
    assert.equal(t?.params.audioPath, "D:/Videos/interview.mp4");
    assert.equal(t?.params.wordTimestamps, true);
    assert.deepEqual(backend.methods(), ["asr.load", "asr.transcribe"]);
  });

  it("fails explicitly when the local AI runtime is unavailable (no fixed segments)", async () => {
    const result = await TranscriptionExecutor.execute(baseMediaJob, {});
    assert.equal(result.status, "failed");
    assert.ok(result.error?.includes("Local AI runtime"));
  });

  it("fails when Whisper returns no speech instead of emitting placeholder cues", async () => {
    const { ai } = makeTestAi({ asrSegments: [] });
    const result = await TranscriptionExecutor.execute(baseMediaJob, { ai });
    assert.equal(result.status, "failed");
    assert.equal(result.outputArtifactPaths.length, 0);
  });

  it("maps a sidecar CANCELLED error to a cancelled step", async () => {
    const { ai } = makeTestAi({ failOn: { method: "asr.transcribe", code: "CANCELLED" } });
    const result = await TranscriptionExecutor.execute(baseMediaJob, { ai });
    assert.equal(result.status, "cancelled");
  });

  it("remaps timestamps when speechSpeed is slowed (0.8x)", async () => {
    const slowedJob: BatchJob = {
      ...baseMediaJob,
      id: "job-slowed",
      configOverrides: {
        transcription: {
          audioLanguage: "vi",
          whisperModel: "base",
          speechSpeed: 0.8,
          outputFormat: "srt",
        },
      },
    };

    const writtenFiles = new Map<string, Uint8Array | string>();
    const mockSegments = [
      { id: 1, startSec: 10.0, endSec: 20.0, text: "Đoạn đã được kéo chậm 0.8x" },
    ];

    const result = await TranscriptionExecutor.execute(slowedJob, {
      mockSegments,
      writeFile: async (path, content) => {
        writtenFiles.set(path, content);
      },
    });

    assert.equal(result.status, "completed");
    const srtPath = result.outputArtifactPaths[0];
    const srtContent = writtenFiles.get(srtPath) as string;

    // 10.0 * 0.8 = 8.0s -> 00:00:08,000
    // 20.0 * 0.8 = 16.0s -> 00:00:16,000
    assert.ok(srtContent.includes("00:00:08,000 --> 00:00:16,000"));
  });

  it("implements Monolithic Safe Cancel: returns cancelled without throwing", async () => {
    const result = await TranscriptionExecutor.execute(baseMediaJob, {
      isCancelled: () => true,
    });

    assert.equal(result.status, "cancelled");
    assert.equal(result.outputArtifactPaths.length, 0);
  });
});

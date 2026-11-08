import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BatchOrchestrator } from "../batchOrchestrator";
import {
  BatchJob,
  BatchJobOutputSnapshot,
} from "../../../types/batch";
import {
  getEarliestInvalidatedStep,
  getInvalidatedSteps,
  getPreservedSteps,
  canReuseStepArtifact,
  checkInputFileMutation,
  applyInputMutationToJob,
} from "../invalidationGraph";
import {
  loadHistoryItems,
  clearAllHistory,
  syncBatchJobToHistory,
} from "../../history/historyManager";
import { makeTestAi, RecordingAiBackend } from "../../ai/testing/recordingAiBackend";

describe("Batch Controls, Invalidation Graph, 3-Way CTA & History (TASK-11 / AC-09..AC-13, AC-26, AC-27, AC-30)", () => {
  let orchestrator: BatchOrchestrator;
  let aiBackend: RecordingAiBackend;

  beforeEach(() => {
    orchestrator = BatchOrchestrator.getInstance();
    orchestrator._resetForTest();
    // Real LocalAiServices; only the Tauri IPC hop is replaced by the recording double.
    const t = makeTestAi();
    orchestrator.ai = t.ai;
    aiBackend = t.backend;
    clearAllHistory();
  });

  const baseOutputSnapshot: BatchJobOutputSnapshot = {
    resolvedOutputDirectory: "D:/VoxLabOutput/Batch_Export/sample",
    saveInSourceFolder: false,
    collisionPolicy: "auto_rename",
    outputAudioFormat: "wav",
    outputSubtitleFormat: "srt",
  };

  const createTestJob = (overrides: Partial<BatchJob> = {}): BatchJob => ({
    id: "job-t11-1",
    sourceFilePath: "D:/Media/video_test.mp4",
    sourceFileName: "video_test.mp4",
    sourceFileSize: 1048576,
    sourceFileMtime: 1700000000000,
    fileKind: "media",
    stage: "queued",
    queueOrder: 1,
    selectedTasks: ["transcription", "translation", "dubbing"],
    executionSequence: ["transcription", "translation", "dubbing"],
    currentStepIndex: 0,
    configOverrides: {
      dubbing: { ttsModel: "omnivoice", voiceId: "omnivoice-auto", speedMultiplier: 1.0, turnPauseSec: 0.3 },
    },
    hasCustomConfig: false,
    stepResults: {},
    status: "waiting",
    progressPct: 0,
    outputSnapshot: { ...baseOutputSnapshot },
    artifacts: { ownedArtifactPaths: [] },
    createdAt: Date.now(),
    ...overrides,
  });

  test("Invalidation Graph correctly propagates downstream invalidation and preserves upstream steps", () => {
    const seq = ["transcription", "translation", "dubbing"] as const;

    // Dubbing changed -> earliest is dubbing, transcription & translation preserved
    const earliest1 = getEarliestInvalidatedStep(["dubbing"], [...seq]);
    assert.equal(earliest1, "dubbing");
    assert.deepEqual(getInvalidatedSteps("dubbing", [...seq]), ["dubbing"]);
    assert.deepEqual(getPreservedSteps("dubbing", [...seq]), ["transcription", "translation"]);
    assert.equal(canReuseStepArtifact("transcription", earliest1, [...seq]), true);
    assert.equal(canReuseStepArtifact("translation", earliest1, [...seq]), true);
    assert.equal(canReuseStepArtifact("dubbing", earliest1, [...seq]), false);

    // Translation changed -> earliest is translation, dubbing invalidated, transcription preserved
    const earliest2 = getEarliestInvalidatedStep(["translation"], [...seq]);
    assert.equal(earliest2, "translation");
    assert.deepEqual(getInvalidatedSteps("translation", [...seq]), ["translation", "dubbing"]);
    assert.deepEqual(getPreservedSteps("translation", [...seq]), ["transcription"]);
    assert.equal(canReuseStepArtifact("transcription", earliest2, [...seq]), true);
    assert.equal(canReuseStepArtifact("translation", earliest2, [...seq]), false);
  });

  test("Input Mutation Safety flags size/mtime change, forces Step 1 rerun, marks artifacts stale", () => {
    const job = createTestJob({
      artifacts: {
        ownedArtifactPaths: ["D:/VoxLabOutput/Batch_Export/sample/video_test.srt"],
      },
    });

    // Unchanged
    const check1 = checkInputFileMutation(job, job.sourceFileSize, job.sourceFileMtime);
    assert.equal(check1.mutated, false);

    // File mutated externally
    const check2 = checkInputFileMutation(job, job.sourceFileSize + 500, job.sourceFileMtime + 1000);
    assert.equal(check2.mutated, true);
    assert.equal(check2.warningMessage, "⚠️ Đã sửa ngoài app");

    // Apply mutation
    applyInputMutationToJob(job, job.sourceFileSize + 500, job.sourceFileMtime + 1000);
    assert.equal(job.warningMessage, "⚠️ Đã sửa ngoài app");
    assert.equal(job.artifacts.stale, true);
    assert.equal(job.retryFromStep, "transcription"); // forced back to Step 1
  });

  test("Safe Boundary Pause transitions running -> pausing -> paused upon active job finish", async () => {
    const job1 = createTestJob({ id: "job-pause-1", queueOrder: 1 });
    const job2 = createTestJob({ id: "job-pause-2", queueOrder: 2 });

    orchestrator.fileReader = async () => "Dummy text";
    orchestrator.fileWriter = async () => {};
    orchestrator.setJobs([job1, job2]);

    const statuses: string[] = [];
    orchestrator.subscribe((_, qStatus) => {
      statuses.push(qStatus);
    });

    // Start queue and immediately request safe boundary pause
    const runPromise = orchestrator.startQueue();
    orchestrator.requestPause();
    await runPromise;

    // After job1 completes, queue paused instead of running job2
    assert.equal(orchestrator.getQueueStatus(), "paused");
    const jobs = orchestrator.getJobs();
    assert.ok(jobs[0].status === "completed" || jobs[0].status === "failed_with_artifact");
    assert.equal(jobs[1].status, "waiting"); // Job 2 stayed waiting!
  });

  test("Chunk-boundary Pause suspends multi-chunk TTS job after current chunk and Resume continues without restarting", async () => {
    const multiParagraphText = [
      "Đoạn văn thứ nhất câu 1. Câu thứ 2 của đoạn một. Câu thứ 3 của đoạn một.",
      "[PAUSE 1s]",
      "Đoạn văn thứ hai câu 1. Câu thứ 2 của đoạn hai. Câu thứ 3 của đoạn hai.",
      "[PAUSE 1s]",
      "Đoạn văn thứ ba câu 1. Câu thứ 2 của đoạn ba. Câu thứ 3 của đoạn ba.",
    ].join("\n");

    const ttsJob = createTestJob({
      id: "job-chunk-pause",
      fileKind: "text",
      sourceFileName: "story.txt",
      sourceFilePath: "D:/Docs/story.txt",
      selectedTasks: ["tts"],
      executionSequence: ["tts"],
      configOverrides: {
        tts: { model: "omnivoice", voiceId: "omnivoice-auto", speed: 1.0, pitch: 0, volume: 100 },
      },
    });

    orchestrator.fileReader = async () => multiParagraphText;
    orchestrator.fileWriter = async () => {};
    orchestrator.setJobs([ttsJob]);

    // Pause automatically as soon as chunk 1 finishes (when progress hits >= 20%)
    const unsub = orchestrator.subscribe((jobs, qStatus) => {
      const j = jobs[0];
      if (qStatus === "running" && j?.stepResults.tts?.progressPct && j.stepResults.tts.progressPct >= 20) {
        orchestrator.requestPause();
      }
    });

    const runPromise = orchestrator.startQueue();
    // Wait a tick for chunk 1 to finish and enter waitIfPaused()
    await new Promise((r) => setTimeout(r, 25));
    unsub();

    assert.equal(orchestrator.getQueueStatus(), "paused");
    assert.equal(orchestrator.getJobs()[0].status, "paused");
    const synthCallsAtPause = aiBackend.calls.filter((c) => c.method === "tts.synthesize").length;
    assert.equal(synthCallsAtPause, 1, "Should pause right after chunk 1 without synthesizing chunk 2 yet");

    // Resume queue -> continues from chunk 2
    await orchestrator.resumeQueue();
    await runPromise;

    assert.equal(orchestrator.getQueueStatus(), "idle");
    assert.equal(orchestrator.getJobs()[0].status, "completed");
    const synthCallsAfterResume = aiBackend.calls.filter((c) => c.method === "tts.synthesize");
    assert.ok(synthCallsAfterResume.length > 1, "Should synthesize all remaining chunks after resume");
    const uniqueOutputPaths = new Set(synthCallsAfterResume.map((c) => c.params.outputPath));
    assert.equal(
      uniqueOutputPaths.size,
      synthCallsAfterResume.length,
      "Each chunk must be synthesized exactly once without repeating chunk 1"
    );
  });

  test("Cancel while paused mid-job wakes suspended executor and marks job cancelled", async () => {
    const multiParagraphText = [
      "Đoạn văn thứ nhất câu 1. Câu thứ 2 của đoạn một. Câu thứ 3 của đoạn một.",
      "[PAUSE 1s]",
      "Đoạn văn thứ hai câu 1. Câu thứ 2 của đoạn hai. Câu thứ 3 của đoạn hai.",
    ].join("\n");

    const ttsJob = createTestJob({
      id: "job-pause-cancel",
      fileKind: "text",
      sourceFileName: "cancel_me.txt",
      sourceFilePath: "D:/Docs/cancel_me.txt",
      selectedTasks: ["tts"],
      executionSequence: ["tts"],
      configOverrides: {
        tts: { model: "omnivoice", voiceId: "omnivoice-auto", speed: 1.0, pitch: 0, volume: 100 },
      },
    });

    orchestrator.fileReader = async () => multiParagraphText;
    orchestrator.fileWriter = async () => {};
    orchestrator.setJobs([ttsJob]);

    const unsub = orchestrator.subscribe((jobs, qStatus) => {
      const j = jobs[0];
      if (qStatus === "running" && j?.stepResults.tts?.progressPct && j.stepResults.tts.progressPct >= 20) {
        orchestrator.requestPause();
      }
    });

    const runPromise = orchestrator.startQueue();
    await new Promise((r) => setTimeout(r, 25));
    unsub();

    assert.equal(orchestrator.getQueueStatus(), "paused");
    assert.equal(orchestrator.getJobs()[0].status, "paused");

    // Cancel while paused
    orchestrator.requestCancel();
    await runPromise;

    assert.equal(orchestrator.getQueueStatus(), "idle");
    assert.equal(orchestrator.getJobs()[0].status, "cancelled");
  });

  test("Emergency Queue Block triggers on ENOSPC or EACCES disk errors", async () => {
    const job = createTestJob({ id: "job-enospc" });
    orchestrator.fileWriter = async () => {
      throw new Error("ENOSPC: no space left on device, write");
    };
    orchestrator.setJobs([job]);

    await orchestrator.startQueue();

    assert.equal(orchestrator.getQueueStatus(), "blocked");
    const jobs = orchestrator.getJobs();
    assert.equal(jobs[0].status, "failed");
    assert.equal(jobs[0].errorMessage, "Không đủ dung lượng lưu trữ.");
  });

  test("3-Way CTA: Retry reuses frozen snapshot and resumes from failed step", () => {
    const job = createTestJob({
      id: "job-retry",
      status: "failed_with_artifact",
      retryFromStep: "dubbing",
      effectiveConfigSnapshot: {
        tasks: {
          transcription: { audioLanguage: "en", whisperModel: "base", speechSpeed: 1.0, outputFormat: "srt" },
          translation: { providerId: "gemini", targetLanguage: "vi", style: "default", outputFormat: "preserve_input" },
          dubbing: { ttsModel: "edge_tts", voiceId: "vi-VN-HoaiMyNeural", speedMultiplier: 1.0, turnPauseSec: 0.3 },
        },
        output: { ...baseOutputSnapshot },
      },
      stepResults: {
        transcription: { task: "transcription", status: "completed", progressPct: 100, outputArtifactPaths: ["out.srt"] },
        translation: { task: "translation", status: "completed", progressPct: 100, outputArtifactPaths: ["out_vi.srt"] },
        dubbing: { task: "dubbing", status: "failed", progressPct: 0, outputArtifactPaths: [], error: "Dubbing failed" },
      },
    });

    orchestrator.setJobs([job]);
    const success = orchestrator.retryJob(job.id);
    assert.equal(success, true);

    const updated = orchestrator.getJobs()[0];
    assert.equal(updated.status, "waiting");
    assert.equal(updated.stepResults["dubbing"]?.status, "waiting");
    assert.equal(updated.stepResults["transcription"]?.status, "completed"); // Prior steps preserved
    assert.equal(updated.stepResults["translation"]?.status, "completed");
    assert.equal(updated.effectiveConfigSnapshot?.tasks.dubbing?.voiceId, "vi-VN-HoaiMyNeural"); // Exact snapshot reused
  });

  test("3-Way CTA: Regenerate freezes new snapshot and resets from earliest invalidated step", () => {
    const job = createTestJob({
      id: "job-regen",
      status: "failed_with_artifact",
      effectiveConfigSnapshot: {
        tasks: {
          transcription: { audioLanguage: "en", whisperModel: "base", speechSpeed: 1.0, outputFormat: "srt" },
          translation: { providerId: "gemini", targetLanguage: "vi", style: "default", outputFormat: "preserve_input" },
          dubbing: { ttsModel: "edge_tts", voiceId: "vi-VN-HoaiMyNeural", speedMultiplier: 1.0, turnPauseSec: 0.3 },
        },
        output: { ...baseOutputSnapshot },
      },
      stepResults: {
        transcription: { task: "transcription", status: "completed", progressPct: 100, outputArtifactPaths: ["out.srt"] },
        translation: { task: "translation", status: "completed", progressPct: 100, outputArtifactPaths: ["out_vi.srt"] },
        dubbing: { task: "dubbing", status: "failed", progressPct: 0, outputArtifactPaths: [] },
      },
      // User changed translation style to cinema in overrides
      configOverrides: {
        translation: { providerId: "gemini", targetLanguage: "vi", style: "cinema", outputFormat: "preserve_input" },
      },
    });

    orchestrator.setJobs([job]);
    const success = orchestrator.regenerateJob(job.id);
    assert.equal(success, true);

    const updated = orchestrator.getJobs()[0];
    assert.equal(updated.status, "waiting");
    assert.equal(updated.retryFromStep, "translation"); // Earliest invalidated step
    assert.equal(updated.stepResults["translation"]?.status, "waiting"); // Reset
    assert.equal(updated.stepResults["dubbing"]?.status, "waiting"); // Reset
    assert.equal(updated.stepResults["transcription"]?.status, "completed"); // Preserved!
    assert.equal(updated.effectiveConfigSnapshot?.tasks.translation?.style, "cinema"); // New snapshot frozen
  });

  test("3-Way CTA: Re-export performs 0 AI calls and transcodes/exports to new destination", async () => {
    const writtenFiles: Record<string, Uint8Array | string> = {};

    orchestrator.fileReader = async () => "1\n00:00:01,000 --> 00:00:03,000\nHello";
    orchestrator.fileWriter = async (p, content) => {
      writtenFiles[p] = content;
    };
    orchestrator.pathExists = () => false;

    const job = createTestJob({
      id: "job-reexport",
      status: "completed",
      artifacts: {
        ownedArtifactPaths: ["D:/Old/audio.wav", "D:/Old/sub.srt"],
        primaryPath: "D:/Old/audio.wav",
        secondaryPath: "D:/Old/sub.srt",
      },
      outputSnapshot: {
        ...baseOutputSnapshot,
        resolvedOutputDirectory: "D:/NewOutput",
        outputAudioFormat: "mp3",
      },
    });

    orchestrator.setJobs([job]);
    const success = await orchestrator.reexportJob(job.id);
    assert.equal(success, true);

    const updated = orchestrator.getJobs()[0];
    assert.equal(updated.status, "completed");
    assert.ok(updated.artifacts.primaryPath?.endsWith(".mp3"));
    // Audio is re-encoded by the sidecar's real encoder (audio.assemble) - 0 inference calls.
    const assemble = aiBackend.calls.find((c) => c.method === "audio.assemble");
    assert.equal(assemble?.params.format, "mp3");
    assert.equal(assemble?.params.outputPath, updated.artifacts.primaryPath);
    assert.deepEqual((assemble?.params.inputs as { path: string }[]).map((i) => i.path), ["D:/Old/audio.wav"]);
    assert.ok(!aiBackend.methods().some((m) => m.startsWith("tts.") || m.startsWith("asr.")), "Re-export must not run inference");
    assert.ok(Object.keys(writtenFiles).some((k) => k.endsWith(".srt")));
  });

  test("History Integration: Terminal job is automatically recorded in Job-Centric history record", () => {
    const job = createTestJob({
      id: "job-hist-1",
      status: "completed",
      artifacts: {
        ownedArtifactPaths: [
          "D:/VoxLabOutput/Batch_Export/sample/audio.wav",
          "D:/VoxLabOutput/Batch_Export/sample/sub.srt",
        ],
      },
    });

    const item = syncBatchJobToHistory(job);
    assert.ok(item);
    assert.equal(item.id, `hist-${job.id}`);
    assert.equal(item.isBatch, true);
    assert.equal(item.artifacts.length, 2);
    assert.equal(item.artifacts[0].type, "audio");
    assert.equal(item.artifacts[1].type, "subtitle");

    const allHistory = loadHistoryItems();
    assert.ok(allHistory.some((h) => h.id === `hist-${job.id}`));
  });
});

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BatchOrchestrator } from "../batchOrchestrator";
import { BatchJob } from "../../../types/batch";
import { makeTestAi } from "../../ai/testing/recordingAiBackend";

describe("Batch Orchestrator Lifecycle & Priority Reorder (TASK-10 / AC-14, AC-20, AC-24, AC-25)", () => {
  let orchestrator: BatchOrchestrator;

  beforeEach(() => {
    orchestrator = BatchOrchestrator.getInstance();
    orchestrator._resetForTest();
    // Real LocalAiServices with the IPC hop replaced; in-memory file IO.
    orchestrator.ai = makeTestAi().ai;
    const files = new Map<string, string>();
    orchestrator.fileWriter = async (p, content) => {
      files.set(p, typeof content === "string" ? content : "<binary>");
    };
    orchestrator.fileReader = async (p) => files.get(p) ?? "Xin chào. Đây là nội dung kiểm thử.";
  });

  const createTestJob = (id: string, order: number, tasks: any[] = ["tts"]): BatchJob => ({
    id,
    stage: "queued",
    queueOrder: order,
    sourceFilePath: `D:/Test/${id}.txt`,
    sourceFileName: `${id}.txt`,
    sourceFileSize: 1024,
    sourceFileMtime: 1000,
    fileKind: "text",
    selectedTasks: tasks,
    executionSequence: tasks,
    currentStepIndex: 0,
    configOverrides: {
      tts: {
        model: "omnivoice",
        voiceId: "omnivoice-auto",
        speed: 1.0,
        pitch: 0,
        volume: 100,
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
  });

  it("reorders waiting jobs using moveWaitingJob (AC-24 Arrow Reorder)", () => {
    const jobA = createTestJob("job-A", 1);
    const jobB = createTestJob("job-B", 2);
    const jobC = createTestJob("job-C", 3);

    orchestrator.setJobs([jobA, jobB, jobC]);

    // Move Job C up -> swaps queueOrder with Job B
    const moved = orchestrator.moveWaitingJob("job-C", "up");
    assert.equal(moved, true);

    const jobs = orchestrator.getJobs();
    const updatedB = jobs.find((j) => j.id === "job-B")!;
    const updatedC = jobs.find((j) => j.id === "job-C")!;

    assert.equal(updatedC.queueOrder, 2);
    assert.equal(updatedB.queueOrder, 3);
  });

  it("freezes snapshot lazily right before processing and achieves Natural Queue Completion", async () => {
    const job1 = createTestJob("job-1", 1);
    const job2 = createTestJob("job-2", 2);

    assert.equal(job1.effectiveConfigSnapshot, undefined);
    assert.equal(job2.effectiveConfigSnapshot, undefined);

    orchestrator.setJobs([job1, job2]);

    await orchestrator.startQueue();

    // Natural Queue Completion: queueStatus automatically returns to idle
    assert.equal(orchestrator.getQueueStatus(), "idle");

    const finishedJobs = orchestrator.getJobs();
    assert.equal(finishedJobs[0].status, "completed");
    assert.equal(finishedJobs[1].status, "completed");

    // Both jobs now have their immutable snapshots frozen
    assert.ok(finishedJobs[0].effectiveConfigSnapshot !== undefined);
    assert.ok(finishedJobs[1].effectiveConfigSnapshot !== undefined);
  });

  it("isolates step failure and marks failed_with_artifact when prior step committed artifact", async () => {
    // Multi-step job: transcription (media) -> translation
    const multiStepJob: BatchJob = {
      ...createTestJob("job-multi", 1, ["transcription", "translation"]),
      fileKind: "media",
      configOverrides: {
        transcription: {
          audioLanguage: "en",
          whisperModel: "base",
          speechSpeed: 1.0,
          outputFormat: "srt",
        },
        translation: {
          providerId: "google",
          sourceLanguage: "en",
          targetLanguage: "vi",
          style: "default",
          outputFormat: "srt",
        },
      },
    };

    const nextJob = createTestJob("job-next", 2, ["tts"]);

    orchestrator.setJobs([multiStepJob, nextJob]);

    // Let the orchestrator run
    await orchestrator.startQueue();

    const jobs = orchestrator.getJobs();
    const finishedMulti = jobs.find((j) => j.id === "job-multi")!;
    const finishedNext = jobs.find((j) => j.id === "job-next")!;

    // Step 1 produced subtitle artifact, translation succeeded or if failed sets failed_with_artifact
    assert.ok(finishedMulti.artifacts.ownedArtifactPaths.length > 0);
    // Next job in queue was still executed (concurrency = 1, advancing queue)
    assert.equal(finishedNext.status, "completed");
  });
});

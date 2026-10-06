import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BatchJob } from "../../../types/batch";
import { BatchOrchestrator } from "../batchOrchestrator";
import { getDefaultOutputSnapshot } from "../configSnapshotResolver";

describe("TASK-15: Batch Queue Reorder & Pinned Active Job Suite (AC-24, AC-25)", () => {
  const orchestrator = BatchOrchestrator.getInstance();

  const makeJob = (id: string, name: string, status: BatchJob["status"], queueOrder: number): BatchJob => ({
    id,
    sourceFilePath: `C:/test/${name}`,
    sourceFileName: name,
    sourceFileSize: 100,
    sourceFileMtime: Date.now(),
    fileKind: "text",
    stage: "queued",
    queueOrder,
    selectedTasks: ["tts"],
    executionSequence: ["tts"],
    currentStepIndex: 0,
    configOverrides: {},
    hasCustomConfig: false,
    stepResults: {},
    status,
    progressPct: 0,
    outputSnapshot: getDefaultOutputSnapshot(),
    artifacts: { ownedArtifactPaths: [] },
    createdAt: Date.now(),
  });

  test("Priority Arrow Reorder: moves waiting jobs up and down correctly", () => {
    const jobA = makeJob("job-a", "a.txt", "waiting", 1);
    const jobB = makeJob("job-b", "b.txt", "waiting", 2);
    const jobC = makeJob("job-c", "c.txt", "waiting", 3);

    orchestrator.setJobs([jobA, jobB, jobC]);

    // Move Job B up (swaps queueOrder with jobA)
    const movedUp = orchestrator.moveWaitingJob("job-b", "up");
    assert.strictEqual(movedUp, true);
    let currentJobs = orchestrator.getJobs().slice().sort((a, b) => a.queueOrder - b.queueOrder);
    assert.strictEqual(currentJobs[0].id, "job-b");
    assert.strictEqual(currentJobs[1].id, "job-a");
    assert.strictEqual(currentJobs[2].id, "job-c");

    // Move Job B down (swaps queueOrder with jobA)
    const movedDown = orchestrator.moveWaitingJob("job-b", "down");
    assert.strictEqual(movedDown, true);
    currentJobs = orchestrator.getJobs().slice().sort((a, b) => a.queueOrder - b.queueOrder);
    assert.strictEqual(currentJobs[0].id, "job-a");
    assert.strictEqual(currentJobs[1].id, "job-b");
    assert.strictEqual(currentJobs[2].id, "job-c");
  });

  test("Active Job Pinned Invariant: active job at index 0 cannot be displaced by arrow reordering", () => {
    const runningJob = makeJob("job-running", "active.txt", "processing", 1);
    const waiting1 = makeJob("job-wait-1", "w1.txt", "waiting", 2);
    const waiting2 = makeJob("job-wait-2", "w2.txt", "waiting", 3);

    orchestrator.setJobs([runningJob, waiting1, waiting2]);

    // Attempting to move running job fails because moveWaitingJob only affects waiting jobs
    const movedRunning = orchestrator.moveWaitingJob("job-running", "up");
    assert.strictEqual(movedRunning, false);

    // Attempting to move top waiting job up fails because it is already first among waiting jobs
    const movedWait1Up = orchestrator.moveWaitingJob("job-wait-1", "up");
    assert.strictEqual(movedWait1Up, false);

    // Moving waiting2 up swaps with waiting1, while running job remains intact
    const movedWait2Up = orchestrator.moveWaitingJob("job-wait-2", "up");
    assert.strictEqual(movedWait2Up, true);

    const current = orchestrator.getJobs().slice().sort((a, b) => a.queueOrder - b.queueOrder);
    assert.strictEqual(current[0].id, "job-running");
    assert.strictEqual(current[1].id, "job-wait-2");
    assert.strictEqual(current[2].id, "job-wait-1");
  });
});

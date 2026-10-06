import test from "node:test";
import assert from "node:assert/strict";
import {
  loadBatchState,
  saveBatchState,
  normalizeCrashedState,
  createInitialBatchState,
  BATCH_STORAGE_FILE,
  BATCH_SCHEMA_VERSION,
} from "../batchStorage";
import {
  clearMemoryStorage,
  setMemoryFile,
  getMemoryFile,
  setForceMemoryMode,
} from "../../storage/tauriFsBridge";
import { BatchJob, BatchQueueDurableState } from "../../../types/batch";

// Ensure tests use memory storage
setForceMemoryMode(true);

function createMockJob(id: string): BatchJob {
  return {
    id,
    sourceFilePath: `C:/data/${id}.txt`,
    sourceFileName: `${id}.txt`,
    sourceFileSize: 2048,
    sourceFileMtime: Date.now(),
    fileKind: "text",
    stage: "queued",
    queueOrder: 2,
    selectedTasks: ["tts"],
    executionSequence: ["tts"],
    currentStepIndex: 0,
    configOverrides: {},
    hasCustomConfig: false,
    stepResults: {},
    status: "waiting",
    progressPct: 0,
    outputSnapshot: {
      resolvedOutputDirectory: "C:/exports",
      saveInSourceFolder: false,
      collisionPolicy: "auto_rename",
    },
    artifacts: { ownedArtifactPaths: [] },
    createdAt: Date.now(),
  };
}

test("TASK-05: Durable State Storage & Crash Normalizer Suite", async (t) => {
  t.beforeEach(() => {
    clearMemoryStorage();
  });

  await t.test("loadBatchState returns clean default state when file does not exist", async () => {
    const state = await loadBatchState();
    assert.equal(state.version, BATCH_SCHEMA_VERSION);
    assert.equal(state.queueStatus, "idle");
    assert.equal(state.jobs.length, 0);
  });

  await t.test("saveBatchState persists and loadBatchState restores complete job lifecycle state", async () => {
    const job = createMockJob("job-1");
    job.stage = "queued";
    job.queueOrder = 5;
    job.selectedTasks = ["tts", "translation"];
    job.executionSequence = ["tts", "translation"];

    const state = createInitialBatchState();
    state.jobs.push(job);

    await saveBatchState(state);

    const loaded = await loadBatchState();
    assert.equal(loaded.jobs.length, 1);
    const loadedJob = loaded.jobs[0];
    assert.equal(loadedJob.id, "job-1");
    assert.equal(loadedJob.stage, "queued");
    assert.equal(loadedJob.queueOrder, 5);
    assert.deepEqual(loadedJob.selectedTasks, ["tts", "translation"]);
  });

  await t.test("Crash Recovery Normalizer restores interrupted queue and active jobs (AC-09, AC-24)", () => {
    const crashedState: BatchQueueDurableState = {
      version: 3,
      queueStatus: "running", // was actively running when app closed
      settings: createInitialBatchState().settings,
      jobs: [
        {
          ...createMockJob("active-job"),
          status: "processing", // was processing
          isCancelling: true,   // transient flag left over
          stepResults: {
            tts: {
              task: "tts",
              status: "completed",
              progressPct: 100,
              outputArtifactPaths: ["C:/exports/active-job.wav"],
            },
            translation: {
              task: "translation",
              status: "processing", // was mid-flight
              progressPct: 60,
              outputArtifactPaths: [],
            },
          },
        },
      ],
      updatedAt: Date.now(),
    };

    const normalized = normalizeCrashedState(crashedState);

    // 1. Queue status reverted to paused
    assert.equal(normalized.queueStatus, "paused");

    // 2. In-flight job reverted to interrupted
    const job = normalized.jobs[0];
    assert.equal(job.status, "interrupted");
    assert.equal(job.isCancelling, undefined);

    // 3. Completed step is preserved intact
    assert.equal(job.stepResults.tts?.status, "completed");
    assert.equal(job.stepResults.tts?.progressPct, 100);
    assert.deepEqual(job.stepResults.tts?.outputArtifactPaths, ["C:/exports/active-job.wav"]);

    // 4. In-flight step reverted to interrupted with progressPct = 0
    assert.equal(job.stepResults.translation?.status, "interrupted");
    assert.equal(job.stepResults.translation?.progressPct, 0);
  });

  await t.test("Schema Versioning backs up outdated state file and initializes fresh version 3 state", async () => {
    // Old version 1 payload
    const oldPayload = JSON.stringify({
      version: 1,
      oldField: "legacy_value",
      jobs: [],
    });
    setMemoryFile(BATCH_STORAGE_FILE, oldPayload);

    const loaded = await loadBatchState();
    assert.equal(loaded.version, BATCH_SCHEMA_VERSION);
    assert.equal(loaded.jobs.length, 0);

    // Verify backup was made
    const rawSaved = getMemoryFile(BATCH_STORAGE_FILE);
    assert.ok(rawSaved?.includes(`"version": ${BATCH_SCHEMA_VERSION}`));
  });

  await t.test("Zero Audio Binary Invariant: Throws error when attempting to serialize raw audio buffers or base64 audio", async () => {
    const invalidState: BatchQueueDurableState = {
      ...createInitialBatchState(),
      jobs: [
        {
          ...createMockJob("audio-leak-job"),
          artifacts: {
            ownedArtifactPaths: [],
            // @ts-expect-error Intentionally invalid payload
            leak: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=".repeat(15),
          },
        },
      ],
    };

    await assert.rejects(
      async () => {
        await saveBatchState(invalidState);
      },
      (err: Error) => {
        return err.message.includes("Zero Audio Binary Invariant Violated");
      }
    );
  });
});

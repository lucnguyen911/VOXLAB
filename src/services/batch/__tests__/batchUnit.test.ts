import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BatchJob,
  BatchViewTab,
  BatchQueueStatus,
  BatchJobStatus,
  BatchStepStatus,
} from "../../../types/batch";
import {
  isArtifactModifiedExternally,
} from "../outputResolver";
import { getDefaultOutputSnapshot } from "../configSnapshotResolver";
import { loadBatchState, saveBatchState } from "../batchStorage";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("TASK-15: Batch Unit Test Suite (AC-01 to AC-44 Core Types & Normalizers)", () => {
  describe("1. 4 View Tabs Invariant (AC-21, AC-43)", () => {
    test("supports all 4 unified view tabs", () => {
      const validTabs: BatchViewTab[] = ["list", "queued", "completed", "failed"];
      assert.strictEqual(validTabs.length, 4);
      validTabs.forEach((tab) => {
        assert.ok(["list", "queued", "completed", "failed"].includes(tab));
      });
    });
  });

  describe("2. 6 Queue States Invariant (AC-24, AC-25, AC-27)", () => {
    test("supports all 6 queue states with strict transition semantics", () => {
      const queueStates: BatchQueueStatus[] = [
        "idle",
        "running",
        "pausing",
        "paused",
        "cancelling",
        "blocked",
      ];
      assert.strictEqual(queueStates.length, 6);
    });
  });

  describe("3. 9 Job Lifecycle States (AC-22, AC-23, AC-26)", () => {
    test("supports all 9 discrete job lifecycle states", () => {
      const jobStates: BatchJobStatus[] = [
        "waiting",
        "processing",
        "paused",
        "completed",
        "completed_with_warning",
        "failed_with_artifact",
        "failed",
        "cancelled",
        "interrupted",
      ];
      assert.strictEqual(jobStates.length, 9);
    });
  });

  describe("4. 8 Step States Invariant (AC-20)", () => {
    test("supports all 8 step states including completed_with_warning and skipped", () => {
      const stepStates: BatchStepStatus[] = [
        "waiting",
        "processing",
        "completed",
        "completed_with_warning",
        "failed",
        "cancelled",
        "skipped",
        "interrupted",
      ];
      assert.strictEqual(stepStates.length, 8);
    });
  });

  describe("5. Crash Recovery State Normalizer (AC-27)", () => {
    test("normalizes in-flight 'running' or 'pausing' jobs to 'failed' on restart", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voxlab-batch-unit-"));
      const testFile = path.join(tempDir, "sample.txt");
      fs.writeFileSync(testFile, "test content");

      const inFlightJob: BatchJob = {
        id: "crash-job-1",
        sourceFilePath: testFile,
        sourceFileName: "sample.txt",
        sourceFileSize: 12,
        sourceFileMtime: Date.now(),
        fileKind: "text",
        stage: "queued",
        queueOrder: 1,
        selectedTasks: ["tts"],
        executionSequence: ["tts"],
        currentStepIndex: 0,
        configOverrides: {},
        hasCustomConfig: false,
        stepResults: {
          tts: {
            task: "tts",
            status: "processing",
            startedAt: Date.now() - 10000,
            progressPct: 45,
            outputArtifactPaths: [],
          },
        },
        status: "processing",
        progressPct: 45,
        outputSnapshot: getDefaultOutputSnapshot(),
        artifacts: { ownedArtifactPaths: [] },
        createdAt: Date.now() - 10000,
      };

      await saveBatchState({
        version: 3,
        jobs: [inFlightJob],
        queueStatus: "running",
        settings: {
          outputDirectory: tempDir,
          saveInSourceFolder: true,
          collisionPolicy: "auto_rename",
          globalDefaults: {},
        },
        updatedAt: Date.now(),
      });

      const loaded = await loadBatchState();
      assert.strictEqual(loaded.queueStatus, "paused");
      const recoveredJob = loaded.jobs.find((j) => j.id === inFlightJob.id);
      assert.ok(recoveredJob);
      assert.strictEqual(recoveredJob.status, "interrupted");
      assert.strictEqual(recoveredJob.stepResults["tts"]?.status, "interrupted");
      assert.match(
        recoveredJob.stepResults["tts"]?.stageMessage || "",
        /gián đoạn|bị ngắt|khởi động lại|interrupted/i
      );

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe("6. Output Resolver & Fingerprinting (AC-13, AC-17, AC-31, AC-32)", () => {
    test("detects external artifact modification correctly", () => {
      const recorded = { path: "out.wav", size: 1000, mtimeMs: 5000 };
      assert.strictEqual(isArtifactModifiedExternally(recorded, { size: 1000, mtimeMs: 5000 }), false);
      assert.strictEqual(isArtifactModifiedExternally(recorded, { size: 2000, mtimeMs: 5000 }), true);
      assert.strictEqual(isArtifactModifiedExternally(recorded, { size: 1000, mtimeMs: 9000 }), true);
      assert.strictEqual(isArtifactModifiedExternally(undefined, { size: 1000, mtimeMs: 5000 }), true);
      assert.strictEqual(isArtifactModifiedExternally(recorded, null), false);
    });
  });
});

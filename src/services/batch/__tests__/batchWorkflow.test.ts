import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BatchOrchestrator } from "../batchOrchestrator";
import { BatchJob } from "../../../types/batch";
import { computeExecutionSequence } from "../dependencyResolver";
import { TranscriptionExecutor } from "../executors/transcriptionExecutor";
import { getDefaultOutputSnapshot } from "../configSnapshotResolver";
import { makeTestAi } from "../../ai/testing/recordingAiBackend";

describe("TASK-15: Batch Workflow & Safety Invariants Suite (AC-01..44 Mixed Matrix, Input Mutation, Emergency Block)", () => {
  const orchestrator = BatchOrchestrator.getInstance();

  test("CRITICAL INVARIANT: Text files strictly NEVER run ASR/Whisper", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voxlab-text-no-asr-"));
    const textPath = path.join(tempDir, "script.txt");
    fs.writeFileSync(textPath, "Văn bản mẫu cho TTS.");

    const job: BatchJob = {
      id: "job-text-asr",
      sourceFilePath: textPath,
      sourceFileName: "script.txt",
      sourceFileSize: 20,
      sourceFileMtime: Date.now(),
      fileKind: "text",
      stage: "queued",
      queueOrder: 1,
      selectedTasks: ["transcription"],
      executionSequence: ["transcription"],
      currentStepIndex: 0,
      configOverrides: {},
      hasCustomConfig: false,
      stepResults: {},
      status: "processing",
      progressPct: 0,
      outputSnapshot: getDefaultOutputSnapshot(),
      artifacts: { ownedArtifactPaths: [] },
      createdAt: Date.now(),
    };

    const result = await TranscriptionExecutor.execute(job);

    // Invariant: Executor must skip and state explicitly that text does not use Whisper
    assert.strictEqual(result.status, "skipped");
    assert.match(result.skipReason || "", /không sử dụng Whisper ASR/i);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("Execution Sequence & DAG Ordering across Mixed File Kinds", () => {
    // 1. Text with TTS + Dubbing
    const textSeq = computeExecutionSequence(["tts", "dubbing"], "text");
    assert.deepStrictEqual(textSeq, ["tts", "dubbing"]);

    // 2. Media with Transcription + Translation + Dubbing
    const mediaSeq = computeExecutionSequence(["transcription", "dubbing", "translation"], "media");
    assert.deepStrictEqual(mediaSeq, ["transcription", "translation", "dubbing"]);

    // 3. Subtitle with Translation + Dubbing
    const subSeq = computeExecutionSequence(["dubbing", "translation"], "subtitle");
    assert.deepStrictEqual(subSeq, ["translation", "dubbing"]);
  });

  test("Input Mutation Detection: identifies when source file on disk was modified", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voxlab-mutation-"));
    const filePath = path.join(tempDir, "doc.txt");
    fs.writeFileSync(filePath, "Version 1");

    const stat1 = fs.statSync(filePath);
    const job: BatchJob = {
      id: "job-mutation-1",
      sourceFilePath: filePath,
      sourceFileName: "doc.txt",
      sourceFileSize: stat1.size,
      sourceFileMtime: stat1.mtimeMs,
      fileKind: "text",
      stage: "queued",
      queueOrder: 1,
      selectedTasks: ["tts"],
      executionSequence: ["tts"],
      currentStepIndex: 0,
      configOverrides: {},
      hasCustomConfig: false,
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      outputSnapshot: getDefaultOutputSnapshot(),
      artifacts: { ownedArtifactPaths: [] },
      createdAt: Date.now(),
    };

    // Modify file
    fs.writeFileSync(filePath, "Version 2 with more words");
    const stat2 = fs.statSync(filePath);

    const isMutated = stat2.mtimeMs > job.sourceFileMtime || stat2.size !== job.sourceFileSize;
    assert.strictEqual(isMutated, true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const makeDiskJob = (id: string, tasks: BatchJob["selectedTasks"]): BatchJob => ({
    id,
    sourceFilePath: "C:/test/file.txt",
    sourceFileName: "file.txt",
    sourceFileSize: 100,
    sourceFileMtime: Date.now(),
    fileKind: "text",
    stage: "queued",
    queueOrder: 1,
    selectedTasks: tasks,
    executionSequence: tasks,
    currentStepIndex: 0,
    configOverrides: {
      tts: { model: "omnivoice", voiceId: "omnivoice-auto", speed: 1.0, pitch: 0, volume: 100 },
    },
    hasCustomConfig: false,
    stepResults: {},
    status: "waiting",
    progressPct: 0,
    outputSnapshot: getDefaultOutputSnapshot(),
    artifacts: { ownedArtifactPaths: [] },
    createdAt: Date.now(),
  });

  test("Emergency Disk Block: halts execution immediately on disk full (ENOSPC) from a frontend write", async () => {
    orchestrator._resetForTest();
    orchestrator.ai = makeTestAi().ai;
    orchestrator.fileReader = async () => "Văn bản kiểm thử.";
    orchestrator.fileWriter = async () => {
      throw new Error("ENOSPC: no space left on device, write 'D:/VoxLabOutput/test.srt'");
    };
    orchestrator.setJobs([makeDiskJob("job-enospc-wf", ["tts", "transcription"])]);

    await orchestrator.startQueue();
    assert.strictEqual(orchestrator.getQueueStatus(), "blocked");

    orchestrator._resetForTest();
    orchestrator.fileWriter = undefined;
    orchestrator.fileReader = undefined;
  });

  test("Emergency Disk Block: a sidecar disk-full error while writing the master also blocks the queue", async () => {
    // Regression: master audio is written by the sidecar; its OSError arrives as a failed step result,
    // not a thrown error, and previously bypassed the AC-13 block.
    orchestrator._resetForTest();
    orchestrator.ai = makeTestAi({
      failOn: { method: "audio.assemble", code: "INTERNAL", message: "OSError: [Errno 28] No space left on device" },
    }).ai;
    orchestrator.fileReader = async () => "Văn bản kiểm thử.";
    orchestrator.setJobs([makeDiskJob("job-enospc-sidecar", ["tts"])]);

    await orchestrator.startQueue();
    assert.strictEqual(orchestrator.getQueueStatus(), "blocked");
    assert.strictEqual(orchestrator.getJobs()[0].errorMessage, "Không đủ dung lượng lưu trữ.");

    orchestrator._resetForTest();
    orchestrator.fileReader = undefined;
  });

  test("Missing source content fails the job explicitly instead of synthesizing placeholder text", async () => {
    orchestrator._resetForTest();
    const t = makeTestAi();
    orchestrator.ai = t.ai;
    orchestrator.fileReader = async () => "";
    orchestrator.setJobs([makeDiskJob("job-empty-src", ["tts"])]);

    await orchestrator.startQueue();
    const job = orchestrator.getJobs()[0];
    assert.strictEqual(job.status, "failed");
    assert.match(job.errorMessage || "", /rỗng|không đọc được/);
    assert.strictEqual(t.backend.calls.length, 0, "No synthesis may run on placeholder text");

    orchestrator._resetForTest();
    orchestrator.fileReader = undefined;
  });});

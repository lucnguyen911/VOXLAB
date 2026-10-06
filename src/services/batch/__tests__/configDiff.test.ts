import test from "node:test";
import assert from "node:assert/strict";
import { computeJobConfigDiff } from "../configDiffResolver";
import {
  resolveEffectiveConfig,
  getDefaultTaskConfigMap,
  getDefaultOutputSnapshot,
} from "../configSnapshotResolver";
import { BatchJob } from "../../../types/batch";

function createMockFailedJob(): BatchJob {
  const defaultSnapshot = resolveEffectiveConfig(
    getDefaultTaskConfigMap(),
    {},
    getDefaultOutputSnapshot()
  );

  return {
    id: "failed-job-1",
    sourceFilePath: "C:/media/sample.mp4",
    sourceFileName: "sample.mp4",
    sourceFileSize: 204800,
    sourceFileMtime: Date.now(),
    fileKind: "media",
    stage: "queued",
    queueOrder: 1,
    selectedTasks: ["transcription", "translation", "dubbing"],
    executionSequence: ["transcription", "translation", "dubbing"],
    currentStepIndex: 1,
    configOverrides: {},
    effectiveConfigSnapshot: defaultSnapshot,
    hasCustomConfig: false,
    stepResults: {
      transcription: {
        task: "transcription",
        status: "completed",
        progressPct: 100,
        outputArtifactPaths: ["C:/media/sample.srt"],
      },
      translation: {
        task: "translation",
        status: "failed",
        progressPct: 40,
        outputArtifactPaths: [],
        error: "Translation API rate limit exceeded",
      },
    },
    status: "failed_with_artifact",
    progressPct: 45,
    outputSnapshot: getDefaultOutputSnapshot(),
    artifacts: {
      primaryPath: "C:/media/sample.srt",
      ownedArtifactPaths: ["C:/media/sample.srt"],
    },
    createdAt: Date.now(),
  };
}

test("TASK-04: Config Diff Resolver & 3-Way Dynamic CTA Suite", async (t) => {
  await t.test("Unchanged config returns hasChanged: false and CTA [Thử lại] (Retry)", () => {
    const job = createMockFailedJob();
    const workingConfig = resolveEffectiveConfig(
      getDefaultTaskConfigMap(),
      {},
      getDefaultOutputSnapshot()
    );

    const diff = computeJobConfigDiff(job, workingConfig);
    assert.equal(diff.hasChanged, false);
    assert.equal(diff.aiConfigChanged, false);
    assert.equal(diff.outputConfigChanged, false);
    assert.equal(diff.recommendedCta, "retry");
    assert.equal(diff.invalidatedFromStep, undefined);
  });

  await t.test("AI config change triggers [⚡ Tạo lại] (Regenerate) and Invalidation Graph step (AC-14, AC-26)", () => {
    const job = createMockFailedJob();
    const modifiedDefaults = getDefaultTaskConfigMap();

    // Change Translation style
    modifiedDefaults.translation = {
      ...modifiedDefaults.translation!,
      style: "cinema",
    };

    const workingConfig = resolveEffectiveConfig(modifiedDefaults);
    const diff = computeJobConfigDiff(job, workingConfig);

    assert.equal(diff.hasChanged, true);
    assert.equal(diff.aiConfigChanged, true);
    assert.ok(diff.changedTasks.includes("translation"));
    assert.equal(diff.invalidatedFromStep, "translation");
    assert.equal(diff.recommendedCta, "regenerate");
  });

  await t.test("Early task change in DAG invalidates from that earlier step", () => {
    const job = createMockFailedJob();
    const modifiedDefaults = getDefaultTaskConfigMap();

    // Change Whisper model in Transcription
    modifiedDefaults.transcription = {
      ...modifiedDefaults.transcription!,
      whisperModel: "large-v3",
    };

    const workingConfig = resolveEffectiveConfig(modifiedDefaults);
    const diff = computeJobConfigDiff(job, workingConfig);

    assert.equal(diff.hasChanged, true);
    assert.equal(diff.invalidatedFromStep, "transcription");
    assert.equal(diff.recommendedCta, "regenerate");
  });

  await t.test("Only Output config changed with valid artifacts triggers [⚡ Xuất lại] (Re-export)", () => {
    const job = createMockFailedJob();
    const outputDefaults = getDefaultOutputSnapshot();

    // Only change output directory
    outputDefaults.resolvedOutputDirectory = "D:/CustomExports";

    const workingConfig = resolveEffectiveConfig(
      getDefaultTaskConfigMap(),
      {},
      outputDefaults
    );

    const diff = computeJobConfigDiff(job, workingConfig);
    assert.equal(diff.hasChanged, true);
    assert.equal(diff.aiConfigChanged, false);
    assert.equal(diff.outputConfigChanged, true);
    assert.equal(diff.canReuseArtifacts, true);
    assert.equal(diff.recommendedCta, "reexport");
  });

  await t.test("Revert Invariant: Restoring config to match snapshot exactly reverts CTA back to [Thử lại]", () => {
    const job = createMockFailedJob();
    const modifiedDefaults = getDefaultTaskConfigMap();

    // 1. Temporarily modify config
    modifiedDefaults.tts = {
      ...modifiedDefaults.tts!,
      speed: 1.5,
    };
    let workingConfig = resolveEffectiveConfig(modifiedDefaults);
    let diff = computeJobConfigDiff(job, workingConfig);
    assert.equal(diff.recommendedCta, "retry"); // TTS is not in media executionSequence!

    // Modify a task that is in executionSequence: dubbing
    modifiedDefaults.dubbing = {
      ...modifiedDefaults.dubbing!,
      speedMultiplier: 1.8,
    };
    workingConfig = resolveEffectiveConfig(modifiedDefaults);
    diff = computeJobConfigDiff(job, workingConfig);
    assert.equal(diff.hasChanged, true);
    assert.equal(diff.recommendedCta, "regenerate");

    // 2. Revert back to match snapshot exactly
    modifiedDefaults.dubbing.speedMultiplier = 1.0;
    workingConfig = resolveEffectiveConfig(modifiedDefaults);
    diff = computeJobConfigDiff(job, workingConfig);

    assert.equal(diff.hasChanged, false);
    assert.equal(diff.recommendedCta, "retry");
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BatchJob,
  BatchTaskConfigMap,
} from "../../../types/batch";
import {
  resolveEffectiveConfig,
  applyGlobalDefaultsToJobs,
  freezeJobSnapshot,
  getJobWorkingConfig,
  getDefaultOutputSnapshot,
  getDefaultTaskConfigMap,
} from "../configSnapshotResolver";
import {
  computeJobConfigDiff,
} from "../configDiffResolver";

describe("TASK-15: Batch Config Scope & Precedence Suite (AC-14, AC-15, AC-26)", () => {
  const baseDefaults = {
    ...getDefaultTaskConfigMap(),
    output: getDefaultOutputSnapshot(),
  };

  test("Scope Isolation: applyGlobalDefaultsToJobs only updates targeted jobs", () => {
    const job1: BatchJob = {
      id: "job-1",
      sourceFilePath: "C:/docs/file1.txt",
      sourceFileName: "file1.txt",
      sourceFileSize: 100,
      sourceFileMtime: 1000,
      fileKind: "text",
      stage: "staging",
      queueOrder: 1,
      selectedTasks: ["tts"],
      executionSequence: ["tts"],
      currentStepIndex: 0,
      configOverrides: { tts: { ...baseDefaults.tts!, voiceId: "voice-custom-1" } },
      hasCustomConfig: true,
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      outputSnapshot: baseDefaults.output,
      artifacts: { ownedArtifactPaths: [] },
      createdAt: 1000,
    };

    const job2: BatchJob = {
      id: "job-2",
      sourceFilePath: "C:/docs/file2.txt",
      sourceFileName: "file2.txt",
      sourceFileSize: 200,
      sourceFileMtime: 1000,
      fileKind: "text",
      stage: "staging",
      queueOrder: 2,
      selectedTasks: ["tts"],
      executionSequence: ["tts"],
      currentStepIndex: 0,
      configOverrides: { tts: { ...baseDefaults.tts!, voiceId: "voice-custom-2" } },
      hasCustomConfig: true,
      stepResults: {},
      status: "waiting",
      progressPct: 0,
      outputSnapshot: baseDefaults.output,
      artifacts: { ownedArtifactPaths: [] },
      createdAt: 1000,
    };

    const newDefaults: BatchTaskConfigMap = {
      ...baseDefaults,
      tts: { ...baseDefaults.tts!, voiceId: "voice-applied-by-user" },
    };

    const updated = applyGlobalDefaultsToJobs([job1, job2], ["job-1"], newDefaults);

    // Job 1 should receive new defaults
    assert.strictEqual(updated[0].configOverrides.tts?.voiceId, "voice-applied-by-user");
    // Job 2 MUST be completely unmodified
    assert.strictEqual(updated[1].configOverrides.tts?.voiceId, "voice-custom-2");
  });

  test("3-Tier Precedence: Character Voice > File Custom Default > Global Defaults", () => {
    const globalTasks = {
      dialogue: {
        ...baseDefaults.dialogue!,
        defaultVoiceId: "voice-dialogue-global",
      },
    };

    const dialogueOverrides = {
      dialogue: {
        ...baseDefaults.dialogue!,
        defaultVoiceId: "voice-file-level-fallback",
        characterVoices: {
          "Nhân vật A": "voice-character-specific-A",
        },
      },
    };

    const resolved = resolveEffectiveConfig(globalTasks, dialogueOverrides);

    // Character A gets specific voice
    assert.strictEqual(resolved.tasks.dialogue?.characterVoices?.["Nhân vật A"], "voice-character-specific-A");
  });

  test("3-Way Dynamic CTA: identifies 'retry', 'regenerate', and 'reexport' correctly", () => {
    const job: BatchJob = {
      id: "job-failed-1",
      sourceFilePath: "C:/audio/test.mp3",
      sourceFileName: "test.mp3",
      sourceFileSize: 5000,
      sourceFileMtime: 2000,
      fileKind: "media",
      stage: "queued",
      queueOrder: 1,
      selectedTasks: ["transcription", "translation"],
      executionSequence: ["transcription", "translation"],
      currentStepIndex: 1,
      configOverrides: {},
      hasCustomConfig: false,
      stepResults: {
        transcription: {
          task: "transcription",
          status: "completed",
          progressPct: 100,
          outputArtifactPaths: ["C:/out/test.srt"],
        },
        translation: {
          task: "translation",
          status: "failed",
          progressPct: 50,
          outputArtifactPaths: [],
          error: "Rate limit exceeded",
        },
      },
      status: "failed",
      progressPct: 50,
      outputSnapshot: baseDefaults.output,
      artifacts: {
        ownedArtifactPaths: ["C:/out/test.srt"],
        primaryPath: "C:/out/test.srt",
      },
      createdAt: 2000,
    };

    // Freeze initial snapshot
    const frozenJob = freezeJobSnapshot(job);
    assert.ok(frozenJob.effectiveConfigSnapshot);

    // Case 1: No config change -> CTA = retry
    const diff1 = computeJobConfigDiff(frozenJob, getJobWorkingConfig(frozenJob));
    assert.strictEqual(diff1.hasChanged, false);
    assert.strictEqual(diff1.recommendedCta, "retry");

    // Case 2: AI model change -> CTA = regenerate
    frozenJob.configOverrides = {
      translation: {
        ...baseDefaults.translation!,
        providerId: "gemini",
        targetLanguage: "vi",
        style: "cinema",
        outputFormat: "srt",
      },
    };
    const diff2 = computeJobConfigDiff(frozenJob, getJobWorkingConfig(frozenJob));
    assert.strictEqual(diff2.hasChanged, true);
    assert.strictEqual(diff2.aiConfigChanged, true);
    assert.strictEqual(diff2.recommendedCta, "regenerate");

    // Case 3: Output format change with existing artifacts -> CTA = reexport
    frozenJob.configOverrides = {};
    frozenJob.outputSnapshot = {
      ...frozenJob.outputSnapshot,
      outputAudioFormat: "mp3",
    };
    const diff3 = computeJobConfigDiff(frozenJob, getJobWorkingConfig(frozenJob));
    assert.strictEqual(diff3.hasChanged, true);
    assert.strictEqual(diff3.outputConfigChanged, true);
    assert.strictEqual(diff3.recommendedCta, "reexport");
  });
});

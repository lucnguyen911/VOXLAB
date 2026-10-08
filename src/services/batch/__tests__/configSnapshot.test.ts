import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveEffectiveConfig,
  resolveJobOwnedEffectiveConfig,
  freezeJobSnapshot,
  applyGlobalDefaultsToJobs,
  getDefaultTaskConfigMap,
  getDefaultOutputSnapshot,
  resolveJobSubtitleMode,
  shouldDispatchWhisperAsr,
} from "../configSnapshotResolver";
import { computeJobConfigDiff } from "../configDiffResolver";
import { BatchJob } from "../../../types/batch";

function createMockJob(id: string, overrides: Record<string, unknown> = {}): BatchJob {
  return {
    id,
    sourceFilePath: `C:/data/${id}.txt`,
    sourceFileName: `${id}.txt`,
    sourceFileSize: 1024,
    sourceFileMtime: Date.now(),
    fileKind: "text",
    stage: "staging",
    queueOrder: 1,
    selectedTasks: ["tts"],
    executionSequence: ["tts"],
    currentStepIndex: 0,
    configOverrides: overrides,
    hasCustomConfig: Object.keys(overrides).length > 0,
    stepResults: {},
    status: "waiting",
    progressPct: 0,
    outputSnapshot: getDefaultOutputSnapshot(),
    artifacts: { ownedArtifactPaths: [] },
    createdAt: Date.now(),
  };
}

test("TASK-04: Config Snapshot & Scope Isolation Suite", async (t) => {
  await t.test("resolveEffectiveConfig implements 3-Tier Precedence (AC-14)", () => {
    const globalDefaults = getDefaultTaskConfigMap();
    globalDefaults.dialogue = {
      model: "edge_tts",
      defaultVoiceId: "global-default-voice",
      turnPauseSec: 0.5,
      sameSpeakerPauseSec: 0.3,
      exportSrt: true,
      characterVoices: {
        "Nam": "global-nam-voice",
        "Lan": "global-lan-voice",
      },
    };

    const jobOverrides = {
      dialogue: {
        model: "edge_tts",
        defaultVoiceId: "file-override-voice",
        turnPauseSec: 0.6,
        sameSpeakerPauseSec: 0.3,
        exportSrt: true,
        characterVoices: {
          "Nam": "file-nam-voice", // Character voice override
        },
      },
    };

    const effective = resolveEffectiveConfig(globalDefaults, jobOverrides);

    // Tier 1: Character Voice Override
    assert.equal(effective.tasks.dialogue?.characterVoices?.["Nam"], "file-nam-voice");
    // Inherited from Tier 3: Lan was not overridden in Tier 2
    assert.equal(effective.tasks.dialogue?.characterVoices?.["Lan"], "global-lan-voice");
    // Tier 2: File default voice overrides global
    assert.equal(effective.tasks.dialogue?.defaultVoiceId, "file-override-voice");
  });

  await t.test("Dialogue Min-Max turn pause resolution and 3-Tier Precedence", () => {
    const baseDefaults = getDefaultTaskConfigMap();
    assert.equal(baseDefaults.dialogue?.turnPauseMinSec, 0.40);
    assert.equal(baseDefaults.dialogue?.turnPauseMaxSec, 0.70);

    // Global defaults override
    const globalDefaults = getDefaultTaskConfigMap();
    globalDefaults.dialogue = {
      ...globalDefaults.dialogue!,
      turnPauseMinSec: 0.35,
      turnPauseMaxSec: 0.65,
    };

    // File level override
    const jobOverrides = {
      dialogue: {
        model: "omnivoice",
        defaultVoiceId: "custom-voice",
        turnPauseMinSec: 0.25,
        turnPauseMaxSec: 0.55,
        sameSpeakerPauseSec: 0.15,
        exportSrt: true,
      },
    };

    const effective = resolveEffectiveConfig(globalDefaults, jobOverrides);
    assert.equal(effective.tasks.dialogue?.turnPauseMinSec, 0.25);
    assert.equal(effective.tasks.dialogue?.turnPauseMaxSec, 0.55);
    assert.equal(effective.tasks.dialogue?.sameSpeakerPauseSec, 0.15);
  });

  await t.test("Zero Secrets Invariant: Strips API keys and tokens from snapshot", () => {
    const dangerousConfig = {
      tts: {
        model: "edge_tts",
        voiceId: "voice-1",
        speed: 1.0,
        pitch: 0,
        volume: 100,
        apiKey: "sk-secret-123456",
        authToken: "bearer-token-abc",
      } as unknown as { model: string; voiceId: string; speed: number; pitch: number; volume: number },
    };

    const effective = resolveEffectiveConfig(dangerousConfig);
    const serialized = JSON.stringify(effective);
    assert.ok(!serialized.includes("sk-secret-123456"));
    assert.ok(!serialized.includes("bearer-token-abc"));
  });

  await t.test("Lazy Freeze Timing: Snapshot is frozen strictly from job-owned config (AC-14)", () => {
    const job = createMockJob("job-1");
    assert.equal(job.effectiveConfigSnapshot, undefined);

    const frozen = freezeJobSnapshot(job);
    assert.ok(frozen.effectiveConfigSnapshot);
    assert.equal(frozen.effectiveConfigSnapshot.tasks.tts?.voiceId, getDefaultTaskConfigMap().tts?.voiceId);
    assert.equal(frozen.configChanged, false);
    assert.equal(frozen.subtitleMode, "synthesized_timing");
  });

  await t.test("Product Invariant: Modifying Global Defaults without Apply does NOT alter job config or snapshot", () => {
    const job = createMockJob("job-unapplied");
    // Job has initial voice vi-VN-HoaiMyNeural
    job.configOverrides = {
      tts: {
        model: "edge_tts",
        voiceId: "vi-VN-HoaiMyNeural",
        speed: 1.0,
        pitch: 0,
        volume: 100,
      },
    };

    // User modifies Global Defaults on Topbar to something completely different
    const liveGlobalDefaults = getDefaultTaskConfigMap();
    liveGlobalDefaults.tts!.voiceId = "vi-VN-NamMinhNeural";
    liveGlobalDefaults.tts!.speed = 1.5;

    // Resolve job-owned config and freeze snapshot:
    const frozenJob = freezeJobSnapshot(job);

    // Job STRICTLY preserved its own voice, NOT the live unapplied global default!
    assert.equal(frozenJob.effectiveConfigSnapshot?.tasks.tts?.voiceId, "vi-VN-HoaiMyNeural");
    assert.equal(frozenJob.effectiveConfigSnapshot?.tasks.tts?.speed, 1.0);
  });

  await t.test("Scope Isolation: applyGlobalDefaultsToJobs strictly applies only to selectedJobIds (AC-15)", () => {
    const job1 = createMockJob("job-1");
    const job2 = createMockJob("job-2");
    const job3 = createMockJob("job-3");

    // job1 has already frozen snapshot
    job1.effectiveConfigSnapshot = resolveJobOwnedEffectiveConfig(job1);

    const newDefaults = getDefaultTaskConfigMap();
    newDefaults.tts = {
      model: "edge_tts",
      voiceId: "new-custom-voice",
      speed: 1.25,
      pitch: 0,
      volume: 90,
    };

    // Apply only to job2 and job3 (job1 is unselected)
    const updated = applyGlobalDefaultsToJobs([job1, job2, job3], ["job-2", "job-3"], newDefaults);

    // Job1 was NOT selected => remains completely untouched
    assert.equal(updated[0].configOverrides.tts, undefined);
    assert.equal(updated[0].effectiveConfigSnapshot?.tasks.tts?.voiceId, getDefaultTaskConfigMap().tts?.voiceId);

    // Job2 and Job3 WERE selected => received new config
    assert.equal(updated[1].configOverrides.tts?.voiceId, "new-custom-voice");
    assert.equal(updated[2].configOverrides.tts?.voiceId, "new-custom-voice");

    // Setting != Execution: selectedTasks are not modified
    assert.deepEqual(updated[1].selectedTasks, ["tts"]);
  });

  await t.test("Unselected failed jobs strictly preserve snapshot and [Thử lại] CTA when Global Defaults change", () => {
    const failedJob = createMockJob("failed-job");
    failedJob.status = "failed";
    failedJob.effectiveConfigSnapshot = resolveJobOwnedEffectiveConfig(failedJob);

    // Modify global defaults without applying to failedJob
    const unappliedGlobalDefaults = getDefaultTaskConfigMap();
    unappliedGlobalDefaults.tts!.speed = 1.75;

    // Diff uses job's working config (job-owned)
    const workingConfig = resolveJobOwnedEffectiveConfig(failedJob);
    const diff = computeJobConfigDiff(failedJob, workingConfig);

    assert.equal(diff.hasChanged, false);
    assert.equal(diff.recommendedCta, "retry");
  });

  await t.test("Subtitle Execution Mode semantics and Routing Guards", () => {
    // Media -> media_asr
    assert.equal(resolveJobSubtitleMode("media"), "media_asr");
    assert.equal(shouldDispatchWhisperAsr("media", "media_asr"), true);

    // Text -> synthesized_timing (NO ASR / Whisper)
    assert.equal(resolveJobSubtitleMode("text"), "synthesized_timing");
    assert.equal(shouldDispatchWhisperAsr("text", "synthesized_timing"), false);
    assert.equal(shouldDispatchWhisperAsr("text"), false);

    // Subtitle -> imported_subtitle (NO ASR / Whisper)
    assert.equal(resolveJobSubtitleMode("subtitle"), "imported_subtitle");
    assert.equal(shouldDispatchWhisperAsr("subtitle", "imported_subtitle"), false);
    assert.equal(shouldDispatchWhisperAsr("subtitle"), false);
  });
});

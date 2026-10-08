/**
 * VoxLab — Batch Config Snapshot Resolver & Scope Isolation
 * Specification: SPEC-batch.md v3.2.0 (AC-14, AC-15, AC-16, AC-26)
 */

import {
  BatchJob,
  BatchFileKind,
  BatchSubtitleMode,
  BatchTaskConfigMap,
  BatchJobOutputSnapshot,
  BatchEffectiveConfigSnapshot,
} from "../../types/batch";

/**
 * Creates default fallback snapshots if global defaults are missing a task
 */
export function getDefaultTaskConfigMap(): BatchTaskConfigMap {
  return {
    tts: {
      // Gate E baseline: local OmniVoice (default/auto voice). Online engines are not wired into Batch.
      model: "omnivoice",
      voiceId: "omnivoice-auto",
      speed: 1.0,
      pitch: 0,
      volume: 100,
    },
    dialogue: {
      model: "omnivoice",
      defaultVoiceId: "omnivoice-auto",
      turnPauseMinSec: 0.40,
      turnPauseMaxSec: 0.70,
      turnPauseSec: 0.5,
      sameSpeakerPauseSec: 0.3,
      exportSrt: true,
      characterVoices: {},
    },
    transcription: {
      audioLanguage: "auto",
      // Development verification baseline only; production default is TUNING REQUIRED.
      whisperModel: "small",
      speechSpeed: 1.0,
      outputFormat: "srt",
    },
    translation: {
      providerId: "gemini",
      targetLanguage: "vi",
      style: "default",
      outputFormat: "preserve_input",
    },
    dubbing: {
      ttsModel: "omnivoice",
      voiceId: "omnivoice-auto",
      speedMultiplier: 1.0,
      turnPauseSec: 0.3,
    },
  };
}

export function getDefaultOutputSnapshot(): BatchJobOutputSnapshot {
  return {
    resolvedOutputDirectory: "",
    saveInSourceFolder: false,
    collisionPolicy: "auto_rename",
    outputAudioFormat: "wav",
    outputSubtitleFormat: "srt",
  };
}

/**
 * Recursively removes secrets (keys, tokens, passwords) to enforce Zero Secrets Invariant
 */
function sanitizeConfigObject<T>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeConfigObject) as unknown as T;
  }

  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const lowerKey = k.toLowerCase();
    if (
      lowerKey.includes("key") ||
      lowerKey.includes("token") ||
      lowerKey.includes("secret") ||
      lowerKey.includes("password")
    ) {
      continue;
    }
    clean[k] = typeof v === "object" ? sanitizeConfigObject(v) : v;
  }
  return clean as T;
}

/**
 * Resolves 3-Tier Precedence into an Effective Configuration:
 * Tier 1: Character Voice Override
 * Tier 2: Per-File Custom Override
 * Tier 3: Global Defaults
 */
export function resolveEffectiveConfig(
  globalDefaults: BatchTaskConfigMap = {},
  jobOverrides: Partial<BatchTaskConfigMap> = {},
  globalOutput: BatchJobOutputSnapshot = getDefaultOutputSnapshot(),
  jobOutputOverrides?: Partial<BatchJobOutputSnapshot>
): BatchEffectiveConfigSnapshot {
  const baseDefaults = getDefaultTaskConfigMap();

  // Merge Task Configurations
  const tasks: BatchTaskConfigMap = {
    tts: {
      ...baseDefaults.tts!,
      ...(globalDefaults.tts || {}),
      ...(jobOverrides.tts || {}),
    },
    dialogue: {
      ...baseDefaults.dialogue!,
      ...(globalDefaults.dialogue || {}),
      ...(jobOverrides.dialogue || {}),
      // 3-Tier Character Voice Mapping: Character Voice > File Custom Default > Global Defaults
      characterVoices: {
        ...(baseDefaults.dialogue?.characterVoices || {}),
        ...(globalDefaults.dialogue?.characterVoices || {}),
        ...(jobOverrides.dialogue?.characterVoices || {}),
      },
    },
    transcription: {
      ...baseDefaults.transcription!,
      ...(globalDefaults.transcription || {}),
      ...(jobOverrides.transcription || {}),
    },
    translation: {
      ...baseDefaults.translation!,
      ...(globalDefaults.translation || {}),
      ...(jobOverrides.translation || {}),
    },
    dubbing: {
      ...baseDefaults.dubbing!,
      ...(globalDefaults.dubbing || {}),
      ...(jobOverrides.dubbing || {}),
    },
  };

  // Merge Output Configuration
  const output: BatchJobOutputSnapshot = {
    ...globalOutput,
    ...(jobOutputOverrides || {}),
  };

  return sanitizeConfigObject({ tasks, output });
}

/**
 * Resolves the explicit Subtitle Mode for a job based on its file kind (AC-44, Subtitle Execution Mode).
 * - "media_asr": Video/Audio using Whisper ASR
 * - "synthesized_timing": Plain text or Dialogue using real audio timing from TTS/Dialogue (NO ASR/Whisper)
 * - "imported_subtitle": SRT/VTT preserving source cues (NO ASR/Whisper)
 */
export function resolveJobSubtitleMode(fileKind: BatchFileKind): BatchSubtitleMode {
  switch (fileKind) {
    case "media":
      return "media_asr";
    case "text":
      return "synthesized_timing";
    case "subtitle":
      return "imported_subtitle";
    default:
      return "media_asr";
  }
}

/**
 * Invariant: Text and Subtitle files NEVER dispatch Whisper/ASR.
 */
export function shouldDispatchWhisperAsr(
  fileKind: BatchFileKind,
  subtitleMode?: BatchSubtitleMode
): boolean {
  if (fileKind === "text" || fileKind === "subtitle") {
    return false;
  }
  const mode = subtitleMode || resolveJobSubtitleMode(fileKind);
  return fileKind === "media" && mode === "media_asr";
}

/**
 * Resolves job-owned effective configuration.
 * INVARIANT: Does NOT dynamically live-merge dynamic Global Defaults!
 * Resolves strictly from:
 * 1. Config applied/stored on the job itself (job.configOverrides, job.outputSnapshot)
 * 2. Dialogue Character-specific voices > Job Dialogue Default Voice > Schema Baseline
 * 3. Static schema fallbacks for any unconfigured fields.
 */
export function resolveJobOwnedEffectiveConfig(
  job: Pick<BatchJob, "fileKind" | "configOverrides" | "outputSnapshot">
): BatchEffectiveConfigSnapshot {
  const baseDefaults = getDefaultTaskConfigMap();
  const overrides = job.configOverrides || {};
  const jobOutput = job.outputSnapshot || getDefaultOutputSnapshot();

  const subtitleMode = resolveJobSubtitleMode(job.fileKind);

  // Dialogue Priority: Character-specific > Job Dialogue Default Voice > Schema Baseline
  const jobDialogueDefault =
    overrides.dialogue?.defaultVoiceId || baseDefaults.dialogue!.defaultVoiceId;

  const characterVoices: Record<string, string> = {
    ...(baseDefaults.dialogue?.characterVoices || {}),
    ...(overrides.dialogue?.characterVoices || {}),
  };

  const tasks: BatchTaskConfigMap = {
    tts: {
      ...baseDefaults.tts!,
      ...(overrides.tts || {}),
    },
    dialogue: {
      ...baseDefaults.dialogue!,
      ...(overrides.dialogue || {}),
      defaultVoiceId: jobDialogueDefault,
      characterVoices,
    },
    transcription: {
      ...baseDefaults.transcription!,
      ...(overrides.transcription || {}),
      subtitleMode,
    },
    translation: {
      ...baseDefaults.translation!,
      ...(overrides.translation || {}),
    },
    dubbing: {
      ...baseDefaults.dubbing!,
      ...(overrides.dubbing || {}),
    },
  };

  const output: BatchJobOutputSnapshot = {
    ...getDefaultOutputSnapshot(),
    ...jobOutput,
  };

  return sanitizeConfigObject({ tasks, output });
}

/**
 * Resolves the working config for a specific job.
 * If the job already has an effective snapshot, diffs compare against that snapshot.
 * Working config uses job-owned configuration.
 */
export function getJobWorkingConfig(
  job: BatchJob
): BatchEffectiveConfigSnapshot {
  if (!job.effectiveConfigSnapshot) {
    return resolveJobOwnedEffectiveConfig(job);
  }

  const snap = job.effectiveConfigSnapshot;
  const overrides = job.configOverrides || {};
  const output = job.outputSnapshot || snap.output;

  const baseDefaults = getDefaultTaskConfigMap();
  const tasks: BatchTaskConfigMap = {
    tts: snap.tasks.tts
      ? { ...snap.tasks.tts, ...(overrides.tts || {}) }
      : { ...baseDefaults.tts!, ...(overrides.tts || {}) },
    dialogue: snap.tasks.dialogue
      ? { ...snap.tasks.dialogue, ...(overrides.dialogue || {}) }
      : { ...baseDefaults.dialogue!, ...(overrides.dialogue || {}) },
    transcription: snap.tasks.transcription
      ? { ...snap.tasks.transcription, ...(overrides.transcription || {}) }
      : { ...baseDefaults.transcription!, ...(overrides.transcription || {}) },
    translation: snap.tasks.translation
      ? { ...snap.tasks.translation, ...(overrides.translation || {}) }
      : { ...baseDefaults.translation!, ...(overrides.translation || {}) },
    dubbing: snap.tasks.dubbing
      ? { ...snap.tasks.dubbing, ...(overrides.dubbing || {}) }
      : { ...baseDefaults.dubbing!, ...(overrides.dubbing || {}) },
  };

  return sanitizeConfigObject({
    tasks,
    output: {
      ...snap.output,
      ...output,
    },
  });
}

/**
 * Lazy Snapshot Freeze Invariant:
 * Freezes the effective configuration strictly right before the job transitions
 * from "waiting" to "processing".
 * Resolves strictly from job-owned applied config, completely isolated from future Global Defaults changes.
 */
export function freezeJobSnapshot(
  job: BatchJob
): BatchJob {
  const effectiveConfigSnapshot = resolveJobOwnedEffectiveConfig(job);
  const subtitleMode = resolveJobSubtitleMode(job.fileKind);

  return {
    ...job,
    subtitleMode,
    effectiveConfigSnapshot,
    // When fresh execution starts, config is synchronized with snapshot
    configChanged: false,
    invalidatedFromStep: undefined,
  };
}

/**
 * Scope Isolation Invariant (AC-15):
 * Applying Global Defaults only affects jobs included in selectedJobIds.
 * Unselected jobs (including failed/paused jobs) strictly preserve their existing state and snapshot.
 * Setting != Execution: Does NOT alter selectedTasks!
 */
export function applyGlobalDefaultsToJobs(
  jobs: BatchJob[],
  selectedJobIds: string[],
  newDefaults: BatchTaskConfigMap,
  newOutput?: Partial<BatchJobOutputSnapshot>
): BatchJob[] {
  const selectedSet = new Set(selectedJobIds);

  return jobs.map((job) => {
    // If not selected, preserve completely
    if (!selectedSet.has(job.id)) {
      return job;
    }

    // Apply to selected job: Update overrides to inherit new defaults while preserving explicit characterVoices
    const existingDialogue = job.configOverrides.dialogue;
    const preservedCharacterVoices = existingDialogue?.characterVoices || {};

    const updatedOverrides: Partial<BatchTaskConfigMap> = {
      ...job.configOverrides,
      tts: newDefaults.tts ? { ...newDefaults.tts } : job.configOverrides.tts,
      dialogue: newDefaults.dialogue
        ? {
            ...newDefaults.dialogue,
            characterVoices: preservedCharacterVoices,
          }
        : job.configOverrides.dialogue,
      transcription: newDefaults.transcription
        ? { ...newDefaults.transcription }
        : job.configOverrides.transcription,
      translation: newDefaults.translation
        ? { ...newDefaults.translation }
        : job.configOverrides.translation,
      dubbing: newDefaults.dubbing
        ? { ...newDefaults.dubbing }
        : job.configOverrides.dubbing,
    };

    const updatedOutput: BatchJobOutputSnapshot = newOutput
      ? { ...job.outputSnapshot, ...newOutput }
      : job.outputSnapshot;

    return {
      ...job,
      configOverrides: updatedOverrides,
      outputSnapshot: updatedOutput,
      hasCustomConfig: true,
    };
  });
}

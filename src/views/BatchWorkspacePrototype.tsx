import { MOCK_VOICES } from "../mock/data";
import { VoiceProfile } from "../types/ui";
import {
  DialogueGlobalSettings,
  DEFAULT_DIALOGUE_SETTINGS,
} from "../types/dialogue";
import { normalizeCharacterId } from "../services/dialogue/parser";
import { NormalizerGroupId } from "../services/normalizer";

// ==========================================
// File-Centric Batch Domain Types (v3.1.0)
// ==========================================

export type BatchTaskType = "tts" | "dialogue" | "transcription" | "translation" | "dubbing";
export type BatchFileKind = "text" | "media" | "subtitle";

export type BatchStepStatus =
  | "waiting"
  | "processing"
  | "completed"
  | "completed_with_warning"
  | "failed"
  | "skipped"
  | "cancelled"
  | "interrupted";

export type BatchJobStatus =
  | "waiting"
  | "processing"
  | "paused"
  | "completed"
  | "completed_with_warning"
  | "failed_with_artifact"
  | "failed"
  | "cancelled"
  | "interrupted";

export type BatchQueueStatus =
  | "idle"
  | "running"
  | "pausing"
  | "paused"
  | "cancelling"
  | "blocked";

export interface MockStepResult {
  task: BatchTaskType;
  status: BatchStepStatus;
  progressPct: number;
  outputArtifactPaths?: string[];
  warning?: string;
  error?: string;
  skipReason?: string;
}

export type BatchTaskConfigOverrides = {
  outputPath?: string;
  saveInSourceFolder?: boolean;
  collisionPolicy?: "auto_rename" | "overwrite" | "skip";
  outputAudioFormat?: "wav" | "mp3";
  outputSubtitleFormat?: "srt" | "vtt";
  concurrency?: number;
  text?: Partial<NonNullable<BatchGlobalDefaults["text"]>>;
  tts?: Partial<BatchGlobalDefaults["tts"]>;
  dialogue?: Partial<BatchGlobalDefaults["dialogue"]>;
  transcription?: Partial<BatchGlobalDefaults["transcription"]>;
  translation?: Partial<BatchGlobalDefaults["translation"]>;
  dubbing?: Partial<BatchGlobalDefaults["dubbing"]>;
};

export interface MockBatchJob {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: string;
  fileKind: BatchFileKind;
  hasDialogueStructure?: boolean; // Plain text vs formatted dialogue
  stage: "staging" | "queued";    // "staging" = Tab Danh sách; "queued" = Tab Hàng đợi / Đang chạy
  queueOrder: number;             // Execution sequence order in Queue
  selectedTasks: BatchTaskType[];
  executionSequence: BatchTaskType[];
  stepResults: Partial<Record<BatchTaskType, MockStepResult>>;
  status: BatchJobStatus;
  progressPct: number;
  isCancelling?: boolean; // Monolithic cancellation flag
  inputChanged?: boolean; // Input mutation flag
  hasCustomConfig?: boolean;
  configOverrides?: BatchTaskConfigOverrides;
  effectiveConfigSnapshot?: BatchTaskConfigOverrides; // Resolved & Frozen right before waiting -> processing
  configChanged?: boolean; // Derived/cached state: deepEqual(resolvedEffective, effectiveConfigSnapshot) === false
  invalidatedFromStep?: BatchTaskType; // Derived from Invalidation Graph
  retryFromStep?: BatchTaskType;
  outputArtifacts?: {
    audioPath?: string;
    audioDuration?: number; // seconds
    subtitles?: Array<{ path: string; label: string; cues: Array<{ time: string; text: string }> }>;
  };
  scriptContent?: string; // Raw text or dialogue script content for the file
}

// Global Defaults Configuration Schema
export interface BatchGlobalDefaults {
  outputPath: string;
  saveInSourceFolder: boolean;
  collisionPolicy: "auto_rename" | "overwrite" | "skip";
  outputAudioFormat: "wav" | "mp3";
  outputSubtitleFormat: "srt" | "vtt";
  concurrency?: number;
  text?: {
    autoNormalize: boolean;
    enabledGroupIds: NormalizerGroupId[];
    applyPronunciation: boolean;
  };
  tts: {
    voice: string;
    model: string;
    speed: number;
    pitch: number;
    volume: number;
    pauses: {
      comma: number;
      period: number;
      questionExclamation: number;
      colonSemicolon: number;
    };
    concurrency: number;
    exportSrt: boolean;
    aspectRatio: "16:9" | "9:16" | "1:1";
    maxLines: 1 | 2;
  };
  dialogue: {
    model: string;
    defaultVoice?: string;
    characterVoices?: Record<string, string>; // normalizedCharId -> voiceName/voiceId mapping per script
    characterSpeeds?: Record<string, number>; // normalizedCharId -> speed multiplier override
    characterPitches?: Record<string, number>; // normalizedCharId -> pitch multiplier override
    masterVolume: number;
    turnPauseSec?: number;
    sameSpeakerPauseSec?: number;
    pauses: {
      comma: number;
      period: number;
      questionExclamation: number;
      colonSemicolon: number;
    };
    concurrency: number;
    exportSrt: boolean;
    aspectRatio?: "16:9" | "9:16" | "1:1";
    maxLines?: 1 | 2;
  };
  transcription: {
    whisperModel: string;
    audioLanguage: string;
    speechSpeed: "1.0" | "0.9" | "0.8";
    processingSpeed: "auto" | "1x" | "2x" | "4x" | "8x";
    aspectRatio: "16:9" | "9:16" | "1:1";
    maxLines: 1 | 2;
    outputFormat: "srt" | "vtt";
  };
  translation: {
    provider: string;
    sourceLanguage: string;
    targetLanguage: string;
    style: "default" | "cinema";
    contextAware?: boolean;
  };
  dubbing: {
    ttsModel: string;
    voice: string;
    speed?: number;
    pitch?: number;
    volume?: number;
    pauses?: {
      comma: number;
      period: number;
      questionExclamation: number;
      colonSemicolon: number;
    };
    concurrency?: number;
    autoFit?: boolean;
    speedMultiplier?: number;
    turnPauseSec?: number;
    masterVolume?: number;
    collisionGuardrail?: "wsola_autofit" | "truncate" | "skip";
  };
}

export const DEFAULT_GLOBAL_SETTINGS: BatchGlobalDefaults = {
  outputPath: "D:/VoxLabOutput/Batch_Export",
  saveInSourceFolder: false,
  collisionPolicy: "auto_rename",
  outputAudioFormat: "wav",
  outputSubtitleFormat: "srt",
  concurrency: 1,
  text: {
    autoNormalize: true,
    enabledGroupIds: ["whitespace", "punctuation", "unicode", "numbers"],
    applyPronunciation: true,
  },
  tts: {
    voice: "Thảo Trinh (Hà Nội)",
    model: "Omni Voice",
    speed: 1.0,
    pitch: 1.0,
    volume: 1.0,
    pauses: {
      comma: 0.2,
      period: 0.6,
      questionExclamation: 0.5,
      colonSemicolon: 0.4,
    },
    concurrency: 1,
    exportSrt: false,
    aspectRatio: "16:9",
    maxLines: 1,
  },
  dialogue: {
    model: "Omni Voice",
    defaultVoice: "Minh Quang (Hà Nội)",
    masterVolume: 1.0,
    turnPauseSec: 0.4,
    sameSpeakerPauseSec: 0.2,
    pauses: {
      comma: 0.2,
      period: 0.6,
      questionExclamation: 0.5,
      colonSemicolon: 0.4,
    },
    concurrency: 1,
    exportSrt: true,
    aspectRatio: "16:9",
    maxLines: 1,
  },
  transcription: {
    whisperModel: "large-v3-turbo",
    audioLanguage: "auto",
    speechSpeed: "1.0",
    processingSpeed: "auto",
    aspectRatio: "16:9",
    maxLines: 1,
    outputFormat: "srt",
  },
  translation: {
    provider: "google",
    sourceLanguage: "auto",
    targetLanguage: "vi",
    style: "default",
    contextAware: true,
  },
  dubbing: {
    ttsModel: "Omni Voice",
    voice: "Thảo Trinh (Hà Nội)",
    speed: 1.0,
    pitch: 1.0,
    volume: 1.0,
    pauses: {
      comma: 0.2,
      period: 0.6,
      questionExclamation: 0.5,
      colonSemicolon: 0.4,
    },
    concurrency: 1,
    autoFit: true,
    speedMultiplier: 1.15,
    turnPauseSec: 0.3,
    masterVolume: 1.0,
    collisionGuardrail: "wsola_autofit",
  },
};

// ==========================================
// Output Settings Persistence & Subfolder Resolvers (Gate D)
// ==========================================

export const BATCH_OUTPUT_SETTINGS_STORAGE_KEY = "voxlab_batch_output_settings";

export interface BatchOutputSettings {
  saveInSourceFolder: boolean;
  outputPath: string;
  collisionPolicy: "auto_rename" | "overwrite" | "skip";
  outputAudioFormat: "wav" | "mp3";
  outputSubtitleFormat: "srt" | "vtt";
  concurrency?: number;
}

export function getBatchStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  if (typeof globalThis !== "undefined" && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage;
  }
  return null;
}

export function loadBatchOutputSettings(): BatchOutputSettings {
  const fallback: BatchOutputSettings = {
    saveInSourceFolder: false,
    outputPath: "D:/VoxLabOutput/Batch_Export",
    collisionPolicy: "auto_rename",
    outputAudioFormat: "wav",
    outputSubtitleFormat: "srt",
    concurrency: 1,
  };
  const storage = getBatchStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(BATCH_OUTPUT_SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      saveInSourceFolder: typeof parsed.saveInSourceFolder === "boolean" ? parsed.saveInSourceFolder : fallback.saveInSourceFolder,
      outputPath: typeof parsed.outputPath === "string" && parsed.outputPath.trim() !== "" ? parsed.outputPath : fallback.outputPath,
      collisionPolicy: ["auto_rename", "overwrite", "skip"].includes(parsed.collisionPolicy) ? parsed.collisionPolicy : fallback.collisionPolicy,
      outputAudioFormat: parsed.outputAudioFormat === "mp3" ? "mp3" : "wav",
      outputSubtitleFormat: parsed.outputSubtitleFormat === "vtt" ? "vtt" : "srt",
      concurrency: 1,
    };
  } catch {
    return fallback;
  }
}

export function saveBatchOutputSettings(settings: Partial<BatchOutputSettings>): void {
  const storage = getBatchStorage();
  if (!storage) return;
  try {
    const current = loadBatchOutputSettings();
    const merged: BatchOutputSettings = {
      saveInSourceFolder: settings.saveInSourceFolder !== undefined ? settings.saveInSourceFolder : current.saveInSourceFolder,
      outputPath: settings.outputPath !== undefined ? settings.outputPath : current.outputPath,
      collisionPolicy: settings.collisionPolicy || current.collisionPolicy,
      outputAudioFormat: settings.outputAudioFormat || current.outputAudioFormat,
      outputSubtitleFormat: settings.outputSubtitleFormat || current.outputSubtitleFormat,
      concurrency: 1,
    };
    storage.setItem(BATCH_OUTPUT_SETTINGS_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Quota exceeded or sandbox restrictions handled safely
  }
}

// ==========================================
// Dubbing Settings Persistence (Gate D)
// ==========================================

export const DUBBING_VOICE_STORAGE_KEY = "voxlab_dubbing_selected_voice";
export const DUBBING_VOICE_SETTINGS_KEY = "voxlab_dubbing_voice_settings";

export interface StoredDubbingSettings {
  voice: string;
  ttsModel: string;
  speed: number;
  pitch: number;
  volume: number;
  pauses: {
    comma: number;
    period: number;
    questionExclamation: number;
    colonSemicolon: number;
  };
  concurrency: number;
  autoFit: boolean;
}

export function loadStoredDubbingSettings(): StoredDubbingSettings {
  const fallback: StoredDubbingSettings = {
    voice: "Thảo Trinh (Hà Nội)",
    ttsModel: "Omni Voice",
    speed: 1.0,
    pitch: 1.0,
    volume: 1.0,
    pauses: {
      comma: 0.2,
      period: 0.6,
      questionExclamation: 0.5,
      colonSemicolon: 0.4,
    },
    concurrency: 1,
    autoFit: true,
  };
  const storage = getBatchStorage();
  if (!storage) return fallback;
  try {
    const savedVoice = storage.getItem(DUBBING_VOICE_STORAGE_KEY);
    const savedVoiceSettings = storage.getItem(DUBBING_VOICE_SETTINGS_KEY);
    let voice = fallback.voice;
    if (savedVoice) {
      const match = MOCK_VOICES.find((v) => v.id === savedVoice || v.name === savedVoice);
      if (match) voice = match.name;
      else voice = savedVoice;
    }
    let parsed: any = {};
    if (savedVoiceSettings) {
      parsed = JSON.parse(savedVoiceSettings);
    }
    return {
      voice,
      ttsModel: typeof parsed.ttsModel === "string" ? parsed.ttsModel : fallback.ttsModel,
      speed: typeof parsed.speed === "number" ? parsed.speed : fallback.speed,
      pitch: typeof parsed.pitch === "number" ? parsed.pitch : fallback.pitch,
      volume: typeof parsed.volume === "number" ? parsed.volume : fallback.volume,
      pauses: parsed.pauses && typeof parsed.pauses === "object" ? {
        comma: typeof parsed.pauses.comma === "number" ? parsed.pauses.comma : 0.2,
        period: typeof parsed.pauses.period === "number" ? parsed.pauses.period : 0.6,
        questionExclamation: typeof parsed.pauses.questionExclamation === "number" ? parsed.pauses.questionExclamation : 0.5,
        colonSemicolon: typeof parsed.pauses.colonSemicolon === "number" ? parsed.pauses.colonSemicolon : 0.4,
      } : fallback.pauses,
      concurrency: 1,
      autoFit: typeof parsed.autoFit === "boolean" ? parsed.autoFit : fallback.autoFit,
    };
  } catch {
    return fallback;
  }
}

export function saveStoredDubbingSettings(settings: Partial<StoredDubbingSettings>): void {
  const storage = getBatchStorage();
  if (!storage) return;
  try {
    if (settings.voice) {
      const match = MOCK_VOICES.find((v) => v.name === settings.voice || v.id === settings.voice);
      const voiceId = match ? match.id : settings.voice;
      storage.setItem(DUBBING_VOICE_STORAGE_KEY, voiceId);
    }
    const current = loadStoredDubbingSettings();
    const updated = {
      ttsModel: settings.ttsModel ?? current.ttsModel,
      speed: settings.speed ?? current.speed,
      pitch: settings.pitch ?? current.pitch,
      volume: settings.volume ?? current.volume,
      pauses: settings.pauses ?? current.pauses,
      concurrency: 1,
      autoFit: settings.autoFit ?? current.autoFit,
    };
    storage.setItem(DUBBING_VOICE_SETTINGS_KEY, JSON.stringify(updated));
  } catch {}
}

export const DIALOGUE_SETTINGS_STORAGE_KEY = "voxlab_dialogue_settings";

export function loadStoredDialogueSettings(): DialogueGlobalSettings {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_DIALOGUE_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(DIALOGUE_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DIALOGUE_SETTINGS };
    const parsed = JSON.parse(raw);
    const model = parsed.model === "Lingual Speech V2" ? "Omni Voice" : (parsed.model || "Omni Voice");
    return {
      ...DEFAULT_DIALOGUE_SETTINGS,
      ...parsed,
      concurrency: 1,
      model,
      pauses: {
        ...DEFAULT_DIALOGUE_SETTINGS.pauses,
        ...(parsed.pauses || {}),
      },
    };
  } catch (err) {
    console.warn("Failed to load dialogue settings, using defaults:", err);
    return { ...DEFAULT_DIALOGUE_SETTINGS };
  }
}

export function saveStoredDialogueSettings(settings: Partial<DialogueGlobalSettings>): void {
  if (typeof localStorage === "undefined") return;
  try {
    const current = loadStoredDialogueSettings();
    const updated: DialogueGlobalSettings = {
      ...current,
      ...settings,
      concurrency: 1,
      pauses: {
        ...current.pauses,
        ...(settings.pauses || {}),
      },
    };
    localStorage.setItem(DIALOGUE_SETTINGS_STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

/**
 * Resolves the deterministic dedicated subfolder name for a batch job.
 * Rule:
 * 1. Base name is the source filename without extension (e.g. "01.mp4" -> "01").
 * 2. If multiple files in the batch share the same base name:
 *    - If extensions differ (e.g. "01.mp4" vs "01.wav") -> disambiguate with extension: "01_mp4", "01_wav".
 *    - If extensions are also identical (same filename in different folders, e.g. "A/01.mp4" vs "B/01.mp4") ->
 *      disambiguate using parent directory name (e.g. "01_mp4_A", "01_mp4_B") or 1-based index ("01_mp4_1").
 * 3. Folders are only created upon actual export.
 */
export function resolveJobSubfolderName(
  job: { id: string; fileName: string; filePath: string },
  allJobs?: Array<{ id: string; fileName: string; filePath: string }>
): string {
  const baseName = job.fileName.replace(/\.[^/.]+$/, "");
  const ext = (job.fileName.toLowerCase().split(".").pop() || "").replace(/[^a-z0-9]/g, "");

  if (!allJobs || allJobs.length === 0) return baseName;

  const sameBase = allJobs.filter(
    (j) => j.fileName.replace(/\.[^/.]+$/, "") === baseName
  );

  if (sameBase.length <= 1) return baseName;

  // Multiple files share the base name
  const sameExt = sameBase.filter(
    (j) => (j.fileName.toLowerCase().split(".").pop() || "").replace(/[^a-z0-9]/g, "") === ext
  );

  if (sameExt.length <= 1) {
    return ext ? `${baseName}_${ext}` : `${baseName}_file`;
  }

  // Same base name AND same extension (different directory or duplicate entry)
  const normalizedPath = job.filePath.replace(/\\/g, "/");
  const pathParts = normalizedPath.split("/").filter(Boolean);
  const parentFolder = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "";

  if (parentFolder && parentFolder !== baseName) {
    const sameParent = sameExt.filter((j) => {
      const parts = j.filePath.replace(/\\/g, "/").split("/").filter(Boolean);
      return (parts.length > 1 ? parts[parts.length - 2] : "") === parentFolder;
    });
    if (sameParent.length <= 1) {
      return `${baseName}_${ext}_${parentFolder.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    }
  }

  // Fallback: index within the sameBase list
  const idx = sameBase.findIndex((j) => j.id === job.id);
  return `${baseName}_${ext}_${idx >= 0 ? idx + 1 : "1"}`;
}

/**
 * Resolves the full output directory path for a batch job.
 * Rule:
 * 1. If saveInSourceFolder is true:
 *    Output is placed in the source file's directory: {sourceFileParentDir}/{subfolder}/
 * 2. If saveInSourceFolder is false:
 *    Output is placed in the common outputPath: {outputPath}/{subfolder}/
 */
export function resolveJobOutputDir(
  job: { id: string; fileName: string; filePath: string },
  outputConfig?: { outputPath?: string; saveInSourceFolder?: boolean },
  allJobs?: Array<{ id: string; fileName: string; filePath: string }>
): string {
  const subfolder = resolveJobSubfolderName(job, allJobs);
  const saveInSourceFolder = !!outputConfig?.saveInSourceFolder;

  if (saveInSourceFolder) {
    const normalized = job.filePath.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    const parentDir = lastSlash !== -1 ? normalized.substring(0, lastSlash) : "D:/BatchUploads";
    return `${parentDir}/${subfolder}`;
  }

  const baseOutput = (outputConfig?.outputPath || "D:/VoxLabOutput/Batch_Export").replace(/\\/g, "/").replace(/\/+$/, "");
  return `${baseOutput}/${subfolder}`;
}

// ==========================================
// Config Resolution & Derived Diff Logic (v3.1.0 - Scope-Isolated)
// ==========================================

export interface JobConfigDiffResult {
  isConfigChanged: boolean;
  aiConfigChanged: boolean;
  outputConfigChanged: boolean;
  canReuseArtifacts: boolean;
  invalidatedFromStep?: BatchTaskType;
  ctaType: "retry" | "regenerate_ai" | "re_export";
  ctaLabel: string;
  diffSummary: string[];
  resolvedEffectiveConfig: Record<string, unknown>;
}

/**
 * Returns the effective working configuration of a job by applying its specific
 * overrides (per-file drawer or applied global defaults) on top of its frozen snapshot.
 *
 * NOTE: Does NOT read live unapplied globalDefaults from modal/topbar, ensuring strict
 * scope isolation so unselected jobs never mutate automatically.
 */
export function getJobWorkingConfig(job: MockBatchJob): BatchTaskConfigOverrides {
  const base = job.effectiveConfigSnapshot || {};
  const overrides = job.configOverrides || {};

  return {
    outputPath: overrides.outputPath ?? base.outputPath ?? DEFAULT_GLOBAL_SETTINGS.outputPath,
    saveInSourceFolder: overrides.saveInSourceFolder ?? base.saveInSourceFolder ?? DEFAULT_GLOBAL_SETTINGS.saveInSourceFolder,
    collisionPolicy: overrides.collisionPolicy ?? base.collisionPolicy ?? DEFAULT_GLOBAL_SETTINGS.collisionPolicy,
    outputAudioFormat: overrides.outputAudioFormat ?? base.outputAudioFormat ?? DEFAULT_GLOBAL_SETTINGS.outputAudioFormat,
    outputSubtitleFormat: overrides.outputSubtitleFormat ?? base.outputSubtitleFormat ?? DEFAULT_GLOBAL_SETTINGS.outputSubtitleFormat,
    concurrency: overrides.concurrency ?? base.concurrency ?? DEFAULT_GLOBAL_SETTINGS.concurrency ?? 1,
    tts: overrides.tts || base.tts ? { ...(base.tts || DEFAULT_GLOBAL_SETTINGS.tts), ...(overrides.tts || {}) } : undefined,
    dialogue: overrides.dialogue || base.dialogue ? {
      ...(base.dialogue || DEFAULT_GLOBAL_SETTINGS.dialogue),
      ...(overrides.dialogue || {}),
      characterVoices: {
        ...((base.dialogue as any)?.characterVoices || {}),
        ...((overrides.dialogue as any)?.characterVoices || {}),
      },
    } : undefined,
    transcription: overrides.transcription || base.transcription ? { ...(base.transcription || DEFAULT_GLOBAL_SETTINGS.transcription), ...(overrides.transcription || {}) } : undefined,
    translation: overrides.translation || base.translation ? { ...(base.translation || DEFAULT_GLOBAL_SETTINGS.translation), ...(overrides.translation || {}) } : undefined,
    dubbing: overrides.dubbing || base.dubbing ? { ...(base.dubbing || DEFAULT_GLOBAL_SETTINGS.dubbing), ...(overrides.dubbing || {}) } : undefined,
  };
}

export function resolveJobEffectiveConfig(
  job: MockBatchJob,
  fallbackDefaults: BatchGlobalDefaults = DEFAULT_GLOBAL_SETTINGS
): Record<string, unknown> {
  const working = getJobWorkingConfig(job);
  const resolved: Record<string, unknown> = {
    outputPath: working.outputPath ?? fallbackDefaults.outputPath,
    saveInSourceFolder: working.saveInSourceFolder ?? fallbackDefaults.saveInSourceFolder,
    collisionPolicy: working.collisionPolicy ?? fallbackDefaults.collisionPolicy,
    outputAudioFormat: working.outputAudioFormat ?? fallbackDefaults.outputAudioFormat,
    outputSubtitleFormat: working.outputSubtitleFormat ?? fallbackDefaults.outputSubtitleFormat,
    concurrency: working.concurrency ?? fallbackDefaults.concurrency ?? 1,
  };

  for (const task of job.selectedTasks) {
    if (task === "tts") {
      resolved.tts = working.tts ?? fallbackDefaults.tts;
    } else if (task === "dialogue") {
      resolved.dialogue = working.dialogue ?? fallbackDefaults.dialogue;
    } else if (task === "transcription") {
      resolved.transcription = working.transcription ?? fallbackDefaults.transcription;
    } else if (task === "translation") {
      resolved.translation = working.translation ?? fallbackDefaults.translation;
    } else if (task === "dubbing") {
      resolved.dubbing = working.dubbing ?? fallbackDefaults.dubbing;
    }
  }

  return resolved;
}

/**
 * Checks if a batch job has granular custom configuration overrides (per-file).
 */
export function isJobCustomConfigured(job: MockBatchJob): boolean {
  if (job.hasCustomConfig) return true;
  if (!job.configOverrides) return false;
  const o = job.configOverrides;
  if (o.outputPath || o.saveInSourceFolder !== undefined || o.collisionPolicy) return true;
  if (o.outputAudioFormat || o.outputSubtitleFormat) return true;
  if (o.text || o.tts || o.transcription || o.translation || o.dubbing) return true;
  if (o.dialogue) {
    if (o.dialogue.defaultVoice || o.dialogue.model || o.dialogue.turnPauseSec !== undefined || o.dialogue.masterVolume !== undefined) return true;
    if (o.dialogue.characterVoices && Object.keys(o.dialogue.characterVoices).length > 0) return true;
    if (o.dialogue.characterSpeeds && Object.keys(o.dialogue.characterSpeeds).length > 0) return true;
    if (o.dialogue.characterPitches && Object.keys(o.dialogue.characterPitches).length > 0) return true;
  }
  return false;
}

/**
 * Checks if a batch job has custom character voice assignments or tuning for Dialogue.
 */
export function hasCustomDialogueVoiceMapping(job: MockBatchJob): boolean {
  const dial = (job.configOverrides as Record<string, any>)?.dialogue;
  if (!dial) return false;
  const charVoices = dial.characterVoices;
  const charSpeeds = dial.characterSpeeds;
  const charPitches = dial.characterPitches;
  const hasVoice = !!(charVoices && Object.keys(charVoices).length > 0 && Object.values(charVoices).some((v) => typeof v === "string" && (v as string).trim().length > 0));
  const hasSpeed = !!(charSpeeds && Object.keys(charSpeeds).length > 0);
  const hasPitch = !!(charPitches && Object.keys(charPitches).length > 0);
  return hasVoice || hasSpeed || hasPitch;
}

export const DEFAULT_SAMPLE_DIALOGUE_SCRIPT = `[Nam]: Chào mừng các bạn đến với tập podcast công nghệ ngày hôm nay.
[Lan]: Hôm nay chúng ta sẽ thảo luận về tính năng phân vai và gán giọng hàng loạt.
[Người dẫn chuyện]: VoxLab cho phép xử lý kịch bản phân vai độc lập cho từng tệp tin trong mẻ chạy hàng loạt.
[Nam]: Đúng vậy, mỗi nhân vật có thể được gán một giọng riêng độc lập.
[Lan]: Và nếu không gán riêng, hệ thống sẽ sử dụng giọng mặc định có hiệu lực của file!`;

export interface EffectiveCharacterVoiceResult {
  voiceName: string;
  source: "character" | "file_custom" | "global_default";
  isCompatible: boolean;
  warning?: string;
  voiceProfile?: VoiceProfile;
}

/**
 * Resolves effective voice for a character following 3-tier precedence:
 * Character Custom Voice > File Custom Default > Global Defaults
 */
export function resolveEffectiveCharacterVoice(
  characterId: string,
  job: MockBatchJob,
  globalDefaults: BatchGlobalDefaults,
  currentModel: string = "Omni Voice",
  allVoices: VoiceProfile[] = MOCK_VOICES
): EffectiveCharacterVoiceResult {
  const normId = normalizeCharacterId(characterId);
  const workingDialogue = getJobWorkingConfig(job).dialogue;
  const charVoices = workingDialogue?.characterVoices || {};
  let customVoice = charVoices[normId] || charVoices[characterId];
  if (!customVoice) {
    const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "_");
    const targetKey = stripAccents(characterId);
    for (const [k, v] of Object.entries(charVoices)) {
      if (stripAccents(k) === targetKey) {
        customVoice = v;
        break;
      }
    }
  }
  const fileDefault = job.configOverrides?.dialogue?.defaultVoice;
  const globalDefault = globalDefaults.dialogue.defaultVoice || "Minh Quang (Hà Nội)";

  let voiceName: string;
  let source: "character" | "file_custom" | "global_default";

  if (customVoice) {
    voiceName = customVoice;
    source = "character";
  } else if (fileDefault) {
    voiceName = fileDefault;
    source = "file_custom";
  } else {
    voiceName = globalDefault;
    source = "global_default";
  }

  // Find voice profile from library
  const voiceProfile = allVoices.find(
    (v) => v.name.toLowerCase() === voiceName.toLowerCase() || v.id === voiceName
  );

  let isCompatible = true;
  let warning: string | undefined;

  if (!voiceProfile) {
    isCompatible = false;
    warning = `Giọng "${voiceName}" không tìm thấy trong Voice Library.`;
  } else if (
    voiceProfile.modelCompatibility &&
    !voiceProfile.modelCompatibility.includes(currentModel)
  ) {
    isCompatible = false;
    warning = `Giọng "${voiceProfile.name}" không tương thích với mô hình ${currentModel}.`;
  }

  return {
    voiceName: voiceProfile ? voiceProfile.name : voiceName,
    source,
    isCompatible,
    warning,
    voiceProfile,
  };
}

/**
 * Computes the derived configuration diff between a job's actual working configuration
 * and its frozen execution snapshot (effectiveConfigSnapshot).
 *
 * Rules:
 * 1. AI Config Changed -> Invalidate downstream tasks according to Invalidation Graph -> CTA: [Tạo lại]
 * 2. Output Config Changed Only -> Reuse valid intermediate artifacts (0 AI calls) -> CTA: [Xuất lại]
 * 3. Unchanged -> Resume previous execution -> CTA: [Thử lại]
 */
export function computeJobConfigDiff(
  job: MockBatchJob,
  _legacyGlobalDefaults?: BatchGlobalDefaults
): JobConfigDiffResult {
  const working = getJobWorkingConfig(job);
  const resolved = resolveJobEffectiveConfig(job);

  // If job has no frozen snapshot (e.g. In staging or newly added), it has not run yet
  if (!job.effectiveConfigSnapshot) {
    return {
      isConfigChanged: false,
      aiConfigChanged: false,
      outputConfigChanged: false,
      canReuseArtifacts: true,
      invalidatedFromStep: undefined,
      ctaType: "retry",
      ctaLabel: "Thử lại",
      diffSummary: [],
      resolvedEffectiveConfig: resolved,
    };
  }

  const snapshot = job.effectiveConfigSnapshot as Record<string, any>;
  const diffSummary: string[] = [];

  // 1. Output Settings Comparison
  let outputConfigChanged = false;
  if (snapshot.outputPath !== undefined && working.outputPath !== undefined && snapshot.outputPath !== working.outputPath) {
    outputConfigChanged = true;
    diffSummary.push(`Thư mục xuất: "${snapshot.outputPath}" ➔ "${working.outputPath}"`);
  }
  if (snapshot.saveInSourceFolder !== undefined && working.saveInSourceFolder !== undefined && snapshot.saveInSourceFolder !== working.saveInSourceFolder) {
    outputConfigChanged = true;
    diffSummary.push(`Lưu cùng thư mục gốc: ${snapshot.saveInSourceFolder} ➔ ${working.saveInSourceFolder}`);
  }
  if (snapshot.collisionPolicy !== undefined && working.collisionPolicy !== undefined && snapshot.collisionPolicy !== working.collisionPolicy) {
    outputConfigChanged = true;
    diffSummary.push(`Xử lý trùng tên: ${snapshot.collisionPolicy} ➔ ${working.collisionPolicy}`);
  }
  if (snapshot.outputAudioFormat !== undefined && working.outputAudioFormat !== undefined && snapshot.outputAudioFormat !== working.outputAudioFormat) {
    outputConfigChanged = true;
    diffSummary.push(`Định dạng âm thanh: ${snapshot.outputAudioFormat} ➔ ${working.outputAudioFormat}`);
  }
  if (snapshot.outputSubtitleFormat !== undefined && working.outputSubtitleFormat !== undefined && snapshot.outputSubtitleFormat !== working.outputSubtitleFormat) {
    outputConfigChanged = true;
    diffSummary.push(`Định dạng phụ đề: ${snapshot.outputSubtitleFormat} ➔ ${working.outputSubtitleFormat}`);
  }

  // 2. AI Execution Config Comparison (Task dependency order)
  let aiConfigChanged = false;
  let firstInvalidated: BatchTaskType | undefined = undefined;

  for (const task of job.executionSequence) {
    const curTaskConfig = working[task as keyof BatchGlobalDefaults];
    const snapTaskConfig = snapshot[task];
    if (JSON.stringify(curTaskConfig ?? null) !== JSON.stringify(snapTaskConfig ?? null)) {
      aiConfigChanged = true;
      diffSummary.push(`Cấu hình AI [${task}] đã thay đổi`);
      if (!firstInvalidated) {
        firstInvalidated = task;
      }
    }
  }

  // 3. Artifact Reuse Eligibility for Output-Only Changes
  let canReuseArtifacts = false;
  if (job.status === "failed_with_artifact" || job.status === "completed" || job.status === "completed_with_warning") {
    const hasSubArtifacts = (job.outputArtifacts?.subtitles?.length ?? 0) > 0;
    const hasAudioArtifact = !!job.outputArtifacts?.audioPath;
    const hasStepOutputs = Object.values(job.stepResults).some(
      (s) => s?.status === "completed" && (s.outputArtifactPaths?.length ?? 0) > 0
    );
    canReuseArtifacts = hasSubArtifacts || hasAudioArtifact || hasStepOutputs;
  }

  const isConfigChanged = aiConfigChanged || outputConfigChanged;

  let ctaType: "retry" | "regenerate_ai" | "re_export" = "retry";
  let ctaLabel = "Thử lại";

  if (!isConfigChanged) {
    ctaType = "retry";
    ctaLabel = "Thử lại";
  } else if (aiConfigChanged) {
    ctaType = "regenerate_ai";
    ctaLabel = "Tạo lại";
  } else if (outputConfigChanged) {
    if (canReuseArtifacts) {
      ctaType = "re_export";
      ctaLabel = "Xuất lại";
    } else {
      ctaType = "regenerate_ai";
      ctaLabel = "Tạo lại";
    }
  }

  return {
    isConfigChanged,
    aiConfigChanged,
    outputConfigChanged,
    canReuseArtifacts,
    invalidatedFromStep: firstInvalidated,
    ctaType,
    ctaLabel,
    diffSummary,
    resolvedEffectiveConfig: resolved,
  };
}

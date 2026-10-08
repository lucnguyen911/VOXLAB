import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  FileText,
  Video,
  FileCode,
  SlidersHorizontal,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  FolderOpen,
  Ban,
  X,
  Info,
  Search,
  Sparkles,
  MessageSquare,
  Mic,
  Subtitles,
  Languages,
  Film,
  Gauge,
  Activity,
  Volume2,
  VolumeX,
  Settings,
  ChevronRight,
  ShieldCheck,
  Zap,
  Sliders,
  ArrowUp,
  ArrowDown,
  Eye,
  Music,
  Check,
  UploadCloud,
  Users,
  RefreshCw,
  ListPlus,
} from "lucide-react";
import { useI18n } from "../i18n/context";
import { CountryFlag } from "../components/common/CountryFlag";
import { extractFilesFromDropEvent } from "../services/fileDropHelper";
import { VoiceSelectionModal } from "../components/modals/VoiceSelectionModal";
import { MOCK_VOICES } from "../mock/data";
import { VoiceProfile } from "../types/ui";
import { loadStoredTtsSettings, saveStoredTtsSettings } from "../components/inspector/TtsInspector";
import {
  loadSubtitleSettings,
  saveSubtitleSettings,
  WHISPER_AUDIO_LANGUAGES,
  SubtitleSpeechSpeed,
  SubtitleProcessingSpeed,
  SubtitleAspectRatio,
  SubtitleMaxLines,
} from "../services/subtitle";
import {
  getVoiceLanguageInfo,
  normalizeAccent,
  getAccentLabel,
  getVoiceSecondaryTags,
} from "../constants/voiceFilters";
import { SearchableLanguageSelect } from "../components/common/SearchableLanguageSelect";
import {
  TRANSLATION_SOURCE_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
} from "../services/subtitle/languages";
import {
  translationManager,
  loadTranslationSettings,
  saveTranslationSettings,
} from "../services/translation";
import { TranslationStyle } from "../services/translation/types";
import {
  DialogueGlobalSettings,
  DEFAULT_DIALOGUE_SETTINGS,
  DialogueCharacter,
} from "../types/dialogue";
import {
  parseDialogueScript,
  normalizeCharacterId,
  detectDialogueScript,
} from "../services/dialogue/parser";
import { CharacterCard } from "../components/dialogue/CharacterCard";
import {
  NORMALIZER_GROUPS,
  NormalizerGroupId,
  getDefaultEnabledGroupIds,
  loadSavedGroupIds,
  saveGroupIds,
} from "../services/normalizer";
import {
  PronunciationRule,
  loadGlobalRules,
} from "../services/pronunciation";
import { PronunciationManagerModal } from "../components/modals/PronunciationManagerModal";
import { syncBatchJobToHistory } from "../services/history/historyManager";

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
      comma: 0.5,
      period: 0.5,
      questionExclamation: 1.0,
      colonSemicolon: 0.6,
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
      comma: 0.5,
      period: 0.5,
      questionExclamation: 1.0,
      colonSemicolon: 0.6,
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
      comma: 0.5,
      period: 0.5,
      questionExclamation: 1.0,
      colonSemicolon: 0.6,
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
      concurrency: typeof parsed.concurrency === "number" ? parsed.concurrency : fallback.concurrency,
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
      concurrency: settings.concurrency !== undefined ? settings.concurrency : (current.concurrency ?? 1),
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
      comma: 0.5,
      period: 0.5,
      questionExclamation: 1.0,
      colonSemicolon: 0.6,
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
        comma: typeof parsed.pauses.comma === "number" ? parsed.pauses.comma : 0.5,
        period: typeof parsed.pauses.period === "number" ? parsed.pauses.period : 0.5,
        questionExclamation: typeof parsed.pauses.questionExclamation === "number" ? parsed.pauses.questionExclamation : 1.0,
        colonSemicolon: typeof parsed.pauses.colonSemicolon === "number" ? parsed.pauses.colonSemicolon : 0.6,
      } : fallback.pauses,
      concurrency: typeof parsed.concurrency === "number" ? parsed.concurrency : fallback.concurrency,
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
      concurrency: settings.concurrency ?? current.concurrency,
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

// ==========================================
// Initial Sample Batch Dataset
// ==========================================

const INITIAL_SAMPLE_JOBS: MockBatchJob[] = [
  {
    id: "job-01",
    fileName: "document_huong_dan_su_dung.txt",
    filePath: "D:/TaiLieu/document_huong_dan_su_dung.txt",
    fileSize: "14.2 KB",
    fileKind: "text",
    hasDialogueStructure: false, // Plain text
    stage: "staging",
    queueOrder: 0,
    selectedTasks: ["tts"],
    executionSequence: ["tts"],
    stepResults: {
      tts: {
        task: "tts",
        status: "waiting",
        progressPct: 0,
      },
    },
    status: "waiting",
    progressPct: 0,
  },
  {
    id: "job-02",
    fileName: "kich_ban_hoi_thoai_podcast.txt",
    filePath: "D:/KichBan/kich_ban_hoi_thoai_podcast.txt",
    fileSize: "28.6 KB",
    fileKind: "text",
    hasDialogueStructure: true, // Has [Tên]: character lines
    stage: "staging",
    queueOrder: 0,
    selectedTasks: ["dialogue"],
    executionSequence: ["dialogue"],
    stepResults: {
      dialogue: {
        task: "dialogue",
        status: "waiting",
        progressPct: 0,
      },
    },
    status: "waiting",
    progressPct: 0,
    hasCustomConfig: true,
    scriptContent: DEFAULT_SAMPLE_DIALOGUE_SCRIPT,
    configOverrides: {
      dialogue: {
        model: "Omni Voice",
        defaultVoice: "Minh Quang (Hà Nội)",
        characterVoices: {
          nam: "Minh Quang (Hà Nội)",
          lan: "Thảo Trinh (Hà Nội)",
          nguoi_dan_chuyen: "Mai Chi (Sài Gòn)",
        },
      },
    },
  },
  {
    id: "job-09",
    fileName: "audio_ban_tin_buoi_sang.mp3",
    filePath: "D:/Media/audio_ban_tin_buoi_sang.mp3",
    fileSize: "18.3 MB",
    fileKind: "media",
    stage: "staging",
    queueOrder: 0,
    selectedTasks: ["transcription", "translation"],
    executionSequence: ["transcription", "translation"],
    stepResults: {
      transcription: { task: "transcription", status: "waiting", progressPct: 0 },
      translation: { task: "translation", status: "waiting", progressPct: 0 },
    },
    status: "waiting",
    progressPct: 0,
  },
  {
    id: "job-03",
    fileName: "video_phong_su_cong_nghe.mp4",
    filePath: "D:/Media/video_phong_su_cong_nghe.mp4",
    fileSize: "145.8 MB",
    fileKind: "media",
    stage: "queued",
    queueOrder: 1,
    selectedTasks: ["transcription", "translation", "dubbing"],
    executionSequence: ["transcription", "translation", "dubbing"],
    stepResults: {
      transcription: {
        task: "transcription",
        status: "completed",
        progressPct: 100,
        outputArtifactPaths: ["D:/VoxLabOutput/Batch_Export/video_phong_su_cong_nghe/video_phong_su_cong_nghe.srt"],
      },
      translation: {
        task: "translation",
        status: "processing",
        progressPct: 65,
      },
      dubbing: {
        task: "dubbing",
        status: "waiting",
        progressPct: 0,
      },
    },
    status: "processing",
    progressPct: 55,
  },
  {
    id: "job-06",
    fileName: "video_gioi_thieu_khoa_hoc.mp4",
    filePath: "D:/Media/video_gioi_thieu_khoa_hoc.mp4",
    fileSize: "92.0 MB",
    fileKind: "media",
    stage: "queued",
    queueOrder: 2,
    selectedTasks: ["transcription", "translation"],
    executionSequence: ["transcription", "translation"],
    stepResults: {
      transcription: {
        task: "transcription",
        status: "waiting",
        progressPct: 0,
      },
      translation: {
        task: "translation",
        status: "waiting",
        progressPct: 0,
      },
    },
    status: "waiting",
    progressPct: 0,
    inputChanged: true, // Modified externally
  },
  {
    id: "job-07",
    fileName: "bai_giang_tieng_anh.mp4",
    filePath: "D:/Media/bai_giang_tieng_anh.mp4",
    fileSize: "210.5 MB",
    fileKind: "media",
    stage: "queued",
    queueOrder: 3,
    selectedTasks: ["transcription"],
    executionSequence: ["transcription"],
    stepResults: {
      transcription: {
        task: "transcription",
        status: "waiting",
        progressPct: 0,
      },
    },
    status: "waiting",
    progressPct: 0,
  },
  {
    id: "job-04",
    fileName: "phu_de_phim_ngan_tap1.srt",
    filePath: "D:/Subtitles/phu_de_phim_ngan_tap1.srt",
    fileSize: "42.1 KB",
    fileKind: "subtitle",
    stage: "queued",
    queueOrder: 0,
    selectedTasks: ["translation", "dubbing"],
    executionSequence: ["translation", "dubbing"],
    stepResults: {
      translation: {
        task: "translation",
        status: "completed",
        progressPct: 100,
        outputArtifactPaths: ["D:/VoxLabOutput/Batch_Export/phu_de_phim_ngan_tap1/phu_de_phim_ngan_tap1_vi.srt"],
      },
      dubbing: {
        task: "dubbing",
        status: "completed",
        progressPct: 100,
        outputArtifactPaths: ["D:/VoxLabOutput/Batch_Export/phu_de_phim_ngan_tap1/phu_de_phim_ngan_tap1_master.wav"],
      },
    },
    status: "completed",
    progressPct: 100,
    outputArtifacts: {
      audioPath: "D:/VoxLabOutput/Batch_Export/phu_de_phim_ngan_tap1/phu_de_phim_ngan_tap1_master.wav",
      audioDuration: 84,
      subtitles: [
        {
          path: "D:/VoxLabOutput/Batch_Export/phu_de_phim_ngan_tap1/phu_de_phim_ngan_tap1_vi.srt",
          label: "Bản dịch Tiếng Việt (.srt)",
          cues: [
            { time: "00:00.500 → 00:03.200", text: "Chào mừng các bạn đến với tập 1 bộ phim ngắn." },
            { time: "00:03.500 → 00:07.100", text: "Cuộc hành trình khám phá công nghệ tương lai bắt đầu từ đây." },
            { time: "00:07.400 → 00:11.800", text: "Tất cả giọng lồng tiếng đều được tạo tự động bằng VoxLab AI." },
          ],
        },
      ],
    },
  },
  {
    id: "job-08",
    fileName: "phim_tai_lieu_thien_nhien.mkv",
    filePath: "D:/Media/phim_tai_lieu_thien_nhien.mkv",
    fileSize: "320.1 MB",
    fileKind: "media",
    stage: "queued",
    queueOrder: 0,
    selectedTasks: ["transcription", "translation", "dubbing"],
    executionSequence: ["transcription", "translation", "dubbing"],
    stepResults: {
      transcription: {
        task: "transcription",
        status: "completed",
        progressPct: 100,
        outputArtifactPaths: ["D:/VoxLabOutput/Batch_Export/phim_tai_lieu_thien_nhien/phim_tai_lieu_thien_nhien.srt"],
      },
      translation: {
        task: "translation",
        status: "completed",
        progressPct: 100,
        outputArtifactPaths: ["D:/VoxLabOutput/Batch_Export/phim_tai_lieu_thien_nhien/phim_tai_lieu_thien_nhien_vi.srt"],
      },
      dubbing: {
        task: "dubbing",
        status: "completed_with_warning",
        progressPct: 100,
        warning: "Cảnh báo WSOLA 1.20x va chạm âm thanh — Đã chặn Master WAV để bảo vệ chất lượng audio",
      },
    },
    status: "completed_with_warning",
    progressPct: 100,
    outputArtifacts: {
      subtitles: [
        {
          path: "D:/VoxLabOutput/Batch_Export/phim_tai_lieu_thien_nhien/phim_tai_lieu_thien_nhien.srt",
          label: "Phụ đề gốc (.srt)",
          cues: [
            { time: "00:01.000 → 00:04.500", text: "Nature has always been a great mystery to humans." },
            { time: "00:05.000 → 00:09.200", text: "In this documentary, we explore the deep ocean trenches." },
          ],
        },
        {
          path: "D:/VoxLabOutput/Batch_Export/phim_tai_lieu_thien_nhien/phim_tai_lieu_thien_nhien_vi.srt",
          label: "Bản dịch Tiếng Việt (.srt)",
          cues: [
            { time: "00:01.000 → 00:04.500", text: "Thiên nhiên luôn là một bí ẩn vĩ đại đối với con người." },
            { time: "00:05.000 → 00:09.200", text: "Trong bộ phim tài liệu này, chúng ta khám phá những rãnh đại dương sâu thẳm." },
          ],
        },
      ],
    },
  },
  {
    id: "job-05",
    fileName: "audio_phong_van_chuyen_gia.wav",
    filePath: "D:/Media/audio_phong_van_chuyen_gia.wav",
    fileSize: "68.4 MB",
    fileKind: "media",
    stage: "queued",
    queueOrder: 5,
    selectedTasks: ["transcription", "translation", "dubbing"],
    executionSequence: ["transcription", "translation", "dubbing"],
    stepResults: {
      transcription: {
        task: "transcription",
        status: "completed",
        progressPct: 100,
        outputArtifactPaths: ["D:/VoxLabOutput/Batch_Export/audio_phong_van_chuyen_gia/audio_phong_van_chuyen_gia.srt"],
      },
      translation: {
        task: "translation",
        status: "completed",
        progressPct: 100,
        outputArtifactPaths: ["D:/VoxLabOutput/Batch_Export/audio_phong_van_chuyen_gia/audio_phong_van_chuyen_gia_vi.srt"],
      },
      dubbing: {
        task: "dubbing",
        status: "failed",
        progressPct: 40,
        error: "Sự cố bộ nhớ (OOM) khi tổng hợp audio cue 34. Đã lưu an toàn 2 file phụ đề.",
      },
    },
    status: "failed_with_artifact",
    progressPct: 70,
    retryFromStep: "dubbing",
    effectiveConfigSnapshot: {
      outputPath: "D:/VoxLabOutput/Batch_Export",
      saveInSourceFolder: false,
      collisionPolicy: "auto_rename",
      outputAudioFormat: "wav",
      outputSubtitleFormat: "srt",
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
        provider: "LM Studio (Qwen 3.5 Local)",
        sourceLanguage: "auto",
        targetLanguage: "vi",
        style: "cinema",
        contextAware: true,
      },
      dubbing: {
        ttsModel: "Omni Voice",
        voice: "Mai Chi (Sài Gòn)",
        speedMultiplier: 1.15,
        turnPauseSec: 0.3,
        autoFit: true,
        masterVolume: 1.0,
        collisionGuardrail: "wsola_autofit",
      },
    },
    configOverrides: {},
    hasCustomConfig: false,
    outputArtifacts: {
      subtitles: [
        {
          path: "D:/VoxLabOutput/Batch_Export/audio_phong_van_chuyen_gia/audio_phong_van_chuyen_gia.srt",
          label: "Phụ đề gốc (.srt)",
          cues: [
            { time: "00:00.800 → 00:03.500", text: "Good morning. Can you tell us about the latest AI advancements?" },
          ],
        },
        {
          path: "D:/VoxLabOutput/Batch_Export/audio_phong_van_chuyen_gia/audio_phong_van_chuyen_gia_vi.srt",
          label: "Bản dịch Tiếng Việt (.srt)",
          cues: [
            { time: "00:00.800 → 00:03.500", text: "Chào buổi sáng. Ông có thể chia sẻ về những tiến bộ AI mới nhất không?" },
          ],
        },
      ],
    },
  },
  {
    id: "job-10",
    fileName: "video_hoi_thao_kinh_te.mp4",
    filePath: "D:/Media/video_hoi_thao_kinh_te.mp4",
    fileSize: "185.2 MB",
    fileKind: "media",
    stage: "queued",
    queueOrder: 6,
    selectedTasks: ["transcription", "translation"],
    executionSequence: ["transcription", "translation"],
    stepResults: {
      transcription: {
        task: "transcription",
        status: "failed",
        progressPct: 15,
        error: "Không thể giải mã luồng âm thanh AAC (Corrupt audio frame at 00:01:23)",
      },
    },
    status: "failed",
    progressPct: 10,
    retryFromStep: "transcription",
    effectiveConfigSnapshot: {
      outputPath: "D:/VoxLabOutput/Batch_Export",
      saveInSourceFolder: false,
      collisionPolicy: "auto_rename",
      outputAudioFormat: "wav",
      outputSubtitleFormat: "srt",
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
        provider: "LM Studio (Qwen 3.5 Local)",
        sourceLanguage: "auto",
        targetLanguage: "vi",
        style: "cinema",
        contextAware: true,
      },
    },
    configOverrides: {},
    hasCustomConfig: false,
  },
  {
    id: "job-11",
    fileName: "kich_ban_quang_cao_tet.txt",
    filePath: "D:/KichBan/kich_ban_quang_cao_tet.txt",
    fileSize: "12.8 KB",
    fileKind: "text",
    hasDialogueStructure: true,
    stage: "queued",
    queueOrder: 7,
    selectedTasks: ["dialogue"],
    executionSequence: ["dialogue"],
    stepResults: {
      dialogue: {
        task: "dialogue",
        status: "failed",
        progressPct: 50,
        error: "TTS Worker Timeout sau 60s khi tổng hợp câu thoại phân vai của 'Nhân vật B'",
      },
    },
    status: "failed",
    progressPct: 50,
    retryFromStep: "dialogue",
    effectiveConfigSnapshot: {
      outputPath: "D:/VoxLabOutput/Batch_Export",
      saveInSourceFolder: false,
      collisionPolicy: "auto_rename",
      outputAudioFormat: "wav",
      outputSubtitleFormat: "srt",
      dialogue: {
        model: "Omni Voice",
        defaultVoice: "Minh Quang (Hà Nội)",
        masterVolume: 1.0,
        turnPauseSec: 0.4,
        sameSpeakerPauseSec: 0.2,
        pauses: { comma: 0.5, period: 0.5, questionExclamation: 1.0, colonSemicolon: 0.6 },
        concurrency: 1,
        exportSrt: true,
        aspectRatio: "16:9",
        maxLines: 1,
      },
    },
    configOverrides: {},
    hasCustomConfig: false,
  },
  {
    id: "job-12",
    fileName: "phu_de_phim_tai_lieu.srt",
    filePath: "D:/Subtitles/phu_de_phim_tai_lieu.srt",
    fileSize: "35.6 KB",
    fileKind: "subtitle",
    stage: "queued",
    queueOrder: 8,
    selectedTasks: ["translation", "dubbing"],
    executionSequence: ["translation", "dubbing"],
    stepResults: {
      translation: {
        task: "translation",
        status: "cancelled",
        progressPct: 60,
      },
    },
    status: "cancelled",
    progressPct: 30,
    retryFromStep: "translation",
    effectiveConfigSnapshot: {
      outputPath: "D:/VoxLabOutput/Batch_Export",
      saveInSourceFolder: false,
      collisionPolicy: "auto_rename",
      outputAudioFormat: "wav",
      outputSubtitleFormat: "srt",
      translation: {
        provider: "LM Studio (Qwen 3.5 Local)",
        sourceLanguage: "auto",
        targetLanguage: "vi",
        style: "cinema",
        contextAware: true,
      },
      dubbing: {
        ttsModel: "Omni Voice",
        voice: "Mai Chi (Sài Gòn)",
        speedMultiplier: 1.15,
        turnPauseSec: 0.3,
        autoFit: true,
        masterVolume: 1.0,
        collisionGuardrail: "wsola_autofit",
      },
    },
    configOverrides: {},
    hasCustomConfig: false,
  },
  {
    id: "job-13",
    fileName: "audio_sach_noi_chuong1.wav",
    filePath: "D:/Media/audio_sach_noi_chuong1.wav",
    fileSize: "112.0 MB",
    fileKind: "media",
    stage: "queued",
    queueOrder: 9,
    selectedTasks: ["transcription"],
    executionSequence: ["transcription"],
    stepResults: {
      transcription: {
        task: "transcription",
        status: "interrupted",
        progressPct: 80,
      },
    },
    status: "interrupted",
    progressPct: 80,
    retryFromStep: "transcription",
    effectiveConfigSnapshot: {
      outputPath: "D:/VoxLabOutput/Batch_Export",
      saveInSourceFolder: false,
      collisionPolicy: "auto_rename",
      outputAudioFormat: "wav",
      outputSubtitleFormat: "srt",
      transcription: {
        whisperModel: "large-v3-turbo",
        audioLanguage: "auto",
        speechSpeed: "1.0",
        processingSpeed: "auto",
        aspectRatio: "16:9",
        maxLines: 1,
        outputFormat: "srt",
      },
    },
    configOverrides: {},
    hasCustomConfig: false,
  },
];

// ==========================================
// Main Component: BatchWorkspacePrototype
// ==========================================

export const BatchWorkspacePrototype: React.FC = () => {
  const { t, lang } = useI18n();

  // State Management
  const [jobs, setJobs] = useState<MockBatchJob[]>(INITIAL_SAMPLE_JOBS);
  const [queueStatus, setQueueStatus] = useState<BatchQueueStatus>("idle");
  const [globalDefaults, setGlobalDefaults] = useState<BatchGlobalDefaults>(() => {
    const saved = loadBatchOutputSettings();
    const storedTts = loadStoredTtsSettings();
    const storedSubtitles = loadSubtitleSettings();
    const storedDubbing = loadStoredDubbingSettings();
    const storedTranslation = loadTranslationSettings();
    const storedDialogue = loadStoredDialogueSettings();
    return {
      ...DEFAULT_GLOBAL_SETTINGS,
      saveInSourceFolder: saved.saveInSourceFolder,
      outputPath: saved.outputPath,
      collisionPolicy: saved.collisionPolicy,
      outputAudioFormat: saved.outputAudioFormat,
      outputSubtitleFormat: saved.outputSubtitleFormat,
      concurrency: saved.concurrency ?? 1,
      text: {
        autoNormalize: true,
        enabledGroupIds: loadSavedGroupIds(),
        applyPronunciation: true,
      },
      transcription: {
        ...DEFAULT_GLOBAL_SETTINGS.transcription,
        whisperModel: storedSubtitles.whisperModel || DEFAULT_GLOBAL_SETTINGS.transcription.whisperModel,
        audioLanguage: storedSubtitles.audioLanguage || DEFAULT_GLOBAL_SETTINGS.transcription.audioLanguage,
        speechSpeed: (String(storedSubtitles.speechSpeed) as "1.0" | "0.9" | "0.8") || DEFAULT_GLOBAL_SETTINGS.transcription.speechSpeed,
        processingSpeed: storedSubtitles.processingSpeed || DEFAULT_GLOBAL_SETTINGS.transcription.processingSpeed,
        aspectRatio: storedSubtitles.aspectRatio || DEFAULT_GLOBAL_SETTINGS.transcription.aspectRatio,
        maxLines: (storedSubtitles.maxLines === 1 ? 1 : 2),
        outputFormat: saved.outputSubtitleFormat,
      },
      tts: {
        ...DEFAULT_GLOBAL_SETTINGS.tts,
        speed: storedTts.speed,
        pitch: storedTts.pitch,
        volume: storedTts.volume,
        pauses: storedTts.pauses,
        concurrency: storedTts.concurrency,
        exportSrt: storedTts.exportSrt ?? false,
      },
      dubbing: {
        ...DEFAULT_GLOBAL_SETTINGS.dubbing,
        voice: storedDubbing.voice,
        ttsModel: storedDubbing.ttsModel,
        speed: storedDubbing.speed,
        pitch: storedDubbing.pitch,
        volume: storedDubbing.volume,
        pauses: storedDubbing.pauses,
        concurrency: storedDubbing.concurrency,
        autoFit: storedDubbing.autoFit,
      },
      dialogue: {
        ...DEFAULT_GLOBAL_SETTINGS.dialogue,
        model: storedDialogue.model,
        masterVolume: storedDialogue.masterVolume,
        pauses: storedDialogue.pauses,
        concurrency: storedDialogue.concurrency,
        exportSrt: storedDialogue.exportSrt,
        aspectRatio: storedSubtitles.aspectRatio || "16:9",
        maxLines: (storedSubtitles.maxLines === 1 ? 1 : 2),
      },
      translation: {
        ...DEFAULT_GLOBAL_SETTINGS.translation,
        provider: storedTranslation.translationProviderId || DEFAULT_GLOBAL_SETTINGS.translation.provider,
        sourceLanguage: storedTranslation.sourceLanguage || DEFAULT_GLOBAL_SETTINGS.translation.sourceLanguage,
        targetLanguage: storedTranslation.targetLanguage || DEFAULT_GLOBAL_SETTINGS.translation.targetLanguage,
        style: (storedTranslation.translationStyle as "default" | "cinema") || DEFAULT_GLOBAL_SETTINGS.translation.style,
      },
    };
  });

  const [isTtsVoiceModalOpen, setIsTtsVoiceModalOpen] = useState(false);
  const activeTtsVoice = useMemo(() => {
    return (
      MOCK_VOICES.find((v) => v.name === globalDefaults.tts.voice || v.id === globalDefaults.tts.voice) ||
      MOCK_VOICES[0]
    );
  }, [globalDefaults.tts.voice]);

  const [isDubbingVoiceModalOpen, setIsDubbingVoiceModalOpen] = useState(false);
  const activeDubbingVoice = useMemo(() => {
    return (
      MOCK_VOICES.find((v) => v.name === globalDefaults.dubbing.voice || v.id === globalDefaults.dubbing.voice) ||
      MOCK_VOICES.find((v) => v.name === "Thảo Trinh (Hà Nội)") ||
      MOCK_VOICES[0]
    );
  }, [globalDefaults.dubbing.voice]);

  // Translation providers list filtered by active translation style
  const allTranslationProviders = useMemo(() => translationManager.listProviders(), []);
  const availableTranslationProviders = useMemo(() => {
    if (globalDefaults.translation.style === "cinema") {
      return allTranslationProviders.filter((p) => p.type !== "google");
    }
    return allTranslationProviders;
  }, [allTranslationProviders, globalDefaults.translation.style]);

  // Automatically remember latest output settings in persistent storage
  useEffect(() => {
    saveBatchOutputSettings({
      saveInSourceFolder: globalDefaults.saveInSourceFolder,
      outputPath: globalDefaults.outputPath,
      collisionPolicy: globalDefaults.collisionPolicy,
      outputAudioFormat: globalDefaults.outputAudioFormat,
      outputSubtitleFormat: globalDefaults.outputSubtitleFormat,
    });
  }, [
    globalDefaults.saveInSourceFolder,
    globalDefaults.outputPath,
    globalDefaults.collisionPolicy,
    globalDefaults.outputAudioFormat,
    globalDefaults.outputSubtitleFormat,
  ]);

  // 4 Unified Workspace Views: "list" | "queued" | "completed" | "failed"
  const [activeView, setActiveView] = useState<"list" | "queued" | "completed" | "failed">("list");

  const handleCancelProcessingJob = (targetJob: MockBatchJob) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === targetJob.id ? { ...j, isCancelling: true } : j))
    );
    setTimeout(() => {
      setJobs((prev) =>
        prev.map((j) => (j.id === targetJob.id ? { ...j, status: "cancelled", isCancelling: false } : j))
      );
      setNotification({
        id: `cancel-${Date.now()}`,
        type: "info",
        message: "Tác vụ đã được dừng an toàn. Các tệp phụ đề đã tạo được giữ nguyên.",
      });
    }, 1200);
  };

  const handleTogglePauseJob = (targetJob: MockBatchJob) => {
    const isCurrentlyPaused = targetJob.status === "paused";
    const nextStatus = isCurrentlyPaused
      ? (targetJob.progressPct > 0 ? "processing" : "waiting")
      : "paused";

    setJobs((prev) =>
      prev.map((j) => {
        if (j.id === targetJob.id) {
          return {
            ...j,
            status: nextStatus,
          };
        }
        return j;
      })
    );
    setNotification({
      id: `pause-${Date.now()}`,
      type: "info",
      message: isCurrentlyPaused
        ? `Đang tiếp tục xử lý: ${targetJob.fileName}`
        : `Đã tạm dừng xử lý: ${targetJob.fileName}`,
    });
  };

  const handleCancelJob = (targetJob: MockBatchJob) => {
    if (targetJob.status === "processing" || targetJob.status === "paused") {
      handleCancelProcessingJob(targetJob);
    } else {
      handleRemoveFromQueue(targetJob.id);
    }
  };

  // Row Scope Selection (Cột 1 Checkbox)
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());

  // Per-File Drawer Tab & Preview Player States
  const [activeDrawerTab, setActiveDrawerTab] = useState<"config" | "preview">("config");
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [previewPlaybackTime, setPreviewPlaybackTime] = useState(14);
  const [previewVolume, setPreviewVolume] = useState(80);
  const [previewSubtitleTab, setPreviewSubtitleTab] = useState<string>("translated");

  // Character & Task Voice Modal Target State
  const [voiceModalTarget, setVoiceModalTarget] = useState<{
    jobId: string;
    charId?: string;
    taskType?: "tts" | "dialogue" | "dubbing";
  } | null>(null);

  // Voice Preview Playback (Audio sample or synthesizer fallback)
  const handlePlayVoicePreview = (voiceNameOrId: string) => {
    const profile = MOCK_VOICES.find(
      (v) => v.name.toLowerCase() === voiceNameOrId.toLowerCase() || v.id === voiceNameOrId
    );
    if (profile?.sampleAudioPath) {
      try {
        const audio = new Audio(profile.sampleAudioPath);
        audio.play().catch(() => {});
      } catch {}
    } else {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } catch {}
    }
  };

  const handleResetCharacterVoice = (jobId: string, charId: string) => {
    const targetJob = jobs.find((j) => j.id === jobId);
    if (!targetJob) return;
    const prevCharVoices = { ...((targetJob.configOverrides as Record<string, any>)?.dialogue?.characterVoices || {}) };
    const normId = normalizeCharacterId(charId);
    const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "_");
    const targetKey = stripAccents(charId);
    for (const k of Object.keys(prevCharVoices)) {
      if (k === charId || k === normId || stripAccents(k) === targetKey) {
        delete prevCharVoices[k];
      }
    }
    handleUpdateJobTaskConfig(jobId, "dialogue", {
      characterVoices: prevCharVoices,
    });
    setNotification({
      id: `reset-char-voice-${Date.now()}`,
      type: "info",
      message: "Đã khôi phục nhân vật về giọng mặc định của tệp.",
    });
  };

  // Re-parse dialogue script and sync character voices table
  const handleSyncDialogueScript = (jobId: string) => {
    const targetJob = jobs.find((j) => j.id === jobId);
    if (!targetJob) return;
    if (targetJob.status === "processing") {
      alert("Không thể thay đổi cấu hình khi tệp đang xử lý.");
      return;
    }
    const rawScript = targetJob.scriptContent || DEFAULT_SAMPLE_DIALOGUE_SCRIPT;
    const parseResult = parseDialogueScript(rawScript);
    const activeCharIds = new Set(parseResult.characters.map((c) => c.id));
    const prevDialogue = (targetJob.configOverrides as Record<string, any>)?.dialogue || {};
    const prevVoices = prevDialogue.characterVoices || {};
    const prevSpeeds = prevDialogue.characterSpeeds || {};
    const prevPitches = prevDialogue.characterPitches || {};

    const cleanedVoices: Record<string, string> = {};
    for (const [cId, vName] of Object.entries(prevVoices)) {
      if (activeCharIds.has(cId)) {
        cleanedVoices[cId] = vName as string;
      }
    }
    const cleanedSpeeds: Record<string, number> = {};
    for (const [cId, spd] of Object.entries(prevSpeeds)) {
      if (activeCharIds.has(cId)) {
        cleanedSpeeds[cId] = spd as number;
      }
    }
    const cleanedPitches: Record<string, number> = {};
    for (const [cId, ptch] of Object.entries(prevPitches)) {
      if (activeCharIds.has(cId)) {
        cleanedPitches[cId] = ptch as number;
      }
    }

    handleUpdateJobTaskConfig(jobId, "dialogue", {
      characterVoices: cleanedVoices,
      characterSpeeds: cleanedSpeeds,
      characterPitches: cleanedPitches,
    });
    setDraftCharacterVoices({ ...cleanedVoices });
    setDraftCharacterSpeeds({ ...cleanedSpeeds });
    setDraftCharacterPitches({ ...cleanedPitches });
    setNotification({
      id: `sync-script-${Date.now()}`,
      type: "success",
      message: `Đã đồng bộ lại kịch bản: nhận diện ${parseResult.characters.length} nhân vật.`,
    });
  };

  // Simulated Audio Playback Timer
  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;
    if (isPlayingPreview) {
      interval = setInterval(() => {
        setPreviewPlaybackTime((prev) => (prev >= 84 ? 0 : prev + 1));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlayingPreview]);

  // Simulated Queue Execution Loop (Runs queued jobs and transitions waiting -> processing -> completed)
  useEffect(() => {
    if (queueStatus !== "running") return;

    const interval = setInterval(() => {
      setJobs((prev) => {
        const processingIdx = prev.findIndex((j) => j.status === "processing");
        if (processingIdx !== -1) {
          const currentJob = prev[processingIdx];
          const nextProgress = Math.min(100, currentJob.progressPct + 20);

          if (nextProgress >= 100) {
            const jobWorking = getJobWorkingConfig(currentJob);
            const jobOutputDir = resolveJobOutputDir(currentJob, jobWorking, prev);
            const baseName = currentJob.fileName.replace(/\.[^/.]+$/, "");
            const audioExt = jobWorking.outputAudioFormat || "wav";
            const subExt = jobWorking.outputSubtitleFormat || "srt";

            const generatedAudio = (currentJob.selectedTasks.includes("dubbing") || currentJob.selectedTasks.includes("tts") || currentJob.selectedTasks.includes("dialogue"))
              ? `${jobOutputDir}/${baseName}_master.${audioExt}`
              : undefined;

            const generatedSubs: Array<{ path: string; label: string; cues: Array<{ time: string; text: string }> }> = [];
            if (currentJob.selectedTasks.includes("transcription")) {
              generatedSubs.push({
                path: `${jobOutputDir}/${baseName}_sub.${subExt}`,
                label: `Phụ đề gốc (.${subExt})`,
                cues: [{ time: "00:01.000 → 00:04.000", text: "Nội dung nhận diện tự động từ tệp nguồn." }],
              });
            }
            if (currentJob.selectedTasks.includes("translation")) {
              generatedSubs.push({
                path: `${jobOutputDir}/${baseName}_vi.${subExt}`,
                label: `Bản dịch Tiếng Việt (.${subExt})`,
                cues: [{ time: "00:01.000 → 00:04.000", text: "Bản dịch tự động tiếng Việt." }],
              });
            }

            const updatedJob: MockBatchJob = {
              ...currentJob,
              status: "completed",
              progressPct: 100,
              stepResults: Object.fromEntries(
                currentJob.selectedTasks.map((t) => [
                  t,
                  {
                    task: t,
                    status: "completed",
                    progressPct: 100,
                    outputArtifactPaths: t === "transcription"
                      ? [`${jobOutputDir}/${baseName}_sub.${subExt}`]
                      : t === "translation"
                      ? [`${jobOutputDir}/${baseName}_vi.${subExt}`]
                      : t === "dubbing" || t === "tts" || t === "dialogue"
                      ? [`${jobOutputDir}/${baseName}_master.${audioExt}`]
                      : [],
                  },
                ])
              ),
              outputArtifacts: currentJob.outputArtifacts || {
                ...(generatedAudio ? { audioPath: generatedAudio, audioDuration: 60 } : {}),
                ...(generatedSubs.length > 0 ? { subtitles: generatedSubs } : {}),
              },
            };

            // Synchronize completed BatchJob into unified History storage
            syncBatchJobToHistory(updatedJob);

            const waitingIdx = prev.findIndex(
              (j, idx) => idx !== processingIdx && j.stage === "queued" && j.status === "waiting"
            );

            if (waitingIdx !== -1) {
              const targetWaitingJob = prev[waitingIdx];
              const workingConfig = getJobWorkingConfig(targetWaitingJob);
              const updatedNextJob: MockBatchJob = {
                ...targetWaitingJob,
                status: "processing",
                progressPct: 10,
                effectiveConfigSnapshot: {
                  ...(targetWaitingJob.effectiveConfigSnapshot || {}),
                  ...workingConfig,
                  ...(workingConfig.dialogue ? {
                    dialogue: {
                      ...workingConfig.dialogue,
                      ...(workingConfig.dialogue.characterVoices ? { characterVoices: { ...workingConfig.dialogue.characterVoices } } : {}),
                    },
                  } : {}),
                },
              };
              return prev.map((j, idx) => {
                if (idx === processingIdx) return updatedJob;
                if (idx === waitingIdx) return updatedNextJob;
                return j;
              });
            } else {
              setQueueStatus("idle");
              return prev.map((j, idx) => (idx === processingIdx ? updatedJob : j));
            }
          } else {
            return prev.map((j, idx) =>
              idx === processingIdx ? { ...currentJob, progressPct: nextProgress } : j
            );
          }
        } else {
          const waitingIdx = prev.findIndex((j) => j.stage === "queued" && j.status === "waiting");
          if (waitingIdx !== -1) {
            const targetWaitingJob = prev[waitingIdx];
            const workingConfig = getJobWorkingConfig(targetWaitingJob);
            const updatedNextJob: MockBatchJob = {
              ...targetWaitingJob,
              status: "processing",
              progressPct: 10,
              effectiveConfigSnapshot: {
                ...(targetWaitingJob.effectiveConfigSnapshot || {}),
                ...workingConfig,
                ...(workingConfig.dialogue ? {
                  dialogue: {
                    ...workingConfig.dialogue,
                    ...(workingConfig.dialogue.characterVoices ? { characterVoices: { ...workingConfig.dialogue.characterVoices } } : {}),
                  },
                } : {}),
              },
            };
            return prev.map((j, idx) =>
              idx === waitingIdx ? updatedNextJob : j
            );
          } else {
            setQueueStatus("idle");
            return prev;
          }
        }
      });
    }, 1500);

    return () => clearInterval(interval);
  }, [queueStatus]);

  // UI Drawer / Modal States
  const [isGlobalModalOpen, setIsGlobalModalOpen] = useState(false);
  const [globalModalTab, setGlobalModalTab] = useState<"general" | "text" | "tts" | "dialogue" | "transcription" | "translation" | "dubbing">("general");
  const [isPronunciationModalOpen, setIsPronunciationModalOpen] = useState(false);
  const [globalPronunciationRules, setGlobalPronunciationRules] = useState<PronunciationRule[]>(() =>
    loadGlobalRules()
  );
  const [ttsPausesOpen, setTtsPausesOpen] = useState(false);
  const [dialoguePausesOpen, setDialoguePausesOpen] = useState(false);
  const [dubbingPausesOpen, setDubbingPausesOpen] = useState(false);
  const [activeDrawerJobId, setActiveDrawerJobId] = useState<string | null>(null);
  const [dialogueDrawerJobId, setDialogueDrawerJobId] = useState<string | null>(null);
  const [draftCharacterVoices, setDraftCharacterVoices] = useState<Record<string, string>>({});
  const [draftCharacterSpeeds, setDraftCharacterSpeeds] = useState<Record<string, number>>({});
  const [draftCharacterPitches, setDraftCharacterPitches] = useState<Record<string, number>>({});

  const handleOpenDialogueVoiceDrawer = (jobId: string) => {
    const target = jobs.find((j) => j.id === jobId);
    if (!target) return;
    setActiveDrawerJobId(null);
    setDialogueDrawerJobId(jobId);
    const existingDialogue = (target.configOverrides as Record<string, any>)?.dialogue || {};
    setDraftCharacterVoices({ ...(existingDialogue.characterVoices || {}) });
    setDraftCharacterSpeeds({ ...(existingDialogue.characterSpeeds || {}) });
    setDraftCharacterPitches({ ...(existingDialogue.characterPitches || {}) });
  };

  const handleCloseDialogueVoiceDrawer = () => {
    setDialogueDrawerJobId(null);
    setDraftCharacterVoices({});
    setDraftCharacterSpeeds({});
    setDraftCharacterPitches({});
  };

  // Global ESC key listener to close modals / drawers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (voiceModalTarget) {
          setVoiceModalTarget(null);
        } else if (dialogueDrawerJobId) {
          handleCloseDialogueVoiceDrawer();
        } else if (activeDrawerJobId) {
          setActiveDrawerJobId(null);
          setIsPlayingPreview(false);
        } else if (isGlobalModalOpen) {
          setIsGlobalModalOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [voiceModalTarget, dialogueDrawerJobId, activeDrawerJobId, isGlobalModalOpen]);

  const handleResetDialogueCustomVoices = (jobId: string) => {
    const target = jobs.find((j) => j.id === jobId);
    if (!target) return;
    if (target.status === "processing") {
      alert("Không thể thay đổi cấu hình khi tệp đang xử lý.");
      return;
    }
    setDraftCharacterVoices({});
    setDraftCharacterSpeeds({});
    setDraftCharacterPitches({});

    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const currentOverrides = j.configOverrides || {};
        const currentDialogue = (currentOverrides.dialogue || {}) as Record<string, any>;
        const { characterVoices: _removed, characterSpeeds: _rs, characterPitches: _rp, ...restDialogue } = currentDialogue;
        const hasRemainingDialogue = Object.keys(restDialogue).length > 0;

        const newOverrides: BatchTaskConfigOverrides = {
          ...currentOverrides,
          dialogue: hasRemainingDialogue ? restDialogue : undefined,
        };

        const updatedJob: MockBatchJob = {
          ...j,
          configOverrides: newOverrides,
        };
        updatedJob.hasCustomConfig = isJobCustomConfigured(updatedJob);
        const diff = computeJobConfigDiff(updatedJob);
        return {
          ...updatedJob,
          configChanged: diff.isConfigChanged,
          invalidatedFromStep: diff.invalidatedFromStep,
        };
      })
    );

    setNotification({
      id: `reset-dialogue-${Date.now()}`,
      type: "info",
      message: "Đã khôi phục các nhân vật về mặc định.",
    });
  };

  const handleApplyDialogueCustomVoices = (jobId: string) => {
    const target = jobs.find((j) => j.id === jobId);
    if (!target) return;
    if (target.status === "processing") {
      alert("Không thể thay đổi cấu hình khi tệp đang xử lý.");
      return;
    }

    const cleanedVoices: Record<string, string> = {};
    for (const [charId, vName] of Object.entries(draftCharacterVoices)) {
      if (typeof vName === "string" && vName.trim().length > 0) {
        cleanedVoices[charId] = vName.trim();
      }
    }

    const cleanedSpeeds: Record<string, number> = {};
    for (const [charId, spd] of Object.entries(draftCharacterSpeeds)) {
      if (typeof spd === "number" && Math.abs(spd - 1.0) > 0.01) {
        cleanedSpeeds[charId] = spd;
      }
    }

    const cleanedPitches: Record<string, number> = {};
    for (const [charId, ptch] of Object.entries(draftCharacterPitches)) {
      if (typeof ptch === "number" && Math.abs(ptch - 1.0) > 0.01) {
        cleanedPitches[charId] = ptch;
      }
    }

    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const currentOverrides = j.configOverrides || {};
        const currentDialogue = (currentOverrides.dialogue || {}) as Record<string, any>;

        const newDialogue: Record<string, any> = { ...currentDialogue };
        if (Object.keys(cleanedVoices).length > 0) {
          newDialogue.characterVoices = cleanedVoices;
        } else {
          delete newDialogue.characterVoices;
        }

        if (Object.keys(cleanedSpeeds).length > 0) {
          newDialogue.characterSpeeds = cleanedSpeeds;
        } else {
          delete newDialogue.characterSpeeds;
        }

        if (Object.keys(cleanedPitches).length > 0) {
          newDialogue.characterPitches = cleanedPitches;
        } else {
          delete newDialogue.characterPitches;
        }

        const hasRemainingDialogue = Object.keys(newDialogue).length > 0;

        const newOverrides: BatchTaskConfigOverrides = {
          ...currentOverrides,
          dialogue: hasRemainingDialogue ? newDialogue : undefined,
        };

        const updatedJob: MockBatchJob = {
          ...j,
          configOverrides: newOverrides,
        };
        updatedJob.hasCustomConfig = isJobCustomConfigured(updatedJob);
        const diff = computeJobConfigDiff(updatedJob);
        return {
          ...updatedJob,
          configChanged: diff.isConfigChanged,
          invalidatedFromStep: diff.invalidatedFromStep,
        };
      })
    );

    setDialogueDrawerJobId(null);
    setNotification({
      id: `apply-dialogue-${Date.now()}`,
      type: "success",
      message: `Đã lưu cấu hình giọng nhân vật cho "${target.fileName}".`,
    });
  };

  const handleOpenGlobalModal = () => {
    const saved = loadBatchOutputSettings();
    const storedTts = loadStoredTtsSettings();
    const storedSubtitles = loadSubtitleSettings();
    const storedDubbing = loadStoredDubbingSettings();
    const storedTranslation = loadTranslationSettings();
    const storedDialogue = loadStoredDialogueSettings();
    setGlobalDefaults((prev) => ({
      ...prev,
      saveInSourceFolder: saved.saveInSourceFolder,
      outputPath: saved.outputPath,
      collisionPolicy: saved.collisionPolicy,
      outputAudioFormat: saved.outputAudioFormat,
      outputSubtitleFormat: saved.outputSubtitleFormat,
      concurrency: saved.concurrency ?? 1,
      transcription: {
        ...prev.transcription,
        whisperModel: storedSubtitles.whisperModel || prev.transcription.whisperModel,
        audioLanguage: storedSubtitles.audioLanguage || prev.transcription.audioLanguage,
        speechSpeed: (String(storedSubtitles.speechSpeed) as "1.0" | "0.9" | "0.8") || prev.transcription.speechSpeed,
        processingSpeed: storedSubtitles.processingSpeed || prev.transcription.processingSpeed,
        aspectRatio: storedSubtitles.aspectRatio || prev.transcription.aspectRatio,
        maxLines: (storedSubtitles.maxLines === 1 ? 1 : 2),
        outputFormat: saved.outputSubtitleFormat,
      },
      tts: {
        ...prev.tts,
        speed: storedTts.speed,
        pitch: storedTts.pitch,
        volume: storedTts.volume,
        pauses: storedTts.pauses,
        concurrency: storedTts.concurrency,
        exportSrt: storedTts.exportSrt ?? false,
      },
      dubbing: {
        ...prev.dubbing,
        voice: storedDubbing.voice,
        ttsModel: storedDubbing.ttsModel,
        speed: storedDubbing.speed,
        pitch: storedDubbing.pitch,
        volume: storedDubbing.volume,
        pauses: storedDubbing.pauses,
        concurrency: storedDubbing.concurrency,
        autoFit: storedDubbing.autoFit,
      },
      dialogue: {
        ...prev.dialogue,
        model: storedDialogue.model,
        masterVolume: storedDialogue.masterVolume,
        pauses: storedDialogue.pauses,
        concurrency: storedDialogue.concurrency,
        exportSrt: storedDialogue.exportSrt,
        aspectRatio: storedSubtitles.aspectRatio || prev.dialogue.aspectRatio || "16:9",
        maxLines: (storedSubtitles.maxLines === 1 ? 1 : (prev.dialogue.maxLines === 1 ? 1 : 2)),
      },
      translation: {
        ...prev.translation,
        provider: storedTranslation.translationProviderId || prev.translation.provider,
        sourceLanguage: storedTranslation.sourceLanguage || prev.translation.sourceLanguage,
        targetLanguage: storedTranslation.targetLanguage || prev.translation.targetLanguage,
        style: (storedTranslation.translationStyle as "default" | "cinema") || prev.translation.style,
      },
    }));
    setIsGlobalModalOpen(true);
  };

  const handleUpdateGlobalTranscription = (
    patch: Partial<BatchGlobalDefaults["transcription"]>
  ) => {
    setGlobalDefaults((prev) => ({
      ...prev,
      transcription: {
        ...prev.transcription,
        ...patch,
      },
    }));
    const subtitlePatch: any = {};
    if (patch.whisperModel !== undefined) subtitlePatch.whisperModel = patch.whisperModel;
    if (patch.audioLanguage !== undefined) subtitlePatch.audioLanguage = patch.audioLanguage;
    if (patch.speechSpeed !== undefined) subtitlePatch.speechSpeed = Number(patch.speechSpeed) as SubtitleSpeechSpeed;
    if (patch.processingSpeed !== undefined) subtitlePatch.processingSpeed = patch.processingSpeed;
    if (patch.aspectRatio !== undefined) subtitlePatch.aspectRatio = patch.aspectRatio;
    if (patch.maxLines !== undefined) subtitlePatch.maxLines = patch.maxLines;
    if (Object.keys(subtitlePatch).length > 0) {
      saveSubtitleSettings(subtitlePatch);
    }
  };

  const handleUpdateGlobalDubbing = (
    patch: Partial<BatchGlobalDefaults["dubbing"]>
  ) => {
    setGlobalDefaults((prev) => ({
      ...prev,
      dubbing: {
        ...prev.dubbing,
        ...patch,
      },
    }));
    saveStoredDubbingSettings(patch);
  };

  const handleUpdateGlobalTranslation = (
    patch: Partial<BatchGlobalDefaults["translation"]>
  ) => {
    setGlobalDefaults((prev) => {
      const next = {
        ...prev,
        translation: {
          ...prev.translation,
          ...patch,
        },
      };
      if (patch.style === "cinema") {
        const prov = patch.provider || next.translation.provider;
        if (prov === "google") {
          const supported = allTranslationProviders.filter((p) => p.type !== "google");
          if (supported.length > 0) {
            next.translation.provider = supported[0].id;
          }
        }
      }
      return next;
    });

    const translationPatch: any = {};
    if (patch.provider !== undefined) translationPatch.translationProviderId = patch.provider;
    if (patch.sourceLanguage !== undefined) translationPatch.sourceLanguage = patch.sourceLanguage;
    if (patch.targetLanguage !== undefined) translationPatch.targetLanguage = patch.targetLanguage;
    if (patch.style !== undefined) {
      translationPatch.translationStyle = patch.style;
      if (patch.style === "cinema" && (globalDefaults.translation.provider === "google" || patch.provider === "google")) {
        const supported = allTranslationProviders.filter((p) => p.type !== "google");
        if (supported.length > 0) {
          translationPatch.translationProviderId = supported[0].id;
        }
      }
    }
    if (Object.keys(translationPatch).length > 0) {
      saveTranslationSettings(translationPatch);
    }
  };

  const handleUpdateGlobalDialogue = (
    patch: Partial<BatchGlobalDefaults["dialogue"]>
  ) => {
    setGlobalDefaults((prev) => ({
      ...prev,
      dialogue: {
        ...prev.dialogue,
        ...patch,
      },
    }));

    // Dialogue settings persistence (2-way sync with Dialogue workspace)
    const dialoguePatch: Partial<DialogueGlobalSettings> = {};
    if (patch.model !== undefined) dialoguePatch.model = patch.model;
    if (patch.masterVolume !== undefined) dialoguePatch.masterVolume = patch.masterVolume;
    if (patch.pauses !== undefined) dialoguePatch.pauses = patch.pauses;
    if (patch.concurrency !== undefined) dialoguePatch.concurrency = patch.concurrency;
    if (patch.exportSrt !== undefined) dialoguePatch.exportSrt = patch.exportSrt;
    if (Object.keys(dialoguePatch).length > 0) {
      saveStoredDialogueSettings(dialoguePatch);
    }

    // Subtitle settings persistence (aspectRatio, maxLines)
    const subtitlePatch: Partial<{ aspectRatio: SubtitleAspectRatio; maxLines: SubtitleMaxLines }> = {};
    if (patch.aspectRatio !== undefined) subtitlePatch.aspectRatio = patch.aspectRatio;
    if (patch.maxLines !== undefined) subtitlePatch.maxLines = patch.maxLines;
    if (Object.keys(subtitlePatch).length > 0) {
      saveSubtitleSettings(subtitlePatch);
    }
  };

  const handleResetGlobalDialogue = () => {
    handleUpdateGlobalDialogue({
      masterVolume: DEFAULT_DIALOGUE_SETTINGS.masterVolume,
      pauses: { ...DEFAULT_DIALOGUE_SETTINGS.pauses },
      concurrency: DEFAULT_DIALOGUE_SETTINGS.concurrency,
      exportSrt: DEFAULT_DIALOGUE_SETTINGS.exportSrt,
    });
  };

  const handleToggleNormalizerGroup = (groupId: NormalizerGroupId) => {
    setGlobalDefaults((prev) => {
      const current = prev.text?.enabledGroupIds ?? loadSavedGroupIds();
      const next = current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId];
      saveGroupIds(next);
      return {
        ...prev,
        text: {
          autoNormalize: prev.text?.autoNormalize ?? true,
          enabledGroupIds: next,
          applyPronunciation: next.includes("pronunciation"),
        },
      };
    });
  };

  const handleToggleAutoNormalize = () => {
    setGlobalDefaults((prev) => ({
      ...prev,
      text: {
        autoNormalize: !(prev.text?.autoNormalize ?? true),
        enabledGroupIds: prev.text?.enabledGroupIds ?? loadSavedGroupIds(),
        applyPronunciation: prev.text?.applyPronunciation ?? true,
      },
    }));
  };

  const handleToggleApplyPronunciation = () => {
    setGlobalDefaults((prev) => {
      const nextVal = !(prev.text?.applyPronunciation ?? true);
      const current = prev.text?.enabledGroupIds ?? loadSavedGroupIds();
      const nextGroups = nextVal
        ? (current.includes("pronunciation") ? current : [...current, "pronunciation" as NormalizerGroupId])
        : current.filter((id) => id !== "pronunciation");
      saveGroupIds(nextGroups);
      return {
        ...prev,
        text: {
          autoNormalize: prev.text?.autoNormalize ?? true,
          enabledGroupIds: nextGroups,
          applyPronunciation: nextVal,
        },
      };
    });
  };

  const handleResetCurrentTab = () => {
    switch (globalModalTab) {
      case "general":
        setGlobalDefaults((prev) => ({
          ...prev,
          saveInSourceFolder: DEFAULT_GLOBAL_SETTINGS.saveInSourceFolder,
          outputPath: DEFAULT_GLOBAL_SETTINGS.outputPath,
          collisionPolicy: DEFAULT_GLOBAL_SETTINGS.collisionPolicy,
          outputAudioFormat: DEFAULT_GLOBAL_SETTINGS.outputAudioFormat,
          outputSubtitleFormat: DEFAULT_GLOBAL_SETTINGS.outputSubtitleFormat,
          concurrency: DEFAULT_GLOBAL_SETTINGS.concurrency ?? 1,
        }));
        saveBatchOutputSettings({
          saveInSourceFolder: DEFAULT_GLOBAL_SETTINGS.saveInSourceFolder,
          outputPath: DEFAULT_GLOBAL_SETTINGS.outputPath,
          collisionPolicy: DEFAULT_GLOBAL_SETTINGS.collisionPolicy,
          outputAudioFormat: DEFAULT_GLOBAL_SETTINGS.outputAudioFormat,
          outputSubtitleFormat: DEFAULT_GLOBAL_SETTINGS.outputSubtitleFormat,
          concurrency: DEFAULT_GLOBAL_SETTINGS.concurrency ?? 1,
        });
        break;
      case "text":
        const defGroups = getDefaultEnabledGroupIds();
        saveGroupIds([...defGroups, "pronunciation"]);
        setGlobalDefaults((prev) => ({
          ...prev,
          text: {
            autoNormalize: true,
            enabledGroupIds: [...defGroups, "pronunciation"],
            applyPronunciation: true,
          },
        }));
        setGlobalPronunciationRules(loadGlobalRules());
        setNotification({
          id: `reset-text-${Date.now()}`,
          type: "info",
          message: "Đã đặt lại cấu hình chuẩn hóa văn bản & phát âm về mặc định.",
        });
        break;
      case "tts":
        setGlobalDefaults((prev) => ({
          ...prev,
          tts: {
            ...prev.tts,
            speed: 1.0,
            pitch: 1.0,
            volume: 1.0,
            pauses: { ...DEFAULT_GLOBAL_SETTINGS.tts.pauses },
            concurrency: 1,
            exportSrt: false,
          },
        }));
        saveStoredTtsSettings({
          speed: 1.0,
          pitch: 1.0,
          volume: 1.0,
          pauses: { ...DEFAULT_GLOBAL_SETTINGS.tts.pauses },
          concurrency: 1,
          exportSrt: false,
        });
        break;
      case "dialogue":
        handleResetGlobalDialogue();
        break;
      case "transcription":
        handleUpdateGlobalTranscription({
          whisperModel: "large-v3-turbo",
          audioLanguage: "auto",
          speechSpeed: "1.0",
          processingSpeed: "auto",
          aspectRatio: "16:9",
          maxLines: 1,
        });
        saveSubtitleSettings({
          whisperModel: "large-v3-turbo",
          audioLanguage: "auto",
          speechSpeed: 1.0,
          processingSpeed: "auto",
          aspectRatio: "16:9",
          maxLines: 1,
        });
        break;
      case "translation":
        handleUpdateGlobalTranslation({
          provider: "google",
          sourceLanguage: "auto",
          targetLanguage: "vi",
          style: "default",
        });
        break;
      case "dubbing":
        handleUpdateGlobalDubbing({
          voice: "Thảo Trinh (Hà Nội)",
          ttsModel: "Omni Voice",
          speed: 1.0,
          pitch: 1.0,
          volume: 1.0,
          pauses: {
            comma: 0.5,
            period: 0.5,
            questionExclamation: 1.0,
            colonSemicolon: 0.6,
          },
          concurrency: 1,
          autoFit: true,
        });
        break;
    }
  };

  // Search Query
  const [searchQuery, setSearchQuery] = useState("");

  // Drag and Drop & Upload File states
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Notification Toast for Dependency & Action Feedback
  const [notification, setNotification] = useState<{
    id: string;
    type: "info" | "warning" | "success";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => {
      setNotification(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [notification]);

  // Selected active drawer job
  const activeDrawerJob = useMemo(
    () => jobs.find((j) => j.id === activeDrawerJobId) || null,
    [jobs, activeDrawerJobId]
  );

  // Selected dialogue drawer job
  const dialogueDrawerJob = useMemo(
    () => jobs.find((j) => j.id === dialogueDrawerJobId) || null,
    [jobs, dialogueDrawerJobId]
  );

  // View counts
  const viewCounts = useMemo(() => {
    const list = jobs.length; // Tất cả các tệp trong dự án luôn được giữ nguyên trong tab Danh sách
    const queued = jobs.filter((j) => j.stage === "queued" && (j.status === "waiting" || j.status === "processing" || j.status === "paused")).length;
    const processing = jobs.filter((j) => j.status === "processing").length;
    const completed = jobs.filter((j) => j.status === "completed" || j.status === "completed_with_warning").length;
    const failed = jobs.filter((j) => j.status === "failed" || j.status === "failed_with_artifact" || j.status === "cancelled" || j.status === "interrupted").length;
    return { list, queued, processing, completed, failed };
  }, [jobs]);

  // Filtered jobs according to active view & search
  const filteredJobs = useMemo(() => {
    let result = [...jobs];

    if (activeView === "list") {
      // Tab Danh sách luôn giữ nguyên tất cả các tệp, chỉ hiển thị trạng thái vị trí (Hàng đợi, Đang xử lý, Hoàn tất...)
    } else if (activeView === "queued") {
      result = result.filter((j) => j.stage === "queued" && (j.status === "waiting" || j.status === "processing" || j.status === "paused"));
      // Processing or active paused pinned first, then sorted by queueOrder
      result.sort((a, b) => {
        if (a.status === "processing" || (a.status === "paused" && a.progressPct > 0)) return -1;
        if (b.status === "processing" || (b.status === "paused" && b.progressPct > 0)) return 1;
        return a.queueOrder - b.queueOrder;
      });
    } else if (activeView === "completed") {
      result = result.filter((j) => j.status === "completed" || j.status === "completed_with_warning");
    } else if (activeView === "failed") {
      result = result.filter((j) => j.status === "failed" || j.status === "failed_with_artifact" || j.status === "cancelled" || j.status === "interrupted");
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((j) => j.fileName.toLowerCase().includes(q) || j.filePath.toLowerCase().includes(q));
    }

    return result;
  }, [jobs, activeView, searchQuery]);

  // Queue Statistics (for Bottom Bar)
  const stats = useMemo(() => {
    const total = jobs.length;
    const completed = jobs.filter((j) => j.status === "completed" || j.status === "completed_with_warning").length;
    const failed = jobs.filter((j) => j.status === "failed" || j.status === "failed_with_artifact" || j.status === "cancelled").length;
    const processing = jobs.filter((j) => j.status === "processing" || j.status === "paused").length;
    const waiting = jobs.filter((j) => j.status === "waiting").length;
    const overallProgress = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, failed, processing, waiting, overallProgress };
  }, [jobs]);

  // Tri-State Header Checkbox Calculations
  const visibleJobIds = useMemo(() => filteredJobs.map((j) => j.id), [filteredJobs]);
  const selectedVisibleCount = useMemo(
    () => visibleJobIds.filter((id) => selectedJobIds.has(id)).length,
    [visibleJobIds, selectedJobIds]
  );
  const isAllVisibleSelected = visibleJobIds.length > 0 && selectedVisibleCount === visibleJobIds.length;
  const isIndeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleJobIds.length;

  const handleToggleSelectRow = (jobId: string) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  const handleToggleSelectAllVisible = () => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (isAllVisibleSelected) {
        visibleJobIds.forEach((id) => next.delete(id));
      } else {
        visibleJobIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  // Stage to Queue Action (Tab Danh sách)
  const handleStageToQueue = () => {
    const selectedEligibleJobs = jobs.filter((j) => selectedJobIds.has(j.id) && j.status !== "processing");
    if (selectedEligibleJobs.length === 0) return;

    const validJobs = selectedEligibleJobs.filter((j) => j.selectedTasks.length > 0);
    if (validJobs.length === 0) {
      alert("Vui lòng chọn ít nhất 1 tác vụ cho các tệp trước khi chuyển sang hàng đợi.");
      return;
    }

    const currentMaxOrder = jobs.reduce((max, j) => Math.max(max, j.queueOrder || 0), 0);

    setJobs((prev) => {
      let orderIncrement = 1;
      return prev.map((j) => {
        if (selectedJobIds.has(j.id) && j.selectedTasks.length > 0 && j.status !== "processing") {
          const newOrder = currentMaxOrder + orderIncrement++;
          return {
            ...j,
            stage: "queued",
            status: "waiting",
            queueOrder: newOrder,
          };
        }
        return j;
      });
    });

    setSelectedJobIds(new Set());
    setNotification({
      id: `staged-${Date.now()}`,
      type: "success",
      message: `Đã chuyển ${validJobs.length} tệp sang Hàng đợi thành công.`,
    });
  };

  // Remove from Queue (Back to Staging)
  const handleRemoveFromQueue = (jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, stage: "staging", status: "waiting" } : j))
    );
    setNotification({
      id: `unstage-${Date.now()}`,
      type: "info",
      message: "Đã chuyển tệp về lại tab Danh sách.",
    });
  };

  // Helper to construct a Batch Job from a dropped or selected File
  const createBatchJobFromFile = (
    file: File,
    relativePath?: string,
    scriptContent?: string,
    hasDialogueStructure: boolean = false
  ): MockBatchJob | null => {
    const fileName = file.name;
    const ext = fileName.toLowerCase().split(".").pop() || "";
    let fileKind: BatchFileKind;
    if (["txt", "docx"].includes(ext)) {
      fileKind = "text";
    } else if (["srt", "vtt"].includes(ext)) {
      fileKind = "subtitle";
    } else if (["mp3", "wav", "m4a", "aac", "flac", "mp4", "mov", "mkv", "avi", "webm"].includes(ext)) {
      fileKind = "media";
    } else {
      return null;
    }

    let fileSizeStr = `${(file.size / 1024).toFixed(1)} KB`;
    if (file.size > 1024 * 1024) {
      fileSizeStr = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    }

    const selectedTasks: BatchTaskType[] =
      fileKind === "text"
        ? hasDialogueStructure ? ["dialogue"] : ["tts"]
        : fileKind === "subtitle"
        ? ["translation"]
        : ["transcription"];

    const stepResults: Partial<Record<BatchTaskType, MockStepResult>> = {};
    selectedTasks.forEach((t) => {
      stepResults[t] = { task: t, status: "waiting", progressPct: 0 };
    });

    return {
      id: `job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      fileName,
      filePath: relativePath || (file as any).path || `D:/BatchUploads/${fileName}`,
      fileSize: fileSizeStr,
      fileKind,
      hasDialogueStructure,
      scriptContent,
      stage: "staging",
      queueOrder: 0,
      selectedTasks,
      executionSequence: [...selectedTasks],
      stepResults,
      status: "waiting",
      progressPct: 0,
    };
  };

  const handleAddFilesList = async (files: File[]) => {
    const newJobs: MockBatchJob[] = [];
    for (const file of files) {
      let scriptContent: string | undefined = undefined;
      let hasDialogue = false;
      const fileName = file.name;
      const ext = fileName.toLowerCase().split(".").pop() || "";
      if (["txt", "docx"].includes(ext)) {
        try {
          scriptContent = await file.text();
          const detection = detectDialogueScript(scriptContent);
          hasDialogue = detection.isDialogue;
          if (detection.confidence === "ambiguous" && detection.warning) {
            setNotification({
              id: `script-warn-${Date.now()}`,
              type: "warning",
              message: `Tệp "${fileName}": ${detection.warning}`,
            });
          }
        } catch {
          hasDialogue = false;
        }
      }
      const job = createBatchJobFromFile(file, (file as any).webkitRelativePath, scriptContent, hasDialogue);
      if (job) {
        newJobs.push(job);
      }
    }

    if (newJobs.length > 0) {
      setJobs((prev) => [...newJobs, ...prev]);
      setActiveView("list");
      setNotification({
        id: `add-files-${Date.now()}`,
        type: "success",
        message: `Đã nạp ${newJobs.length} tệp vào tab Danh sách thành công.`,
      });
    } else if (files.length > 0) {
      alert("Không tìm thấy tệp hợp lệ (.mp3, .wav, .mp4, .txt, .docx, .srt, .vtt) trong các mục đã nạp.");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const collectedFiles = await extractFilesFromDropEvent(e);
    if (collectedFiles.length > 0) {
      handleAddFilesList(collectedFiles);
    }
  };

  // Move Job up/down in Queue
  const handleMoveQueueJob = (jobId: string, direction: "up" | "down") => {
    setJobs((prev) => {
      const queuedWaiting = prev
        .filter((j) => j.stage === "queued" && j.status === "waiting")
        .sort((a, b) => a.queueOrder - b.queueOrder);
      const idx = queuedWaiting.findIndex((j) => j.id === jobId);
      if (idx === -1) return prev;
      if (direction === "up" && idx === 0) return prev;
      if (direction === "down" && idx === queuedWaiting.length - 1) return prev;

      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      const current = queuedWaiting[idx];
      const target = queuedWaiting[swapIdx];

      return prev.map((j) => {
        if (j.id === current.id) return { ...j, queueOrder: target.queueOrder };
        if (j.id === target.id) return { ...j, queueOrder: current.queueOrder };
        return j;
      });
    });
  };

  // Retry (old snapshot)
  const handleRetryJob = (jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id === jobId) {
          return {
            ...j,
            status: "waiting",
            progressPct: j.status === "failed_with_artifact" ? j.progressPct : 0,
          };
        }
        return j;
      })
    );
    setNotification({
      id: `retry-${Date.now()}`,
      type: "info",
      message: "Thử lại: Tái sử dụng cấu hình cũ, tiếp tục từ bước bị lỗi gần nhất.",
    });
  };

  // Regenerate (new snapshot based on Invalidation Graph)
  const handleRegenerateJob = (jobId: string, fromStepOverride?: BatchTaskType) => {
    const target = jobs.find((j) => j.id === jobId);
    if (!target) return;
    const diff = computeJobConfigDiff(target);
    const fromStep = fromStepOverride || diff.invalidatedFromStep || target.retryFromStep || "transcription";
    const working = getJobWorkingConfig(target);

    setJobs((prev) =>
      prev.map((j) => {
        if (j.id === jobId) {
          return {
            ...j,
            status: "waiting",
            effectiveConfigSnapshot: {
              ...j.effectiveConfigSnapshot,
              ...working,
            },
            configOverrides: {},
            hasCustomConfig: false,
            configChanged: false,
            invalidatedFromStep: undefined,
            progressPct: fromStep === "dubbing" ? 70 : fromStep === "translation" ? 35 : 0,
          };
        }
        return j;
      })
    );
    setNotification({
      id: `regen-${Date.now()}`,
      type: "success",
      message: `Tạo lại: Áp dụng Config Invalidation Graph từ bước [${fromStep}], bảo toàn artifact đã commit cũ trên đĩa.`,
    });
  };

  // Re-export job (Output config changed only - Reuses valid artifacts, 0 AI calls)
  const handleReExportJob = (jobId: string) => {
    const target = jobs.find((j) => j.id === jobId);
    if (!target) return;
    const working = getJobWorkingConfig(target);
    const newOutputDir = resolveJobOutputDir(target, working, jobs);
    const audioExt = working.outputAudioFormat || "wav";
    const subExt = working.outputSubtitleFormat || "srt";

    setJobs((prev) =>
      prev.map((j) => {
        if (j.id === jobId) {
          const updatedArtifacts = {
            ...j.outputArtifacts,
            subtitles: j.outputArtifacts?.subtitles?.map((s) => {
              const fileNameWithExt = s.path.split("/").pop() || "";
              const base = fileNameWithExt.replace(/\.[^/.]+$/, "");
              return {
                ...s,
                path: `${newOutputDir}/${base}.${subExt}`,
                label: s.label.replace(/\(\.[a-z0-9]+\)/i, `(.${subExt})`),
              };
            }),
            audioPath: j.outputArtifacts?.audioPath
              ? (() => {
                  const base = (j.outputArtifacts.audioPath.split("/").pop() || "").replace(/\.[^/.]+$/, "");
                  return `${newOutputDir}/${base}.${audioExt}`;
                })()
              : undefined,
          };
          return {
            ...j,
            status: "completed" as BatchJobStatus,
            progressPct: 100,
            outputArtifacts: updatedArtifacts,
            effectiveConfigSnapshot: {
              ...(j.effectiveConfigSnapshot as any),
              outputPath: working.outputPath,
              saveInSourceFolder: working.saveInSourceFolder,
              collisionPolicy: working.collisionPolicy,
              outputAudioFormat: working.outputAudioFormat,
              outputSubtitleFormat: working.outputSubtitleFormat,
            },
            configOverrides: {},
            hasCustomConfig: false,
            configChanged: false,
            invalidatedFromStep: undefined,
          };
        }
        return j;
      })
    );

    setNotification({
      id: `reexport-${Date.now()}`,
      type: "success",
      message: `Xuất lại thành công: Tái sử dụng toàn bộ artifact đã tạo, xuất sang "${newOutputDir}" mà không gọi lại AI.`,
    });
  };

  // Update per-job task override
  const handleUpdateJobTaskConfig = (
    jobId: string,
    task: BatchTaskType,
    patch: Record<string, unknown>
  ) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const currentTaskOverrides = ((j.configOverrides as Record<string, any>)?.[task] || {});
        const updatedTaskOverrides = { ...currentTaskOverrides, ...patch };
        const newOverrides: BatchTaskConfigOverrides = {
          ...(j.configOverrides || {}),
          [task]: updatedTaskOverrides,
        };
        const updatedJob: MockBatchJob = {
          ...j,
          hasCustomConfig: true,
          configOverrides: newOverrides,
        };
        const diff = computeJobConfigDiff(updatedJob);
        return {
          ...updatedJob,
          configChanged: diff.isConfigChanged,
          invalidatedFromStep: diff.invalidatedFromStep,
        };
      })
    );
  };

  // Update per-job output setting override
  const handleUpdateJobOutputConfig = (
    jobId: string,
    patch: Partial<BatchTaskConfigOverrides>
  ) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const newOverrides: BatchTaskConfigOverrides = {
          ...(j.configOverrides || {}),
          ...patch,
        };
        const updatedJob: MockBatchJob = {
          ...j,
          hasCustomConfig: true,
          configOverrides: newOverrides,
        };
        const diff = computeJobConfigDiff(updatedJob);
        return {
          ...updatedJob,
          configChanged: diff.isConfigChanged,
          invalidatedFromStep: diff.invalidatedFromStep,
        };
      })
    );
  };

  // Restore job to its frozen snapshot (reverts all overrides)
  const handleRestoreJobToSnapshot = (jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const updatedJob: MockBatchJob = {
          ...j,
          hasCustomConfig: false,
          configOverrides: {},
        };
        const diff = computeJobConfigDiff(updatedJob);
        return {
          ...updatedJob,
          configChanged: diff.isConfigChanged,
          invalidatedFromStep: diff.invalidatedFromStep,
        };
      })
    );

    const targetJob = jobs.find((j) => j.id === jobId);
    if (targetJob) {
      setNotification({
        id: `restore-snapshot-${Date.now()}`,
        type: "info",
        message: `Đã khôi phục cấu hình về khớp hoàn toàn với Snapshot lúc chạy ➔ Nút CTA đã hoàn nguyên về [Thử lại].`,
      });
    }
  };


  // Open Preview Drawer
  const handleOpenPreview = (jobId: string) => {
    setActiveDrawerJobId(jobId);
    setActiveDrawerTab("preview");
    setIsPlayingPreview(false);
    setPreviewPlaybackTime(0);
  };

  // ==========================================
  // Task Compatibility & Interactive Rules
  // ==========================================

  // Deterministic execution sequence resolver based on DAG
  const computeExecutionSequence = (
    fileKind: MockBatchJob["fileKind"],
    tasks: BatchTaskType[]
  ): BatchTaskType[] => {
    const seq: BatchTaskType[] = [];
    if (fileKind === "text") {
      if (tasks.includes("tts")) seq.push("tts");
      if (tasks.includes("dialogue")) seq.push("dialogue");
      if (tasks.includes("transcription")) seq.push("transcription");
      if (tasks.includes("translation")) seq.push("translation");
      if (tasks.includes("dubbing")) seq.push("dubbing");
    } else if (fileKind === "media") {
      if (tasks.includes("transcription")) seq.push("transcription");
      if (tasks.includes("translation")) seq.push("translation");
      if (tasks.includes("dubbing")) seq.push("dubbing");
    } else if (fileKind === "subtitle") {
      if (tasks.includes("translation")) seq.push("translation");
      if (tasks.includes("dubbing")) seq.push("dubbing");
    }
    return seq;
  };

  const getTaskCompatibility = (job: MockBatchJob, task: BatchTaskType) => {
    if (task === "tts") {
      if (job.fileKind !== "text") return { compatible: false, reason: "TTS chỉ hỗ trợ tệp văn bản thường (.txt, .docx)" };
      if (job.hasDialogueStructure) return { compatible: false, reason: "Tệp là kịch bản hội thoại (đã khóa TTS, sử dụng tác vụ Hội thoại)" };
      return { compatible: true };
    }
    if (task === "dialogue") {
      if (job.fileKind !== "text") return { compatible: false, reason: "Hội thoại chỉ hỗ trợ tệp kịch bản (.txt, .docx)" };
      if (!job.hasDialogueStructure) return { compatible: false, reason: "Tệp là văn bản thường, không có cấu trúc phân vai hợp lệ [Tên]: Lời thoại" };
      return { compatible: true };
    }
    if (task === "transcription") {
      if (job.fileKind === "subtitle") return { compatible: false, reason: "Tệp đã là định dạng phụ đề (.srt, .vtt), không cần ASR" };
      return { compatible: true };
    }
    if (task === "translation") {
      return { compatible: true };
    }
    if (task === "dubbing") {
      return { compatible: true };
    }
    return { compatible: true };
  };

  // File icon renderer
  const renderFileIcon = (fileKind: MockBatchJob["fileKind"]) => {
    switch (fileKind) {
      case "text":
        return <FileText className="w-4 h-4 text-purple-400 shrink-0" />;
      case "media":
        return <Video className="w-4 h-4 text-sky-400 shrink-0" />;
      case "subtitle":
        return <FileCode className="w-4 h-4 text-amber-400 shrink-0" />;
      default:
        return <FileCode className="w-4 h-4 text-textMuted shrink-0" />;
    }
  };

  // Toggle single task on a job with prerequisite dependency resolver
  const handleToggleTask = (jobId: string, task: BatchTaskType) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const exists = j.selectedTasks.includes(task);

        // Guard unchecking prerequisite tasks when downstream tasks depend on them
        if (exists) {
          if (task === "tts" || task === "dialogue") {
            const hasDownstream = j.selectedTasks.some((t) => ["transcription", "translation", "dubbing"].includes(t));
            if (hasDownstream) {
              setNotification({
                id: `prereq-block-${Date.now()}`,
                type: "warning",
                message: `Không thể tắt ${task === "tts" ? "TTS" : "Hội thoại"} cho "${j.fileName}" vì các tác vụ Phụ đề / Dịch / Lồng tiếng đang phụ thuộc vào âm thanh nền tảng. Vui lòng tắt các tác vụ này trước.`,
              });
              return j;
            }
          }

          if (task === "transcription") {
            const hasDownstream = j.selectedTasks.some((t) => ["translation", "dubbing"].includes(t));
            if (hasDownstream) {
              setNotification({
                id: `prereq-block-${Date.now()}`,
                type: "warning",
                message: `Không thể tắt Phụ đề cho "${j.fileName}" vì Dịch thuật / Lồng tiếng đang phụ thuộc vào timeline phụ đề. Vui lòng tắt Dịch / Lồng tiếng trước.`,
              });
              return j;
            }
          }

          if (task === "translation") {
            if (j.selectedTasks.includes("dubbing")) {
              setNotification({
                id: `prereq-block-${Date.now()}`,
                type: "warning",
                message: `Không thể tắt Dịch thuật cho "${j.fileName}" vì tác vụ Lồng tiếng đang sử dụng bản dịch phụ đề. Vui lòng tắt Lồng tiếng trước.`,
              });
              return j;
            }
          }

          const updated = j.selectedTasks.filter((t) => t !== task);
          const seq = computeExecutionSequence(j.fileKind, updated);
          return {
            ...j,
            selectedTasks: updated,
            executionSequence: seq,
          };
        }

        // Turning ON task: apply mutual exclusion & auto-enable prerequisites
        let updated = [...j.selectedTasks, task];

        // Rule 1: TTS vs Dialogue strictly mutually exclusive
        if (task === "tts") {
          updated = updated.filter((t) => t !== "dialogue");
        } else if (task === "dialogue") {
          updated = updated.filter((t) => t !== "tts");
        }

        // Rule 2: Auto-enable prerequisites based on pipeline
        if (j.fileKind === "media") {
          if (task === "translation" && !updated.includes("transcription")) {
            updated.push("transcription");
            setNotification({
              id: `auto-prereq-${Date.now()}`,
              type: "info",
              message: `Đã tự động bật Phụ đề (ASR) cho "${j.fileName}" vì Dịch cần dữ liệu phụ đề.`,
            });
          }
          if (task === "dubbing") {
            const autoNotes: string[] = [];
            if (!updated.includes("transcription")) {
              updated.push("transcription");
              autoNotes.push("Phụ đề (ASR)");
            }
            if (!updated.includes("translation")) {
              updated.push("translation");
              autoNotes.push("Dịch thuật");
            }
            if (autoNotes.length > 0) {
              setNotification({
                id: `auto-prereq-${Date.now()}`,
                type: "info",
                message: `Đã tự động bật ${autoNotes.join(" và ")} cho "${j.fileName}" để phục vụ Lồng tiếng.`,
              });
            }
          }
        } else if (j.fileKind === "text") {
          const audioTask: BatchTaskType = j.hasDialogueStructure ? "dialogue" : "tts";
          const audioTaskName = j.hasDialogueStructure ? "Hội thoại" : "TTS";

          if (task === "transcription") {
            if (!updated.includes(audioTask)) {
              updated.push(audioTask);
              setNotification({
                id: `auto-prereq-${Date.now()}`,
                type: "info",
                message: `Đã tự động bật ${audioTaskName} cho "${j.fileName}" vì Phụ đề cần âm thanh nền tảng.`,
              });
            }
          } else if (task === "translation") {
            const autoNotes: string[] = [];
            if (!updated.includes(audioTask)) {
              updated.push(audioTask);
              autoNotes.push(audioTaskName);
            }
            if (!updated.includes("transcription")) {
              updated.push("transcription");
              autoNotes.push("Phụ đề");
            }
            if (autoNotes.length > 0) {
              setNotification({
                id: `auto-prereq-${Date.now()}`,
                type: "info",
                message: `Đã tự động bật ${autoNotes.join(" và ")} cho "${j.fileName}" làm tiền đề cho Dịch thuật.`,
              });
            }
          } else if (task === "dubbing") {
            const autoNotes: string[] = [];
            if (!updated.includes(audioTask)) {
              updated.push(audioTask);
              autoNotes.push(audioTaskName);
            }
            if (!updated.includes("transcription")) {
              updated.push("transcription");
              autoNotes.push("Phụ đề");
            }
            if (!updated.includes("translation")) {
              updated.push("translation");
              autoNotes.push("Dịch thuật");
            }
            if (autoNotes.length > 0) {
              setNotification({
                id: `auto-prereq-${Date.now()}`,
                type: "info",
                message: `Đã tự động bật ${autoNotes.join(", ")} cho "${j.fileName}" làm tiền đề cho Lồng tiếng.`,
              });
            }
          }
        } else if (j.fileKind === "subtitle") {
          if (task === "dubbing" && !updated.includes("translation")) {
            // Optional/Conditional translation
          }
        }

        const seq = computeExecutionSequence(j.fileKind, updated);
        return {
          ...j,
          selectedTasks: updated,
          executionSequence: seq,
        };
      })
    );
  };

  // Helper to compute task column bulk selection state
  const getTaskColumnState = (task: BatchTaskType) => {
    const compatibleJobs = filteredJobs.filter(
      (j) => j.status !== "processing" && getTaskCompatibility(j, task).compatible
    );
    if (compatibleJobs.length === 0) {
      return { compatibleCount: 0, selectedCount: 0, isAllSelected: false, isIndeterminate: false };
    }
    const selectedCount = compatibleJobs.filter((j) => j.selectedTasks.includes(task)).length;
    return {
      compatibleCount: compatibleJobs.length,
      selectedCount,
      isAllSelected: selectedCount === compatibleJobs.length,
      isIndeterminate: selectedCount > 0 && selectedCount < compatibleJobs.length,
    };
  };

  // Bi-directional toggle all for column header in Staging view
  const handleToggleAllTask = (task: BatchTaskType) => {
    const { isAllSelected, compatibleCount } = getTaskColumnState(task);
    if (compatibleCount === 0) return;

    if (isAllSelected) {
      // Deselect task for all compatible jobs - cascade deselect downstream tasks to keep chain valid
      setJobs((prev) =>
        prev.map((j) => {
          if (j.status === "processing") return j;
          const compat = getTaskCompatibility(j, task);
          if (!compat.compatible) return j;

          let updated = j.selectedTasks.filter((t) => t !== task);

          // If deselecting TTS or Dialogue on Text -> cascade deselect Subtitle, Translation, Dubbing
          if ((task === "tts" || task === "dialogue") && j.fileKind === "text") {
            updated = updated.filter((t) => t !== "transcription" && t !== "translation" && t !== "dubbing");
          }

          // If deselecting Transcription on Media or Text -> cascade deselect Translation, Dubbing
          if (task === "transcription") {
            updated = updated.filter((t) => t !== "translation" && t !== "dubbing");
          }

          // If deselecting Translation -> cascade deselect Dubbing
          if (task === "translation") {
            updated = updated.filter((t) => t !== "dubbing");
          }

          const seq = computeExecutionSequence(j.fileKind, updated);
          return {
            ...j,
            selectedTasks: updated,
            executionSequence: seq,
          };
        })
      );
    } else {
      // Select task for all compatible jobs
      setJobs((prev) =>
        prev.map((j) => {
          if (j.status === "processing") return j;
          const compat = getTaskCompatibility(j, task);
          if (!compat.compatible) return j;

          let updated = [...j.selectedTasks];
          if (!updated.includes(task)) {
            updated.push(task);
          }

          // Invariant: TTS vs Dialogue strictly mutually exclusive
          if (task === "tts") updated = updated.filter((t) => t !== "dialogue");
          if (task === "dialogue") updated = updated.filter((t) => t !== "tts");

          // Auto-enable prerequisites
          if (j.fileKind === "media") {
            if (task === "translation" && !updated.includes("transcription")) {
              updated.push("transcription");
            }
            if (task === "dubbing") {
              if (!updated.includes("transcription")) updated.push("transcription");
              if (!updated.includes("translation")) updated.push("translation");
            }
          } else if (j.fileKind === "text") {
            const audioTask: BatchTaskType = j.hasDialogueStructure ? "dialogue" : "tts";
            if (task === "transcription") {
              if (!updated.includes(audioTask)) updated.push(audioTask);
            }
            if (task === "translation") {
              if (!updated.includes(audioTask)) updated.push(audioTask);
              if (!updated.includes("transcription")) updated.push("transcription");
            }
            if (task === "dubbing") {
              if (!updated.includes(audioTask)) updated.push(audioTask);
              if (!updated.includes("transcription")) updated.push("transcription");
              if (!updated.includes("translation")) updated.push("translation");
            }
          }

          const seq = computeExecutionSequence(j.fileKind, updated);
          return {
            ...j,
            selectedTasks: updated,
            executionSequence: seq,
          };
        })
      );
    }
  };

  // Configuration for task column headers
  const TASK_HEADER_CONFIG: Record<
    BatchTaskType,
    {
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      colWidth: string;
      color: {
        text: string;
        accentClass: string;
      };
    }
  > = {
    tts: {
      label: "Text to Speech",
      icon: Mic,
      colWidth: "w-[11%]",
      color: {
        text: "text-accent",
        accentClass: "text-accent accent-accent",
      },
    },
    transcription: {
      label: "Phụ đề",
      icon: Subtitles,
      colWidth: "w-[9%]",
      color: {
        text: "text-amber-400",
        accentClass: "text-amber-400 accent-amber-400",
      },
    },
    translation: {
      label: "Dịch",
      icon: Languages,
      colWidth: "w-[9%]",
      color: {
        text: "text-sky-400",
        accentClass: "text-sky-400 accent-sky-400",
      },
    },
    dubbing: {
      label: "Lồng tiếng",
      icon: Film,
      colWidth: "w-[10%]",
      color: {
        text: "text-emerald-400",
        accentClass: "text-emerald-400 accent-emerald-400",
      },
    },
    dialogue: {
      label: "Hội thoại",
      icon: MessageSquare,
      colWidth: "w-[11%]",
      color: {
        text: "text-purple-400",
        accentClass: "text-purple-400 accent-purple-400",
      },
    },
  };

  const renderTaskColumnHeader = (task: BatchTaskType) => {
    const config = TASK_HEADER_CONFIG[task];
    const { isAllSelected, isIndeterminate, compatibleCount, selectedCount } = getTaskColumnState(task);
    const IconComp = config.icon;

    return (
      <th key={task} className={`py-2 px-1 ${config.colWidth} text-center border-r border-borderDefault select-none`}>
        <div className="flex flex-col items-center justify-center gap-1.5 min-h-[46px]">
          {/* Header Title with Icon */}
          <div className="flex items-center justify-center gap-1.5 font-bold text-textSecondary text-[13px] tracking-normal">
            <IconComp className={`w-3.5 h-3.5 ${config.color.text} shrink-0`} />
            <span className="truncate">{config.label}</span>
          </div>

          {/* Tri-state Native Checkbox (Exact same size and appearance as body checkboxes, no text) */}
          <div className="flex items-center justify-center">
            {task === "dialogue" ? (
              <div className="inline-flex items-center justify-center gap-1.5">
                <div className="w-4 h-4 flex items-center justify-center shrink-0">
                  <input
                    type="checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = isIndeterminate;
                    }}
                    checked={isAllSelected}
                    disabled={compatibleCount === 0}
                    onChange={() => handleToggleAllTask(task)}
                    className={`w-4 h-4 rounded border-borderDefault focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed ${config.color.accentClass}`}
                    title={
                      compatibleCount === 0
                        ? "Không có tệp tương thích với tác vụ này"
                        : isAllSelected
                        ? `Bỏ chọn ${config.label} cho tất cả (${compatibleCount} tệp)`
                        : `Bật ${config.label} cho tất cả tệp phù hợp (${selectedCount}/${compatibleCount})`
                    }
                  />
                </div>
                <div className="w-6 h-6 shrink-0" aria-hidden="true" />
              </div>
            ) : (
              <input
                type="checkbox"
                ref={(el) => {
                  if (el) el.indeterminate = isIndeterminate;
                }}
                checked={isAllSelected}
                disabled={compatibleCount === 0}
                onChange={() => handleToggleAllTask(task)}
                className={`w-4 h-4 rounded border-borderDefault focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed ${config.color.accentClass}`}
                title={
                  compatibleCount === 0
                    ? "Không có tệp tương thích với tác vụ này"
                    : isAllSelected
                    ? `Bỏ chọn ${config.label} cho tất cả (${compatibleCount} tệp)`
                    : `Bật ${config.label} cho tất cả tệp phù hợp (${selectedCount}/${compatibleCount})`
                }
              />
            )}
          </div>
        </div>
      </th>
    );
  };

  // Apply Global Defaults to Selected Jobs (Requires Selection)
  const handleApplyDefaultsToSelected = () => {
    if (selectedJobIds.size === 0) return;
    const targetIds = selectedJobIds;

    // Explicitly persist latest user output settings
    saveBatchOutputSettings({
      saveInSourceFolder: globalDefaults.saveInSourceFolder,
      outputPath: globalDefaults.outputPath,
      collisionPolicy: globalDefaults.collisionPolicy,
      outputAudioFormat: globalDefaults.outputAudioFormat,
      outputSubtitleFormat: globalDefaults.outputSubtitleFormat,
    });

    setJobs((prev) =>
      prev.map((j) => {
        if (targetIds.has(j.id)) {
          const prevCharVoices = (j.configOverrides as Record<string, any>)?.dialogue?.characterVoices || {};
          const prevCharSpeeds = (j.configOverrides as Record<string, any>)?.dialogue?.characterSpeeds || {};
          const prevCharPitches = (j.configOverrides as Record<string, any>)?.dialogue?.characterPitches || {};
          const appliedOverrides: BatchTaskConfigOverrides = {
            outputPath: globalDefaults.outputPath,
            saveInSourceFolder: globalDefaults.saveInSourceFolder,
            collisionPolicy: globalDefaults.collisionPolicy,
            outputAudioFormat: globalDefaults.outputAudioFormat,
            outputSubtitleFormat: globalDefaults.outputSubtitleFormat,
            concurrency: globalDefaults.concurrency ?? 1,
            ...(globalDefaults.text ? { text: { ...globalDefaults.text } } : {}),
            ...(j.selectedTasks.includes("tts") ? { tts: { ...globalDefaults.tts } } : {}),
            ...(j.selectedTasks.includes("dialogue") ? {
              dialogue: {
                ...globalDefaults.dialogue,
                ...(Object.keys(prevCharVoices).length > 0 ? { characterVoices: { ...prevCharVoices } } : {}),
                ...(Object.keys(prevCharSpeeds).length > 0 ? { characterSpeeds: { ...prevCharSpeeds } } : {}),
                ...(Object.keys(prevCharPitches).length > 0 ? { characterPitches: { ...prevCharPitches } } : {}),
              },
            } : {}),
            ...(j.selectedTasks.includes("transcription") ? { transcription: { ...globalDefaults.transcription } } : {}),
            ...(j.selectedTasks.includes("translation") ? { translation: { ...globalDefaults.translation } } : {}),
            ...(j.selectedTasks.includes("dubbing") ? { dubbing: { ...globalDefaults.dubbing } } : {}),
          };
          const updatedJob: MockBatchJob = {
            ...j,
            hasCustomConfig: true,
            configOverrides: appliedOverrides,
          };
          const diff = computeJobConfigDiff(updatedJob);
          return {
            ...updatedJob,
            configChanged: diff.isConfigChanged,
            invalidatedFromStep: diff.invalidatedFromStep,
          };
        }
        return j;
      })
    );

    setIsGlobalModalOpen(false);
    setNotification({
      id: `apply-defaults-${Date.now()}`,
      type: "success",
      message: `Đã áp dụng Cấu hình chung cho ${targetIds.size} tệp đã chọn. Bảng gán giọng nhân vật của từng kịch bản được bảo toàn.`,
    });
  };

  // Render job position / execution location status
  const renderJobLocationStatus = (job: MockBatchJob) => {
    if (job.stage === "staging") {
      return null; // Ở tab danh sách thôi thì không hiển thị gì
    }
    if (job.status === "processing") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent/15 text-accent border border-accent/30 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          <span>Đang xử lý</span>
        </span>
      );
    }
    if (job.status === "completed" || job.status === "completed_with_warning") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-success/10 text-success border border-success/20">
          <Check className="w-3 h-3" />
          <span>Hoàn tất</span>
        </span>
      );
    }
    if (job.status === "failed" || job.status === "failed_with_artifact") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-danger/10 text-danger border border-danger/20">
          <XCircle className="w-3 h-3" />
          <span>Lỗi</span>
        </span>
      );
    }
    if (job.status === "paused") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Pause className="w-3 h-3" />
          <span>Tạm dừng</span>
        </span>
      );
    }
    if (job.stage === "queued" || job.status === "waiting") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
          <Clock className="w-3 h-3" />
          <span>Hàng đợi</span>
        </span>
      );
    }
    return null;
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background select-none">
      {/* Hidden File Input for individual / multiple files */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleAddFilesList(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
        multiple
        accept="audio/*,video/*,.txt,.docx,.srt,.vtt,.mp3,.wav,.flac,.m4a,.mp4,.mov,.mkv,.avi,.webm"
        className="hidden"
      />

      {/* Hidden Directory Input for folder upload */}
      <input
        type="file"
        ref={folderInputRef}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleAddFilesList(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        multiple
        className="hidden"
      />

      {/* ========================================================= */}
      {/* 1. TOP CONTROL BAR / VIEW SWITCHER                        */}
      {/* ========================================================= */}
      <div className="h-12 px-4 border-b border-borderDefault bg-panel flex items-center justify-between flex-shrink-0 z-10 shadow-xs gap-3">
        {/* Left: 5 View Switcher Tabs (matching TTS stage switcher position) */}
        <div className="inline-flex bg-surface2/80 rounded-lg p-0.5 border border-borderDefault/80 text-xs flex-shrink-0 gap-0.5">
          <button
            onClick={() => setActiveView("list")}
            className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeView === "list"
                ? "bg-surface1 text-textPrimary font-bold shadow-2xs"
                : "text-textMuted hover:text-textPrimary"
            }`}
          >
            <span>Danh sách</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                activeView === "list" ? "bg-accent/20 text-accent font-bold" : "bg-surface3 text-textMuted"
              }`}
            >
              {viewCounts.list}
            </span>
          </button>

          <button
            onClick={() => setActiveView("queued")}
            className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeView === "queued"
                ? "bg-surface1 text-textPrimary font-bold shadow-2xs"
                : "text-textMuted hover:text-textPrimary"
            }`}
          >
            <span>Hàng đợi</span>
            {viewCounts.processing > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" title="Đang có tệp đang chạy" />
            )}
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                activeView === "queued" ? "bg-accent/20 text-accent font-bold" : "bg-surface3 text-textMuted"
              }`}
            >
              {viewCounts.queued}
            </span>
          </button>

          <button
            onClick={() => setActiveView("completed")}
            className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeView === "completed"
                ? "bg-surface1 text-textPrimary font-bold shadow-2xs"
                : "text-textMuted hover:text-textPrimary"
            }`}
          >
            <span>Hoàn tất</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                activeView === "completed" ? "bg-success/20 text-success font-bold" : "bg-surface3 text-textMuted"
              }`}
            >
              {viewCounts.completed}
            </span>
          </button>

          <button
            onClick={() => setActiveView("failed")}
            className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeView === "failed"
                ? "bg-surface1 text-danger font-bold shadow-2xs"
                : "text-textMuted hover:text-danger"
            }`}
          >
            <span>Lỗi</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                viewCounts.failed > 0
                  ? "bg-danger/20 text-danger font-bold"
                  : "bg-surface3 text-textMuted"
              }`}
            >
              {viewCounts.failed}
            </span>
          </button>
        </div>

        {/* Right: Dynamic Primary Action Button */}
        <div className="flex items-center gap-3">
          {activeView !== "list" && (
            <div className="text-right hidden sm:block">
              {activeView === "queued" ? (
                <>
                  <div className="text-[11px] text-textMuted font-medium">
                    Hàng đợi: <span className="text-textPrimary font-bold">{viewCounts.queued}</span> tệp
                  </div>
                  <div className="text-[10px] text-accent font-medium">
                    {queueStatus === "running" ? "● Đang chạy tuần tự" : queueStatus === "paused" ? "❚❚ Đã tạm dừng" : "○ Sẵn sàng"}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[11px] text-textMuted font-medium">
                    Tổng dự án: <span className="text-textPrimary font-bold">{jobs.length}</span> tệp
                  </div>
                  <div className="text-[10px] text-textMuted">
                    {stats.completed} hoàn tất • {stats.failed} lỗi
                  </div>
                </>
              )}
            </div>
          )}

          {activeView === "list" ? (
            <button
              onClick={handleStageToQueue}
              disabled={selectedJobIds.size === 0}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg shadow-sm transition-all whitespace-nowrap ${
                selectedJobIds.size === 0
                  ? "bg-surface3 text-textMuted cursor-not-allowed border border-borderDefault opacity-60"
                  : "bg-accent hover:bg-accentHover text-slate-950 shadow-accent/20 cursor-pointer active:scale-98"
              }`}
              title="Đóng băng snapshot cấu hình và chuyển các tệp đã chọn sang Hàng đợi"
            >
              <ListPlus className="w-3.5 h-3.5" />
              <span>Chuyển sang hàng đợi ({selectedJobIds.size})</span>
            </button>
          ) : activeView === "queued" ? (
            <div className="flex items-center gap-2">
              {queueStatus === "running" ? (
                <button
                  onClick={() => setQueueStatus("paused")}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg shadow-sm transition-all whitespace-nowrap bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 cursor-pointer active:scale-98"
                  title="Tạm dừng xử lý hàng đợi"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Tạm dừng</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    setQueueStatus("running");
                  }}
                  disabled={viewCounts.queued === 0}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg shadow-sm transition-all whitespace-nowrap ${
                    viewCounts.queued === 0
                      ? "bg-surface3 text-textMuted cursor-not-allowed border border-borderDefault opacity-60"
                      : "bg-accent hover:bg-accentHover text-slate-950 shadow-accent/20 cursor-pointer active:scale-98"
                  }`}
                  title="Bắt đầu chạy các tác vụ trong Hàng đợi"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{queueStatus === "paused" ? "Tiếp tục xử lý" : "Bắt đầu xử lý"}</span>
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => setActiveView("queued")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-textPrimary bg-surface2 hover:bg-surface3 border border-borderDefault rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>Về Hàng đợi</span>
            </button>
          )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* 2. CENTER AREA: SUB-TOOLBAR + UNIFIED WORKSPACE VIEWS     */}
      {/* ========================================================= */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-4 py-3 space-y-2.5">
        {/* Sub-toolbar: Tải Lên, Cấu hình chung + Tìm kiếm (chỉ hiển thị ở tab Danh sách) */}
        {activeView === "list" && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-surface1 rounded-lg border border-borderDefault text-xs flex-shrink-0 shadow-2xs">
            {/* Left: Actions for Import & Defaults */}
            <div className="flex items-center gap-2">
              {/* Single Upload Button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-textPrimary bg-surface2 hover:bg-surface3 border border-borderDefault rounded-md transition-colors shadow-2xs cursor-pointer"
                title="Tải lên tệp hoặc thư mục"
              >
                <UploadCloud className="w-3.5 h-3.5 text-accent" />
                <span>Tải Lên</span>
              </button>

              <div className="h-4 w-px bg-borderDefault mx-1" />

              <button
                onClick={handleOpenGlobalModal}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-textPrimary hover:text-accent bg-surface2 hover:bg-surface3 border border-borderDefault rounded-md transition-colors shadow-2xs cursor-pointer"
                title="Cấu hình mặc định cho toàn bộ mẻ chạy"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-textMuted" />
                <span>Cấu hình hàng loạt</span>
              </button>
            </div>

            {/* Right: Search Box */}
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-textMuted pointer-events-none" />
              <input
                type="text"
                placeholder="Tìm kiếm tệp..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-7 py-1 text-xs bg-surface2 text-textPrimary border border-borderDefault rounded-md focus:outline-none focus:border-accent placeholder:text-textMuted/60 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-textMuted hover:text-textPrimary cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* View Content Container */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="flex-1 min-h-0 bg-surface1 rounded-xl border border-borderDefault flex flex-col overflow-hidden shadow-xs relative"
        >
          {/* Active Drag Overlay when dragging files/folders into list with items */}
          {isDragging && filteredJobs.length > 0 && activeView === "list" && (
            <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-xs flex items-center justify-center p-6 pointer-events-none">
              <div className="w-full h-full border-2 border-dashed border-accent rounded-2xl flex flex-col items-center justify-center gap-3 bg-accent/10 animate-in fade-in duration-150">
                <UploadCloud className="w-12 h-12 text-accent animate-bounce" />
                <div className="text-xl font-bold text-textPrimary">Kéo thả tệp hoặc thư mục vào đây</div>
                <div className="text-xs text-textMuted">Hỗ trợ tệp âm thanh, video, văn bản, phụ đề</div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* VIEW 1: DANH SÁCH (STAGING AREA)                          */}
          {/* ========================================================= */}
          {activeView === "list" && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

              {filteredJobs.length === 0 ? (
                searchQuery ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-textMuted">
                    <Search className="w-8 h-8 mb-2 opacity-50" />
                    <p className="text-xs">Không tìm thấy tệp phù hợp với từ khóa "{searchQuery}".</p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col p-4 sm:p-6 select-none overflow-hidden">
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className={`flex-1 w-full rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center p-6 sm:p-10 transition-all cursor-pointer group ${
                        isDragging
                          ? "border-accent bg-accent/10 scale-[0.995]"
                          : "border-borderDefault bg-surface1/30 hover:bg-surface1/60 hover:border-accent/50"
                      }`}
                    >
                      <h3 className="text-xl sm:text-2xl font-bold text-textPrimary mb-6 tracking-tight">
                        Kéo thả tệp hoặc thư mục vào đây
                      </h3>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        className="px-8 py-3.5 bg-accent hover:bg-accent/90 text-slate-950 rounded-xl font-bold text-sm sm:text-base shadow-md hover:shadow-lg transition-all flex items-center gap-2.5 cursor-pointer active:scale-95"
                      >
                        <UploadCloud className="w-5 h-5" />
                        <span>Tải Lên</span>
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <>
                  <div className="flex-1 overflow-auto bg-surface1">
                    <table className="w-full min-w-[960px] text-left border-collapse table-fixed border-b border-borderDefault">
                    <thead className="sticky top-0 bg-surface2 border-b border-borderDefault z-20 text-[13px] font-bold text-textSecondary">
                      <tr>
                        {/* Column 1: Row Selection (Tri-state Header Checkbox) */}
                        <th className="py-2.5 px-2 w-[3.5%] text-center border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">
                            <input
                              type="checkbox"
                              ref={(el) => {
                                if (el) el.indeterminate = isIndeterminate;
                              }}
                              checked={isAllVisibleSelected}
                              onChange={handleToggleSelectAllVisible}
                              className="w-4 h-4 rounded border-borderDefault text-accent accent-accent focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer"
                              title={isAllVisibleSelected ? "Bỏ chọn tất cả" : "Chọn tất cả tệp hiển thị"}
                            />
                          </div>
                        </th>
                        <th className="py-2.5 px-2 w-[3.5%] text-center font-mono border-r border-borderDefault text-sm font-bold text-textSecondary">
                          <div className="flex items-center justify-center min-h-[46px]">
                            #
                          </div>
                        </th>
                        <th className="py-2.5 px-3.5 w-[28%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                          <div className="flex items-center justify-center min-h-[46px]">
                            Tên tệp
                          </div>
                        </th>

                        {/* Task Columns with Header Tri-State Toggle All */}
                        {renderTaskColumnHeader("tts")}
                        {renderTaskColumnHeader("dialogue")}
                        {renderTaskColumnHeader("transcription")}
                        {renderTaskColumnHeader("translation")}
                        {renderTaskColumnHeader("dubbing")}

                        {/* Trạng thái (đổi tên từ Trạng thái cấu hình) */}
                        <th className="py-2.5 px-3 w-[10%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                          <div className="flex items-center justify-center min-h-[46px]">
                            Trạng thái
                          </div>
                        </th>

                        {/* Thao tác */}
                        <th className="py-2.5 px-2 w-[5%] text-center text-sm font-bold text-textPrimary">
                          <div className="flex items-center justify-center min-h-[46px]">
                            Thao tác
                          </div>
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-borderDefault text-xs">
                      {filteredJobs.map((job, index) => {
                        const isSelectedRow = selectedJobIds.has(job.id);
                        const ttsCompat = getTaskCompatibility(job, "tts");
                        const dialCompat = getTaskCompatibility(job, "dialogue");
                        const asrCompat = getTaskCompatibility(job, "transcription");
                        const transCompat = getTaskCompatibility(job, "translation");
                        const dubCompat = getTaskCompatibility(job, "dubbing");

                        return (
                          <tr
                            key={job.id}
                            className={`transition-colors ${
                              isSelectedRow ? "bg-accent/5 hover:bg-accent/10" : "hover:bg-surface2/50"
                            }`}
                          >
                            {/* Column 1: Row Selection Checkbox */}
                            <td className="py-2.5 px-2 text-center border-r border-borderDefault">
                              <div className="flex items-center justify-center">
                                <input
                                  type="checkbox"
                                  checked={isSelectedRow}
                                  onChange={() => handleToggleSelectRow(job.id)}
                                  className="w-4 h-4 rounded border-borderDefault text-accent accent-accent focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer"
                                />
                              </div>
                            </td>

                            {/* Row Index */}
                            <td className="py-2.5 px-2 text-center text-[11px] text-textMuted font-mono border-r border-borderDefault">
                              {index + 1}
                            </td>

                            {/* File Name & Path */}
                            <td className="py-2.5 px-3.5 border-r border-borderDefault">
                              <div className="flex items-center gap-2 min-w-0">
                                {renderFileIcon(job.fileKind)}
                                <div className="min-w-0">
                                  <div className="font-semibold text-textPrimary truncate flex items-center gap-1.5" title={job.fileName}>
                                    <span className="truncate">{job.fileName}</span>
                                    {job.inputChanged && (
                                      <span
                                        className="inline-flex items-center px-1.5 py-0.2 text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded shrink-0"
                                        title="Tệp nguồn đã bị chỉnh sửa bên ngoài ứng dụng. Khi chạy lại sẽ thực thi từ đầu."
                                      >
                                        ⚠️ Đã sửa ngoài app
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-textMuted truncate" title={job.filePath}>
                                    {job.fileSize} • {job.filePath}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Task 1: TTS */}
                            <td className="py-2.5 px-2 text-center border-r border-borderDefault">
                              <div className="flex items-center justify-center">
                                {ttsCompat.compatible ? (
                                  <input
                                    type="checkbox"
                                    checked={job.selectedTasks.includes("tts")}
                                    onChange={() => handleToggleTask(job.id, "tts")}
                                    className="w-4 h-4 rounded border-borderDefault text-accent accent-accent focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer"
                                  />
                                ) : (
                                  <span className="inline-flex items-center justify-center text-textMuted/40 cursor-not-allowed" title={ttsCompat.reason}>
                                    <Ban className="w-3.5 h-3.5" />
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Task 2: Dialogue (Hội thoại) */}
                            <td className="py-2.5 px-2 text-center border-r border-borderDefault">
                              <div className="flex items-center justify-center min-h-[28px]">
                                <div className="inline-flex items-center justify-center gap-1.5">
                                  {/* Checkbox / Ban slot */}
                                  <div className="w-4 h-4 flex items-center justify-center shrink-0">
                                    {dialCompat.compatible ? (
                                      <input
                                        type="checkbox"
                                        checked={job.selectedTasks.includes("dialogue")}
                                        onChange={() => handleToggleTask(job.id, "dialogue")}
                                        className="w-4 h-4 rounded border-borderDefault text-purple-400 accent-purple-400 focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer"
                                      />
                                    ) : (
                                      <span className="inline-flex items-center justify-center text-textMuted/40 cursor-not-allowed" title={dialCompat.reason}>
                                        <Ban className="w-3.5 h-3.5" />
                                      </span>
                                    )}
                                  </div>

                                  {/* Settings icon slot: hiển thị bánh răng cạnh checkbox Hội thoại khi tác vụ được bật */}
                                  <div className="w-6 h-6 flex items-center justify-center shrink-0">
                                    {dialCompat.compatible && job.selectedTasks.includes("dialogue") ? (
                                      (() => {
                                        const isCustom = hasCustomDialogueVoiceMapping(job);
                                        return (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleOpenDialogueVoiceDrawer(job.id);
                                            }}
                                            className={`p-1 rounded-md transition-colors cursor-pointer ${
                                              isCustom
                                                ? "text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20"
                                                : "text-textMuted hover:text-textSecondary hover:bg-surface2"
                                            }`}
                                            title={
                                              isCustom
                                                ? "Đã tùy chỉnh giọng nhân vật"
                                                : "Cấu hình giọng nhân vật"
                                            }
                                          >
                                            <Settings className="w-3.5 h-3.5" />
                                          </button>
                                        );
                                      })()
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Task 3: Transcription (Phụ đề) */}
                            <td className="py-2.5 px-2 text-center border-r border-borderDefault">
                              <div className="flex items-center justify-center">
                                {asrCompat.compatible ? (
                                  <input
                                    type="checkbox"
                                    checked={job.selectedTasks.includes("transcription")}
                                    onChange={() => handleToggleTask(job.id, "transcription")}
                                    className="w-4 h-4 rounded border-borderDefault text-amber-400 accent-amber-400 focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer"
                                  />
                                ) : (
                                  <span className="inline-flex items-center justify-center text-textMuted/40 cursor-not-allowed" title={asrCompat.reason}>
                                    <Ban className="w-3.5 h-3.5" />
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Task 4: Translation (Dịch) */}
                            <td className="py-2.5 px-2 text-center border-r border-borderDefault">
                              <div className="flex items-center justify-center">
                                {transCompat.compatible ? (
                                  <input
                                    type="checkbox"
                                    checked={job.selectedTasks.includes("translation")}
                                    onChange={() => handleToggleTask(job.id, "translation")}
                                    className="w-4 h-4 rounded border-borderDefault text-sky-400 accent-sky-400 focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer"
                                  />
                                ) : (
                                  <span className="inline-flex items-center justify-center text-textMuted/40 cursor-not-allowed" title={transCompat.reason}>
                                    <Ban className="w-3.5 h-3.5" />
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Task 5: Dubbing (Lồng tiếng) */}
                            <td className="py-2.5 px-2 text-center border-r border-borderDefault">
                              <div className="flex items-center justify-center">
                                {dubCompat.compatible ? (
                                  <input
                                    type="checkbox"
                                    checked={job.selectedTasks.includes("dubbing")}
                                    onChange={() => handleToggleTask(job.id, "dubbing")}
                                    className="w-4 h-4 rounded border-borderDefault text-emerald-400 accent-emerald-400 focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer"
                                  />
                                ) : (
                                  <span className="inline-flex items-center justify-center text-textMuted/40 cursor-not-allowed" title={dubCompat.reason}>
                                    <Ban className="w-3.5 h-3.5" />
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Trạng thái vị trí (Hàng đợi, Hoàn tất, Lỗi... Danh sách: không hiển thị gì) */}
                            <td className="py-2.5 px-3 text-center border-r border-borderDefault">
                              <div className="flex items-center justify-center min-h-[24px]">
                                {renderJobLocationStatus(job)}
                              </div>
                            </td>

                            {/* Actions */}
                            <td className="py-2.5 px-2 text-center">
                              <div className="flex items-center justify-center">
                                <button
                                  onClick={() => setJobs((prev) => prev.filter((j) => j.id !== job.id))}
                                  className="p-1.5 rounded-md text-textMuted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                                  title="Xóa tệp khỏi danh sách"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Sealed Footer Status Bar for Staging List view */}
                <div className="h-[39px] px-4 bg-surface2/60 border-t border-borderDefault flex items-center justify-between text-xs text-textSecondary flex-shrink-0 select-none">
                  <div className="flex items-center gap-3">
                    <span>
                      Tổng: <strong className="text-textPrimary font-semibold">{filteredJobs.length}</strong> tệp
                    </span>
                    {selectedJobIds.size > 0 && (
                      <span className="text-accent font-medium">
                        • Đã chọn: <strong>{selectedJobIds.size}</strong> tệp
                      </span>
                    )}
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        const count = filteredJobs.length;
                        if (count === 0) return;
                        const idsToRemove = new Set(filteredJobs.map((j) => j.id));
                        setJobs((prev) => prev.filter((j) => !idsToRemove.has(j.id)));
                        setSelectedJobIds(new Set());
                        setNotification({
                          id: `clear-${Date.now()}`,
                          type: "info",
                          message: `Đã xóa ${count} tệp khỏi danh sách.`,
                        });
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-danger/80 hover:text-danger bg-danger/5 hover:bg-danger/10 border border-danger/20 hover:border-danger/30 transition-all cursor-pointer"
                      title="Xóa toàn bộ tệp trong danh sách"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa danh sách</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          )}

          {/* ========================================================= */}
          {/* VIEW 2: HÀNG ĐỢI (EXECUTION QUEUE & REORDER)              */}
          {/* ========================================================= */}
          {activeView === "queued" && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {filteredJobs.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center border-2 border-dashed border-borderDefault/80 rounded-xl m-3 bg-surface2/30">
                  <div className="w-12 h-12 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent mb-3">
                    <Clock className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-textPrimary mb-1">Hàng đợi đang trống</h3>
                  <p className="text-xs text-textMuted max-w-sm mb-4">
                    Vui lòng chuyển các tệp từ tab <strong>Danh sách</strong> sang để thiết lập thứ tự và bắt đầu xử lý.
                  </p>
                  <button
                    onClick={() => setActiveView("list")}
                    className="px-3.5 py-1.5 text-xs font-semibold text-accent bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg transition-colors cursor-pointer"
                  >
                    Sang tab Danh sách
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-auto">
                  <table className="w-full text-left border-collapse border-b border-borderDefault">
                    <thead className="sticky top-0 bg-surface2 border-b border-borderDefault z-20 text-[13px] font-bold text-textSecondary">
                      <tr>
                        <th className="py-2.5 px-3 w-24 min-w-[90px] text-center whitespace-nowrap border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">Thứ tự</div>
                        </th>
                        <th className="py-2.5 px-3 min-w-[160px] text-center border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">Tên tệp</div>
                        </th>
                        <th className="py-2.5 px-3 min-w-[260px] text-center border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">Chuỗi tác vụ (Workflow)</div>
                        </th>
                        <th className="py-2.5 px-3 w-40 min-w-[150px] text-center whitespace-nowrap border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">Trạng thái</div>
                        </th>
                        <th className="py-2.5 px-3 w-48 min-w-[175px] text-center whitespace-nowrap">
                          <div className="flex items-center justify-center min-h-[46px]">Thao tác</div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borderDefault text-xs">
                      {filteredJobs.map((job) => {
                        const isProcessing = job.status === "processing";
                        const isPaused = job.status === "paused";

                        return (
                          <tr
                            key={job.id}
                            className={`transition-colors ${
                              isProcessing
                                ? "bg-accent/10 hover:bg-accent/15 border-l-2 border-l-accent"
                                : isPaused
                                ? "bg-amber-500/10 hover:bg-amber-500/15 border-l-2 border-l-amber-500"
                                : "hover:bg-surface2/50"
                            }`}
                          >
                            {/* Reorder / Queue Position */}
                            <td className="py-2.5 px-3 text-center whitespace-nowrap border-r border-borderDefault">
                              {isProcessing ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-accent text-slate-950 shadow-2xs whitespace-nowrap">
                                  <span>🔒 Đang chạy</span>
                                </span>
                              ) : isPaused && job.progressPct > 0 ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-500 text-slate-950 shadow-2xs whitespace-nowrap">
                                  <span>⏸ Tạm dừng</span>
                                </span>
                              ) : (
                                <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                                  <button
                                    onClick={() => handleMoveQueueJob(job.id, "up")}
                                    className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-surface3 transition-colors cursor-pointer"
                                    title="Tăng ưu tiên (chạy sớm hơn)"
                                  >
                                    <ArrowUp className="w-3.5 h-3.5" />
                                  </button>
                                  <span className="font-mono font-bold text-textPrimary w-5 text-center">
                                    {job.queueOrder}
                                  </span>
                                  <button
                                    onClick={() => handleMoveQueueJob(job.id, "down")}
                                    className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-surface3 transition-colors cursor-pointer"
                                    title="Giảm ưu tiên (chạy muộn hơn)"
                                  >
                                    <ArrowDown className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </td>

                            {/* File Name & Path */}
                            <td className="py-2.5 px-3 border-r border-borderDefault">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="p-1 rounded shrink-0">
                                  {renderFileIcon(job.fileKind)}
                                </div>
                                <div className="min-w-0">
                                  <div
                                    className="font-semibold text-textPrimary truncate"
                                    title={job.fileName}
                                  >
                                    {job.fileName}
                                  </div>
                                  <div className="text-[10px] text-textMuted truncate" title={job.filePath}>
                                    {job.fileSize} • {job.filePath}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Execution Sequence Workflow with Real-time Progress & Enlarged Buttons */}
                            <td className="py-2.5 px-3 border-r border-borderDefault">
                              <div className="flex items-center gap-2 flex-wrap">
                                {job.executionSequence.map((taskName, idx) => {
                                  const stepResult = job.stepResults?.[taskName];
                                  const isCurrentStep = (isProcessing || isPaused) && stepResult?.status === "processing";
                                  const isStepDone = (isProcessing || isPaused) && stepResult?.status === "completed";
                                  const stepPct = stepResult?.progressPct || 0;

                                  const taskLabel =
                                    taskName === "transcription"
                                      ? "Phụ đề"
                                      : taskName === "translation"
                                      ? "Dịch"
                                      : taskName === "dubbing"
                                      ? "Lồng tiếng"
                                      : taskName === "dialogue"
                                      ? "Hội thoại"
                                      : "TTS";

                                  return (
                                    <React.Fragment key={taskName}>
                                      {idx > 0 && <span className="text-textMuted font-bold text-xs select-none">→</span>}
                                      <div
                                        className={`relative overflow-hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all shadow-2xs whitespace-nowrap shrink-0 ${
                                          isCurrentStep
                                            ? isPaused
                                              ? "bg-amber-500/15 border-amber-500 text-amber-500 font-bold ring-2 ring-amber-500/30 shadow-xs"
                                              : "bg-accent/15 border-accent text-accent font-bold ring-2 ring-accent/30 shadow-xs"
                                            : isStepDone
                                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-semibold"
                                            : "bg-surface2 hover:bg-surface3 border-borderDefault text-textSecondary font-medium"
                                        }`}
                                      >
                                        {/* Mini bottom progress bar for running task */}
                                        {isCurrentStep && (
                                          <div
                                            className={`absolute bottom-0 left-0 h-0.5 transition-all duration-300 ${
                                              isPaused ? "bg-amber-500" : "bg-accent"
                                            }`}
                                            style={{ width: `${stepPct}%` }}
                                          />
                                        )}

                                        {/* Icon */}
                                        <span className="shrink-0">
                                          {isCurrentStep ? (
                                            isPaused ? (
                                              <Pause className="w-3.5 h-3.5 text-amber-500" />
                                            ) : (
                                              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                                            )
                                          ) : isStepDone ? (
                                            <Check className="w-3.5 h-3.5 stroke-[2.5] text-emerald-500 dark:text-emerald-400" />
                                          ) : taskName === "transcription" ? (
                                            <Subtitles className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                                          ) : taskName === "translation" ? (
                                            <Languages className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
                                          ) : taskName === "dubbing" ? (
                                            <Film className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                                          ) : taskName === "tts" ? (
                                            <Mic className="w-3.5 h-3.5 text-accent" />
                                          ) : (
                                            <MessageSquare className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400" />
                                          )}
                                        </span>

                                        {/* Task Label */}
                                        <span className="whitespace-nowrap">{taskLabel}</span>

                                        {/* Running % badge or Completed 100% */}
                                        {isCurrentStep && (
                                          <span className={`ml-0.5 px-1.5 py-0.2 rounded-md text-[10px] font-mono font-bold shadow-2xs whitespace-nowrap ${
                                            isPaused ? "bg-amber-500 text-slate-950" : "bg-accent text-slate-950"
                                          }`}>
                                            {stepPct}%
                                          </span>
                                        )}
                                        {isStepDone && (
                                          <span className="ml-0.5 text-[10px] font-mono font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                            100%
                                          </span>
                                        )}
                                      </div>
                                    </React.Fragment>
                                  );
                                })}
                              </div>
                            </td>

                            {/* Status: Dạng thanh % */}
                            <td className="py-2.5 px-3 text-center whitespace-nowrap w-40 min-w-[150px] border-r border-borderDefault">
                              <div className="w-36 mx-auto space-y-1 text-left">
                                <div className="flex items-center justify-between text-[11px] font-mono whitespace-nowrap">
                                  <span className={`font-semibold flex items-center gap-1 whitespace-nowrap ${
                                    isProcessing
                                      ? "text-accent"
                                      : isPaused
                                      ? "text-amber-500"
                                      : "text-textMuted"
                                  }`}>
                                    {isProcessing ? (
                                      <>
                                        <Loader2 className="w-3 h-3 animate-spin text-accent shrink-0" />
                                        <span className="whitespace-nowrap">Đang chạy</span>
                                      </>
                                    ) : isPaused ? (
                                      <>
                                        <Pause className="w-3 h-3 text-amber-500 shrink-0" />
                                        <span className="whitespace-nowrap">Tạm dừng</span>
                                      </>
                                    ) : (
                                      <>
                                        <Clock className="w-3 h-3 shrink-0" />
                                        <span className="whitespace-nowrap">Đang chờ</span>
                                      </>
                                    )}
                                  </span>
                                  <span className={`font-bold whitespace-nowrap ${
                                    isProcessing ? "text-accent" : isPaused ? "text-amber-500" : "text-textMuted"
                                  }`}>
                                    {isProcessing || isPaused ? `${job.progressPct}%` : "0%"}
                                  </span>
                                </div>
                                <div className="w-full h-2 bg-surface3 rounded-full overflow-hidden border border-borderDefault/50">
                                  <div
                                    className={`h-full transition-all duration-300 rounded-full ${
                                      isProcessing ? "bg-accent relative" : isPaused ? "bg-amber-500" : "bg-borderDefault/40"
                                    }`}
                                    style={{
                                      width: `${isProcessing || isPaused ? Math.max(job.progressPct, 5) : 0}%`,
                                    }}
                                  >
                                    {isProcessing && <div className="absolute inset-0 bg-white/20 animate-pulse" />}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Actions: Nút Tạm dừng / Tiếp tục và Hủy */}
                            <td className="py-2.5 px-3 text-center whitespace-nowrap w-48 min-w-[175px]">
                              <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                                {/* Tạm dừng / Tiếp tục */}
                                <button
                                  onClick={() => handleTogglePauseJob(job)}
                                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all inline-flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0 ${
                                    job.status === "paused"
                                      ? "bg-accent/15 hover:bg-accent/25 text-accent border-accent/40"
                                      : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 dark:text-amber-400 border-amber-500/30"
                                  }`}
                                  title={job.status === "paused" ? "Tiếp tục xử lý tệp" : "Tạm dừng xử lý tệp"}
                                >
                                  {job.status === "paused" ? (
                                    <>
                                      <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                                      <span className="whitespace-nowrap">Tiếp tục</span>
                                    </>
                                  ) : (
                                    <>
                                      <Pause className="w-3.5 h-3.5 fill-current shrink-0" />
                                      <span className="whitespace-nowrap">Tạm dừng</span>
                                    </>
                                  )}
                                </button>

                                {/* Hủy */}
                                <button
                                  onClick={() => handleCancelJob(job)}
                                  disabled={job.isCancelling}
                                  className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-danger/30 bg-danger/10 hover:bg-danger/20 text-danger transition-all inline-flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50 whitespace-nowrap shrink-0"
                                  title={isProcessing || isPaused ? "Dừng an toàn và giải phóng tài nguyên" : "Bỏ tệp khỏi hàng đợi"}
                                >
                                  {job.isCancelling ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                      <span className="whitespace-nowrap">Đang hủy...</span>
                                    </>
                                  ) : (
                                    <>
                                      <Ban className="w-3.5 h-3.5 shrink-0" />
                                      <span className="whitespace-nowrap">Hủy</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                  {/* Sealed Footer Status Bar for Queued view */}
                  <div className="h-[39px] px-4 bg-surface2/60 border-t border-borderDefault flex items-center justify-between text-xs text-textSecondary flex-shrink-0 select-none">
                    <div className="flex items-center gap-3">
                      <span>
                        Tổng: <strong className="text-textPrimary font-semibold">{filteredJobs.length}</strong> tệp
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ========================================================= */}
          {/* VIEW 3: HOÀN TẤT (COMPLETED HISTORY & PREVIEW)            */}
          {/* ========================================================= */}
          {activeView === "completed" && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {filteredJobs.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center border-2 border-dashed border-borderDefault/80 rounded-xl m-3 bg-surface2/30">
                  <div className="w-12 h-12 rounded-xl bg-success/15 border border-success/30 flex items-center justify-center text-success mb-3">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-textPrimary mb-1">Chưa có tệp nào hoàn tất</h3>
                  <p className="text-xs text-textMuted max-w-sm mb-4">
                    Các tệp sau khi chạy thành công trong Hàng đợi sẽ được lưu tại đây để nghe/xem lại hoặc mở thư mục xuất.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-auto">
                  <table className="w-full text-left border-collapse border-b border-borderDefault">
                    <thead className="sticky top-0 bg-surface2 border-b border-borderDefault z-20 text-[13px] font-bold text-textSecondary">
                      <tr>
                        <th className="py-2.5 px-3 w-12 text-center font-mono border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">#</div>
                        </th>
                        <th className="py-2.5 px-3 min-w-[220px] text-center border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">Tên tệp</div>
                        </th>
                        <th className="py-2.5 px-3 min-w-[180px] text-center border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">Tác vụ đã thực hiện</div>
                        </th>
                        <th className="py-2.5 px-3 min-w-[220px] text-center border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">Kết quả đầu ra (Artifacts)</div>
                        </th>
                        <th className="py-2.5 px-3 w-36 text-center border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">Trạng thái</div>
                        </th>
                        <th className="py-2.5 px-3 w-40 text-center">
                          <div className="flex items-center justify-center min-h-[46px]">Thao tác</div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borderDefault text-xs">
                      {filteredJobs.map((job, index) => (
                        <tr key={job.id} className="hover:bg-surface2/50 transition-colors">
                          <td className="py-2.5 px-3 text-center text-[11px] text-textMuted font-mono border-r border-borderDefault">
                            {index + 1}
                          </td>

                          <td className="py-2.5 px-3 border-r border-borderDefault">
                            <div className="flex items-center gap-2 min-w-0">
                              {renderFileIcon(job.fileKind)}
                              <div className="min-w-0">
                                <div className="font-semibold text-textPrimary truncate" title={job.fileName}>
                                  {job.fileName}
                                </div>
                                <div className="text-[10px] text-textMuted truncate" title={job.filePath}>
                                  {job.fileSize}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-2.5 px-3 border-r border-borderDefault">
                            <div className="flex items-center justify-center gap-1 flex-wrap">
                              {job.selectedTasks.map((t) => (
                                <span
                                  key={t}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface2 border border-borderDefault text-textSecondary uppercase"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          </td>

                          <td className="py-2.5 px-3 border-r border-borderDefault">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              {job.outputArtifacts?.audioPath && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent/10 border border-accent/30 text-accent text-[10px] font-mono">
                                  <Music className="w-3 h-3" />
                                  <span>.wav Master</span>
                                </span>
                              )}
                              {job.outputArtifacts?.subtitles && job.outputArtifacts.subtitles.length > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-mono">
                                  <Subtitles className="w-3 h-3" />
                                  <span>{job.outputArtifacts.subtitles.length} file .srt</span>
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-2.5 px-3 text-center border-r border-borderDefault">
                            {job.status === "completed_with_warning" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20" title="Đã chặn Master WAV để bảo vệ âm thanh do WSOLA 1.20x">
                                <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                <span>Xong có cảnh báo</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-success/10 text-success border border-success/20">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Hoàn tất 100%</span>
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleOpenPreview(job.id)}
                                className="px-2.5 py-1 text-[11px] font-semibold text-accent bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                title="Nghe thử audio hoặc xem phụ đề"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Xem kết quả</span>
                              </button>
                              <button
                                onClick={() => alert(`Mở thư mục xuất: ${globalDefaults.outputPath}`)}
                                className="p-1.5 text-textMuted hover:text-textPrimary bg-surface2 hover:bg-surface3 border border-borderDefault rounded-lg transition-colors cursor-pointer"
                                title="Mở thư mục chứa file"
                              >
                                <FolderOpen className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Sealed Footer Status Bar for Completed view */}
                <div className="h-[39px] px-4 bg-surface2/60 border-t border-borderDefault flex items-center justify-between text-xs text-textSecondary flex-shrink-0 select-none">
                  <div className="flex items-center gap-3">
                    <span>
                      Tổng: <strong className="text-textPrimary font-semibold">{filteredJobs.length}</strong> tệp
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

          {/* ========================================================= */}
          {/* VIEW 5: LỖI (FAILED JOBS & RECOVERY GRAPH)                */}
          {/* ========================================================= */}
          {activeView === "failed" && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {filteredJobs.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center border-2 border-dashed border-borderDefault/80 rounded-xl m-3 bg-surface2/30">
                  <div className="w-12 h-12 rounded-xl bg-success/15 border border-success/30 flex items-center justify-center text-success mb-3">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-textPrimary mb-1">Không có tệp nào bị lỗi</h3>
                  <p className="text-xs text-textMuted max-w-sm">
                    Tất cả các tệp đều đang chạy hoặc đã hoàn tất thành công.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-auto">
                  <table className="w-full text-left border-collapse border-b border-borderDefault">
                    <thead className="sticky top-0 bg-surface2 border-b border-borderDefault z-20 text-[13px] font-bold text-textSecondary">
                      <tr>
                        <th className="py-2.5 px-3 w-12 text-center font-mono border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">#</div>
                        </th>
                        <th className="py-2.5 px-3 min-w-[200px] text-center border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">Tên tệp</div>
                        </th>
                        <th className="py-2.5 px-3 w-32 text-center border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">Bước lỗi</div>
                        </th>
                        <th className="py-2.5 px-3 min-w-[240px] text-center border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">Chi tiết lỗi</div>
                        </th>
                        <th className="py-2.5 px-3 min-w-[180px] text-center border-r border-borderDefault">
                          <div className="flex items-center justify-center min-h-[46px]">Artifact đã lưu an toàn</div>
                        </th>
                        <th className="py-2.5 px-3 w-44 text-center">
                          <div className="flex items-center justify-center min-h-[46px]">Khắc phục & Thao tác</div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borderDefault text-xs">
                      {filteredJobs.map((job, index) => {
                        const failedStep = job.retryFromStep || "dubbing";
                        const stepError = job.stepResults[failedStep]?.error || "Sự cố trong quá trình thực thi bước.";

                        return (
                          <tr key={job.id} className="hover:bg-surface2/50 transition-colors">
                            <td className="py-2.5 px-3 text-center text-[11px] text-textMuted font-mono border-r border-borderDefault">
                              {index + 1}
                            </td>

                            <td className="py-2.5 px-3 border-r border-borderDefault">
                              <div className="flex items-center gap-2 min-w-0">
                                {renderFileIcon(job.fileKind)}
                                <div className="min-w-0">
                                  <div className="font-semibold text-textPrimary truncate" title={job.fileName}>
                                    {job.fileName}
                                  </div>
                                  <div className="text-[10px] text-textMuted truncate">
                                    {job.fileSize}
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="py-2.5 px-3 border-r border-borderDefault text-center">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-danger/15 text-danger border border-danger/30">
                                <XCircle className="w-3 h-3" />
                                <span className="capitalize">{failedStep}</span>
                              </span>
                            </td>

                            <td className="py-2.5 px-3 border-r border-borderDefault">
                              <div className="text-[11px] text-danger/90 font-medium leading-tight">
                                {stepError}
                              </div>
                            </td>

                            <td className="py-2.5 px-3 border-r border-borderDefault">
                              {job.status === "failed_with_artifact" ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-medium">
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>Đã lưu 2 file phụ đề (.srt)</span>
                                </span>
                              ) : (
                                <span className="text-[11px] text-textMuted">Chưa có artifact</span>
                              )}
                            </td>

                            <td className="py-2.5 px-3 text-center">
                              {(() => {
                                const diff = computeJobConfigDiff(job);
                                return (
                                  <div className="flex items-center justify-center gap-2">
                                    {/* 3-Way Dynamic Button: Thử lại vs Tạo lại vs Xuất lại (Derived from computeJobConfigDiff) */}
                                    {diff.ctaType === "retry" && (
                                      <button
                                        onClick={() => handleRetryJob(job.id)}
                                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-accent bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg transition-colors shadow-2xs cursor-pointer"
                                        title="Tái sử dụng Snapshot cũ, tiếp tục từ bước lỗi"
                                      >
                                        <RotateCcw className="w-3 h-3" />
                                        <span>Thử lại</span>
                                      </button>
                                    )}

                                    {diff.ctaType === "regenerate_ai" && (
                                      <button
                                        onClick={() => handleRegenerateJob(job.id, diff.invalidatedFromStep)}
                                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-slate-950 bg-accent hover:bg-accentHover rounded-lg transition-all shadow-sm cursor-pointer"
                                        title={`Tạo lại: Cấu hình AI đã đổi, chạy lại từ bước [${diff.invalidatedFromStep || 'lỗi'}], bảo toàn artifact cũ`}
                                      >
                                        <Zap className="w-3 h-3" />
                                        <span>Tạo lại</span>
                                      </button>
                                    )}

                                    {diff.ctaType === "re_export" && (
                                      <button
                                        onClick={() => handleReExportJob(job.id)}
                                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-emerald-300 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 rounded-lg transition-all shadow-sm cursor-pointer"
                                        title="Xuất lại: Chỉ đổi cấu hình xuất tệp. Tái sử dụng artifact đã có, không gọi lại AI."
                                      >
                                        <FolderOpen className="w-3 h-3 text-emerald-400" />
                                        <span>Xuất lại</span>
                                      </button>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Sealed Footer Status Bar for Failed view */}
                <div className="h-[39px] px-4 bg-surface2/60 border-t border-borderDefault flex items-center justify-between text-xs text-textSecondary flex-shrink-0 select-none">
                  <div className="flex items-center gap-3">
                    <span>
                      Tổng: <strong className="text-textPrimary font-semibold">{filteredJobs.length}</strong> tệp
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* 4. MODAL: CẤU HÌNH CHUNG (GLOBAL DEFAULTS)                */}
      {/* ========================================================= */}
      {isGlobalModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-[840px] h-[760px] max-h-[90vh] bg-panel rounded-2xl border border-borderDefault shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-borderDefault flex items-center justify-between bg-surface1 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
                  <SlidersHorizontal className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-textPrimary">Cấu hình hàng loạt</h3>
              </div>
              <button
                onClick={() => setIsGlobalModalOpen(false)}
                className="p-1.5 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface2 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Tab Navigation */}
            <div className="flex items-center justify-between px-6 border-b border-borderDefault bg-surface1 text-xs flex-shrink-0">
              <div className="flex items-center gap-3 overflow-x-auto">
                <button
                  onClick={() => setGlobalModalTab("general")}
                  className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 ${
                    globalModalTab === "general" ? "border-accent text-accent" : "border-transparent text-textMuted hover:text-textPrimary"
                  }`}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Xuất & Tệp</span>
                </button>

                <div className="w-px h-3.5 bg-borderDefault/80 shrink-0 self-center" />

                <button
                  onClick={() => setGlobalModalTab("text")}
                  className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 ${
                    globalModalTab === "text" ? "border-accent text-accent" : "border-transparent text-textMuted hover:text-textPrimary"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Văn bản</span>
                </button>

                <div className="w-px h-3.5 bg-borderDefault/80 shrink-0 self-center" />

                <button
                  onClick={() => setGlobalModalTab("tts")}
                  className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 ${
                    globalModalTab === "tts" ? "border-accent text-accent" : "border-transparent text-textMuted hover:text-textPrimary"
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>TTS</span>
                </button>

                <div className="w-px h-3.5 bg-borderDefault/80 shrink-0 self-center" />

                <button
                  onClick={() => setGlobalModalTab("dialogue")}
                  className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 ${
                    globalModalTab === "dialogue" ? "border-accent text-accent" : "border-transparent text-textMuted hover:text-textPrimary"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Hội thoại</span>
                </button>

                <div className="w-px h-3.5 bg-borderDefault/80 shrink-0 self-center" />

                <button
                  onClick={() => setGlobalModalTab("transcription")}
                  className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 ${
                    globalModalTab === "transcription" ? "border-accent text-accent" : "border-transparent text-textMuted hover:text-textPrimary"
                  }`}
                >
                  <Subtitles className="w-3.5 h-3.5" />
                  <span>Phụ đề</span>
                </button>

                <div className="w-px h-3.5 bg-borderDefault/80 shrink-0 self-center" />

                <button
                  onClick={() => setGlobalModalTab("translation")}
                  className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 ${
                    globalModalTab === "translation" ? "border-accent text-accent" : "border-transparent text-textMuted hover:text-textPrimary"
                  }`}
                >
                  <Languages className="w-3.5 h-3.5" />
                  <span>Dịch</span>
                </button>

                <div className="w-px h-3.5 bg-borderDefault/80 shrink-0 self-center" />

                <button
                  onClick={() => setGlobalModalTab("dubbing")}
                  className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 ${
                    globalModalTab === "dubbing" ? "border-accent text-accent" : "border-transparent text-textMuted hover:text-textPrimary"
                  }`}
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>Lồng tiếng</span>
                </button>
              </div>

              {/* Reset button right at the corner of the tabs */}
              <button
                type="button"
                onClick={handleResetCurrentTab}
                title="Đặt lại cài đặt của tab hiện tại về mặc định"
                className="flex items-center gap-1 text-xs text-textMuted hover:text-accent focus-visible:ring-1 focus-visible:ring-accent rounded px-2 py-1 transition-colors cursor-pointer shrink-0 ml-4 font-medium"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Đặt lại</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs">
              {/* TAB 1: XUẤT & TỆP */}
              {globalModalTab === "general" && (
                <div className="space-y-4">
                  {/* Output Folder */}
                  <div className="p-3.5 bg-surface1 rounded-xl border border-borderDefault space-y-3">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      Thư mục xuất mặc định
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={globalDefaults.outputPath}
                        disabled={globalDefaults.saveInSourceFolder}
                        onChange={(e) =>
                          setGlobalDefaults((prev) => ({ ...prev, outputPath: e.target.value }))
                        }
                        className={`flex-1 px-3 py-2 bg-surface2 border border-borderDefault rounded-lg text-textPrimary font-mono text-xs focus:outline-none focus:border-borderHighlight ${
                          globalDefaults.saveInSourceFolder ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      />
                      <button
                        type="button"
                        disabled={globalDefaults.saveInSourceFolder}
                        onClick={() => alert("Đã mở trình chọn thư mục hệ thống...")}
                        className={`px-3.5 py-2 bg-surface2 hover:bg-surface3 border border-borderDefault rounded-lg text-textPrimary font-semibold transition-colors cursor-pointer ${
                          globalDefaults.saveInSourceFolder ? "opacity-50 cursor-not-allowed pointer-events-none" : ""
                        }`}
                      >
                        Chọn
                      </button>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        id="saveInSourceFolder"
                        checked={globalDefaults.saveInSourceFolder}
                        onChange={(e) =>
                          setGlobalDefaults((prev) => ({ ...prev, saveInSourceFolder: e.target.checked }))
                        }
                        className="rounded border-borderDefault text-accent focus:ring-0 cursor-pointer"
                      />
                      <label htmlFor="saveInSourceFolder" className="text-textSecondary cursor-pointer select-none">
                        Lưu cùng thư mục với tệp gốc
                      </label>
                    </div>
                  </div>

                  {/* Collision Policy */}
                  <div className="p-3.5 bg-surface1 rounded-xl border border-borderDefault space-y-2">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      Xử lý trùng tên
                    </label>
                    <select
                      value={globalDefaults.collisionPolicy}
                      onChange={(e) =>
                        setGlobalDefaults((prev) => ({
                          ...prev,
                          collisionPolicy: e.target.value as "auto_rename" | "overwrite" | "skip",
                        }))
                      }
                      className="w-full px-3 py-2 bg-surface2 border border-borderDefault rounded-lg text-textPrimary focus:outline-none focus:border-borderHighlight cursor-pointer"
                    >
                      <option value="auto_rename">Tự đổi tên</option>
                      <option value="overwrite">Ghi đè</option>
                      <option value="skip">Bỏ qua</option>
                    </select>
                  </div>

                  {/* Formats Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3.5 bg-surface1 rounded-xl border border-borderDefault space-y-2">
                      <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                        Âm thanh
                      </label>
                      <select
                        value={globalDefaults.outputAudioFormat}
                        onChange={(e) =>
                          setGlobalDefaults((prev) => ({
                            ...prev,
                            outputAudioFormat: e.target.value as "wav" | "mp3",
                          }))
                        }
                        className="w-full px-3 py-2 bg-surface2 border border-borderDefault rounded-lg text-textPrimary focus:outline-none focus:border-borderHighlight cursor-pointer"
                      >
                        <option value="wav">WAV</option>
                        <option value="mp3">MP3</option>
                      </select>
                    </div>

                    <div className="p-3.5 bg-surface1 rounded-xl border border-borderDefault space-y-2">
                      <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                        Phụ đề
                      </label>
                      <select
                        value={globalDefaults.outputSubtitleFormat}
                        onChange={(e) => {
                          const val = e.target.value as "srt" | "vtt";
                          setGlobalDefaults((prev) => ({
                            ...prev,
                            outputSubtitleFormat: val,
                            transcription: {
                              ...prev.transcription,
                              outputFormat: val,
                            },
                          }));
                        }}
                        className="w-full px-3 py-2 bg-surface2 border border-borderDefault rounded-lg text-textPrimary focus:outline-none focus:border-borderHighlight cursor-pointer"
                      >
                        <option value="srt">SRT</option>
                        <option value="vtt">VTT</option>
                      </select>
                    </div>
                  </div>

                  {/* Processing Speed (Tốc độ xử lý) */}
                  <div className="p-3.5 bg-surface1 rounded-xl border border-borderDefault space-y-2">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      Tốc độ xử lý
                    </label>
                    <select
                      value={globalDefaults.concurrency ?? 1}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 1;
                        setGlobalDefaults((prev) => ({
                          ...prev,
                          concurrency: val,
                          tts: { ...prev.tts, concurrency: val },
                          dialogue: { ...prev.dialogue, concurrency: val },
                          dubbing: { ...prev.dubbing, concurrency: val },
                        }));
                        saveBatchOutputSettings({ concurrency: val });
                      }}
                      className="w-full px-3 py-2 bg-surface2 border border-borderDefault rounded-lg text-textPrimary focus:outline-none focus:border-borderHighlight cursor-pointer"
                    >
                      <option value={1}>1x · Mặc định</option>
                      <option value={2}>2x · Nhanh</option>
                      <option value={3}>3x · Rất nhanh</option>
                      <option value={4}>4x · Tối đa</option>
                    </select>
                  </div>
                </div>
              )}

              {/* TAB 2: VĂN BẢN (CHUẨN HÓA VĂN BẢN & PHÁT ÂM - OPTION 1 STREAMLINED) */}
              {globalModalTab === "text" && (
                <div className="space-y-4">
                  {/* Master Auto-Normalize Card */}
                  <div className="p-3.5 bg-surface2/60 rounded-xl border border-borderDefault flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-accent" />
                        <span className="font-semibold text-xs text-textPrimary">
                          Tự động chuẩn hóa văn bản
                        </span>
                      </div>
                      <p className="text-[11px] text-textMuted">
                        Làm sạch khoảng trắng, dấu câu và chuẩn hóa ký tự kịch bản trước khi tổng hợp giọng nói.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={globalDefaults.text?.autoNormalize ?? true}
                      onClick={handleToggleAutoNormalize}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        (globalDefaults.text?.autoNormalize ?? true) ? "bg-accent" : "bg-surface3"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                          (globalDefaults.text?.autoNormalize ?? true) ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {/* 1. QUY TẮC CHUẨN HÓA VĂN BẢN (Annotated Grid) */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between pb-0.5">
                      <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                        Quy tắc chuẩn hóa văn bản
                      </label>
                      <span className="text-[11px] text-textMuted font-medium">
                        {(globalDefaults.text?.enabledGroupIds ?? loadSavedGroupIds()).filter((id) => id !== "pronunciation").length}/4 quy tắc bật
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {NORMALIZER_GROUPS.map((group) => {
                        const currentEnabled = globalDefaults.text?.enabledGroupIds ?? loadSavedGroupIds();
                        const isChecked = currentEnabled.includes(group.id);

                        return (
                          <div
                            key={group.id}
                            onClick={() => handleToggleNormalizerGroup(group.id)}
                            className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer select-none group ${
                              isChecked
                                ? "bg-surface2/70 border-accent/40 shadow-2xs hover:bg-surface2"
                                : "bg-surface2/25 border-borderDefault/60 opacity-75 hover:opacity-100 hover:bg-surface2/40"
                            }`}
                          >
                            {/* Circular Toggle Indicator */}
                            <div className="mt-0.5 shrink-0">
                              <div
                                className={`w-4 h-4 rounded-full flex items-center justify-center transition-all ${
                                  isChecked
                                    ? "bg-indigo-600 text-white shadow-xs"
                                    : "border-2 border-borderDefault bg-transparent group-hover:border-textMuted"
                                }`}
                              >
                                {isChecked && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                              </div>
                            </div>

                            {/* Rule Content: Title + Chú thích + Ví dụ */}
                            <div className="flex-1 min-w-0">
                              <span
                                className={`text-xs sm:text-[13px] font-semibold leading-tight block ${
                                  isChecked ? "text-textPrimary" : "text-textSecondary"
                                }`}
                              >
                                {group.name}
                              </span>

                              <div className="text-[11.5px] text-textMuted leading-snug mt-0.5">
                                {group.description}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Subtle Divider */}
                  <div className="border-t border-borderDefault/60 pt-0.5" />

                  {/* 2. THƯ VIỆN PHÁT ÂM CHUNG (Annotated Action Card) */}
                  <div className="space-y-2">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      Thư viện phát âm chung
                    </label>

                    <div
                      onClick={handleToggleApplyPronunciation}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all cursor-pointer select-none group ${
                        (globalDefaults.text?.applyPronunciation ?? true)
                          ? "bg-surface2/70 border-accent/40 shadow-2xs hover:bg-surface2"
                          : "bg-surface2/25 border-borderDefault/60 opacity-75 hover:opacity-100 hover:bg-surface2/40"
                      }`}
                    >
                      {/* Circular Toggle Indicator */}
                      <div className="mt-0.5 shrink-0">
                        <div
                          className={`w-4 h-4 rounded-full flex items-center justify-center transition-all ${
                            (globalDefaults.text?.applyPronunciation ?? true)
                              ? "bg-indigo-600 text-white shadow-xs"
                              : "border-2 border-borderDefault bg-transparent group-hover:border-textMuted"
                          }`}
                        >
                          {(globalDefaults.text?.applyPronunciation ?? true) && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </div>
                      </div>

                      {/* Content: Title + Quản lý button + Chú thích + Active rules */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-xs sm:text-[13px] font-semibold leading-tight ${
                              (globalDefaults.text?.applyPronunciation ?? true) ? "text-textPrimary" : "text-textSecondary"
                            }`}
                          >
                            Phát âm tùy chỉnh
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsPronunciationModalOpen(true);
                            }}
                            className="text-[11px] font-medium text-accent hover:underline hover:text-accentHover px-2 py-0.5 rounded bg-accent/10 border border-accent/20 transition-colors flex items-center gap-1 cursor-pointer"
                            title="Mở trình quản lý phát âm chi tiết (Global & Project)"
                          >
                            <span>Quản lý</span>
                          </button>
                        </div>

                        <div className="text-[11.5px] text-textMuted leading-snug mt-0.5">
                          Áp dụng các cách đọc tùy chỉnh đã thiết lập cho từ, cụm từ và ký hiệu trong kịch bản.
                        </div>

                        <div className="mt-1.5 text-[11px] font-medium text-textSecondary flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block" />
                          <span>{globalPronunciationRules.filter((r) => r.enabled).length} quy tắc đang hoạt động</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: TTS (ĐƠN GIỌNG) */}
              {globalModalTab === "tts" && (
                <div className="space-y-4">
                  {/* 1. GIỌNG ĐỌC CHÍNH */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      Giọng đọc chính
                    </label>
                    <div
                      id="batch-voice-picker-trigger"
                      role="button"
                      tabIndex={0}
                      onClick={() => setIsTtsVoiceModalOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setIsTtsVoiceModalOpen(true);
                        }
                      }}
                      className="p-3 bg-surface2/60 hover:bg-surface2 border border-borderDefault hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl transition-all cursor-pointer flex items-center justify-between gap-3 group shadow-2xs"
                      title="Chọn giọng từ thư viện"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-full bg-gradient-to-tr ${
                            activeTtsVoice.avatarColor || "from-pink-500 to-rose-600"
                          } flex items-center justify-center text-white font-bold text-xs shadow-sm flex-shrink-0`}
                        >
                          {activeTtsVoice.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-semibold text-[13px] text-textPrimary truncate group-hover:text-accent transition-colors">
                            {activeTtsVoice.name}
                          </h4>
                          {(() => {
                            const langInfo = getVoiceLanguageInfo(activeTtsVoice, lang);
                            let accentOrTag = "";
                            if (activeTtsVoice.accent) {
                              const normAcc = normalizeAccent(activeTtsVoice.accent);
                              accentOrTag = getAccentLabel(normAcc, lang);
                            }
                            if (!accentOrTag) {
                              const secondaryTags = getVoiceSecondaryTags(activeTtsVoice, lang);
                              accentOrTag =
                                secondaryTags.length > 0
                                  ? secondaryTags[0]
                                  : lang === "vi"
                                  ? "Tiêu chuẩn"
                                  : "Standard";
                            }
                            return (
                              <div className="flex items-center gap-1.5 mt-0.5 text-xs text-textSecondary font-medium truncate">
                                <CountryFlag countryCode={langInfo.countryCode || langInfo.code} />
                                <span className="truncate">{langInfo.name}</span>
                                {accentOrTag && (
                                  <>
                                    <span className="text-textMuted text-[10px]">·</span>
                                    <span className="text-[11px] text-textMuted truncate">
                                      {accentOrTag}
                                    </span>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 text-xs text-accent font-semibold flex-shrink-0 group-hover:translate-x-0.5 transition-transform">
                        <span>Đổi giọng</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>

                  {/* 2. MODEL */}
                  <div className="space-y-1.5 pt-0.5">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      Model
                    </label>
                    <select
                      value={globalDefaults.tts.model}
                      onChange={(e) =>
                        setGlobalDefaults((prev) => ({
                          ...prev,
                          tts: { ...prev.tts, model: e.target.value },
                        }))
                      }
                      className="w-full h-[34px] bg-surface2 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
                    >
                      <option value="Omni Voice">Omni Voice</option>
                      <option value="Chatterbox Turbo">Chatterbox Turbo</option>
                      <option value="Qwen 1.7B">Qwen 1.7B</option>
                    </select>
                  </div>

                  {/* Subtle Divider before CÀI ĐẶT */}
                  <div className="border-t border-borderDefault/60 pt-1" />

                  {/* 3. CÀI ĐẶT */}
                  <div className="space-y-3.5">
                    {/* Header with inline Reset button */}
                    <div className="flex items-center justify-between pb-0.5">
                      <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                        Cài đặt
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setGlobalDefaults((prev) => ({
                            ...prev,
                            tts: {
                              ...prev.tts,
                              speed: 1.0,
                              pitch: 1.0,
                              volume: 1.0,
                            },
                          }));
                          saveStoredTtsSettings({
                            speed: 1.0,
                            pitch: 1.0,
                            volume: 1.0,
                          });
                        }}
                        title="Đặt lại cài đặt âm thanh"
                        className="flex items-center gap-1 text-xs text-textMuted hover:text-accent focus-visible:ring-1 focus-visible:ring-accent rounded px-1.5 py-0.5 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Đặt lại</span>
                      </button>
                    </div>

                    {/* Speed Slider */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                          <Gauge className="w-3.5 h-3.5 text-textMuted" />
                          <span>Tốc độ</span>
                        </span>
                        <span className="font-mono text-accent font-semibold">
                          {globalDefaults.tts.speed.toFixed(2)}×
                        </span>
                      </div>
                      <div className="relative flex items-center">
                        <input
                          type="range"
                          min="0.5"
                          max="1.5"
                          step="0.05"
                          value={globalDefaults.tts.speed}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setGlobalDefaults((prev) => ({
                              ...prev,
                              tts: { ...prev.tts, speed: val },
                            }));
                            saveStoredTtsSettings({ speed: val });
                          }}
                          className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                        <span>0.5×</span>
                        <span>1.5×</span>
                      </div>
                    </div>

                    {/* Pitch Slider */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                          <Activity className="w-3.5 h-3.5 text-textMuted" />
                          <span>Cao độ</span>
                        </span>
                        <span className="font-mono text-accent font-semibold">
                          {globalDefaults.tts.pitch.toFixed(2)}
                        </span>
                      </div>
                      <div className="relative flex items-center">
                        <input
                          type="range"
                          min="0.5"
                          max="1.5"
                          step="0.05"
                          value={globalDefaults.tts.pitch}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setGlobalDefaults((prev) => ({
                              ...prev,
                              tts: { ...prev.tts, pitch: val },
                            }));
                            saveStoredTtsSettings({ pitch: val });
                          }}
                          className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                        <span>Trầm</span>
                        <span>Bổng</span>
                      </div>
                    </div>

                    {/* Volume Slider */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                          <Volume2 className="w-3.5 h-3.5 text-textMuted" />
                          <span>Âm lượng</span>
                        </span>
                        <span className="font-mono text-accent font-semibold">
                          {Math.round(globalDefaults.tts.volume * 100)}%
                        </span>
                      </div>
                      <div className="relative flex items-center">
                        <input
                          type="range"
                          min="0"
                          max="2.0"
                          step="0.05"
                          value={globalDefaults.tts.volume}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setGlobalDefaults((prev) => ({
                              ...prev,
                              tts: { ...prev.tts, volume: val },
                            }));
                            saveStoredTtsSettings({ volume: val });
                          }}
                          className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                        <span>0%</span>
                        <span>200%</span>
                      </div>
                    </div>
                  </div>

                  {/* 4. NGẮT NGHỈ (Punctuation Pauses Accordion) */}
                  <div className="pt-2 border-t border-borderDefault/60">
                    <button
                      type="button"
                      onClick={() => setTtsPausesOpen(!ttsPausesOpen)}
                      className="w-full flex items-center justify-between py-2 px-1 rounded-md text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-surface2/40 outline-none focus:outline-none transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-accent" />
                        <span className="uppercase tracking-wider font-bold">
                          Ngắt nghỉ
                        </span>
                      </div>
                      <ChevronRight
                        className={`w-3.5 h-3.5 transition-transform duration-200 ${
                          ttsPausesOpen ? "rotate-90" : ""
                        }`}
                      />
                    </button>

                    {ttsPausesOpen && (
                      <div className="space-y-3 pt-2">
                        <div className="grid grid-cols-2 gap-3">
                          {/* Dấu phẩy ( , ) */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              Dấu phẩy ( , )
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.1"
                                max="3.0"
                                step="0.1"
                                value={globalDefaults.tts.pauses.comma}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0.1;
                                  const updated = { ...globalDefaults.tts.pauses, comma: val };
                                  setGlobalDefaults((prev) => ({
                                    ...prev,
                                    tts: {
                                      ...prev.tts,
                                      pauses: updated,
                                    },
                                  }));
                                  saveStoredTtsSettings({ pauses: updated });
                                }}
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                giây
                              </span>
                            </div>
                          </div>

                          {/* Dấu chấm ( . ) */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              Dấu chấm ( . )
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.2"
                                max="5.0"
                                step="0.1"
                                value={globalDefaults.tts.pauses.period}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0.2;
                                  const updated = { ...globalDefaults.tts.pauses, period: val };
                                  setGlobalDefaults((prev) => ({
                                    ...prev,
                                    tts: {
                                      ...prev.tts,
                                      pauses: updated,
                                    },
                                  }));
                                  saveStoredTtsSettings({ pauses: updated });
                                }}
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                giây
                              </span>
                            </div>
                          </div>

                          {/* Hỏi / Than ( ? ! ) */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              Hỏi / Than ( ? ! )
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.2"
                                max="5.0"
                                step="0.1"
                                value={globalDefaults.tts.pauses.questionExclamation}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0.2;
                                  const updated = { ...globalDefaults.tts.pauses, questionExclamation: val };
                                  setGlobalDefaults((prev) => ({
                                    ...prev,
                                    tts: {
                                      ...prev.tts,
                                      pauses: updated,
                                    },
                                  }));
                                  saveStoredTtsSettings({ pauses: updated });
                                }}
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                giây
                              </span>
                            </div>
                          </div>

                          {/* Hai chấm ( : ; ) */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              Hai chấm ( : ; )
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.1"
                                max="3.0"
                                step="0.1"
                                value={globalDefaults.tts.pauses.colonSemicolon}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0.1;
                                  const updated = { ...globalDefaults.tts.pauses, colonSemicolon: val };
                                  setGlobalDefaults((prev) => ({
                                    ...prev,
                                    tts: {
                                      ...prev.tts,
                                      pauses: updated,
                                    },
                                  }));
                                  saveStoredTtsSettings({ pauses: updated });
                                }}
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                giây
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: HỘI THOẠI (DIALOGUE) */}
              {globalModalTab === "dialogue" && (
                <div className="space-y-4">
                  {/* 1. MODEL */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      Mô hình
                    </label>
                    <select
                      value={globalDefaults.dialogue.model}
                      onChange={(e) => handleUpdateGlobalDialogue({ model: e.target.value })}
                      className="w-full h-[34px] bg-surface2 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
                    >
                      <option value="Omni Voice">Omni Voice</option>
                      <option value="Chatterbox Turbo">Chatterbox Turbo</option>
                      <option value="Qwen 1.7B">Qwen 1.7B</option>
                    </select>
                  </div>

                  {/* 2. CÀI ĐẶT */}
                  <div className="border-t border-borderDefault/60 pt-2 space-y-3.5">
                    <div className="flex items-center justify-between pb-0.5">
                      <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                        Cài đặt
                      </label>
                      <button
                        type="button"
                        onClick={handleResetGlobalDialogue}
                        title="Đặt lại cài đặt âm thanh hội thoại"
                        className="flex items-center gap-1 text-xs text-textMuted hover:text-accent focus-visible:ring-1 focus-visible:ring-accent rounded px-1.5 py-0.5 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Đặt lại</span>
                      </button>
                    </div>

                    {/* Volume Slider */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                          <Volume2 className="w-3.5 h-3.5 text-textMuted" />
                          <span>Âm lượng</span>
                        </span>
                        <span className="font-mono text-accent font-semibold">
                          {Math.round(globalDefaults.dialogue.masterVolume * 100)}%
                        </span>
                      </div>
                      <div className="relative flex items-center">
                        <input
                          type="range"
                          min="0"
                          max="2.0"
                          step="0.05"
                          value={globalDefaults.dialogue.masterVolume}
                          onChange={(e) =>
                            handleUpdateGlobalDialogue({ masterVolume: parseFloat(e.target.value) })
                          }
                          className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                        <span>0%</span>
                        <span>200%</span>
                      </div>
                    </div>
                  </div>

                  {/* 3. NGẮT NGHỈ (Punctuation Pauses Accordion) */}
                  <div className="pt-2 border-t border-borderDefault/60">
                    <button
                      type="button"
                      onClick={() => setDialoguePausesOpen(!dialoguePausesOpen)}
                      className="w-full flex items-center justify-between py-2 px-1 rounded-md text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-surface2/40 outline-none focus:outline-none transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-accent" />
                        <span className="uppercase tracking-wider font-bold">
                          Ngắt nghỉ
                        </span>
                      </div>
                      <ChevronRight
                        className={`w-3.5 h-3.5 transition-transform duration-200 ${
                          dialoguePausesOpen ? "rotate-90" : ""
                        }`}
                      />
                    </button>

                    {dialoguePausesOpen && (
                      <div className="space-y-3 pt-2">
                        <div className="grid grid-cols-2 gap-3">
                          {/* Dấu phẩy ( , ) */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              Dấu phẩy ( , )
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.1"
                                max="3.0"
                                step="0.1"
                                value={globalDefaults.dialogue.pauses.comma}
                                onChange={(e) =>
                                  handleUpdateGlobalDialogue({
                                    pauses: {
                                      ...globalDefaults.dialogue.pauses,
                                      comma: parseFloat(e.target.value) || 0.1,
                                    },
                                  })
                                }
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                giây
                              </span>
                            </div>
                          </div>

                          {/* Dấu chấm ( . ) */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              Dấu chấm ( . )
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.2"
                                max="5.0"
                                step="0.1"
                                value={globalDefaults.dialogue.pauses.period}
                                onChange={(e) =>
                                  handleUpdateGlobalDialogue({
                                    pauses: {
                                      ...globalDefaults.dialogue.pauses,
                                      period: parseFloat(e.target.value) || 0.2,
                                    },
                                  })
                                }
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                giây
                              </span>
                            </div>
                          </div>

                          {/* Hỏi / Than ( ? ! ) */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              Hỏi / Than ( ? ! )
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.2"
                                max="5.0"
                                step="0.1"
                                value={globalDefaults.dialogue.pauses.questionExclamation}
                                onChange={(e) =>
                                  handleUpdateGlobalDialogue({
                                    pauses: {
                                      ...globalDefaults.dialogue.pauses,
                                      questionExclamation: parseFloat(e.target.value) || 0.2,
                                    },
                                  })
                                }
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                giây
                              </span>
                            </div>
                          </div>

                          {/* Hai chấm ( : ; ) */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              Hai chấm ( : ; )
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.1"
                                max="3.0"
                                step="0.1"
                                value={globalDefaults.dialogue.pauses.colonSemicolon}
                                onChange={(e) =>
                                  handleUpdateGlobalDialogue({
                                    pauses: {
                                      ...globalDefaults.dialogue.pauses,
                                      colonSemicolon: parseFloat(e.target.value) || 0.1,
                                    },
                                  })
                                }
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                giây
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: PHỤ ĐỀ (TRANSCRIPTION / ASR) */}
              {globalModalTab === "transcription" && (
                <div className="space-y-4">
                  {/* Group 1: Nhận diện */}
                  <div className="space-y-3 p-3 bg-surface2/40 rounded-xl border border-borderDefault">
                    <div className="flex items-center gap-1.5 pb-1.5 border-b border-borderDefault/60">
                      <Sparkles className="w-3.5 h-3.5 text-accent" />
                      <span className="font-semibold text-xs text-textPrimary uppercase tracking-wide">
                        {t.transcription.recognitionGroupTitle}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-textSecondary font-medium text-[11px]">
                        {t.transcription.modelLabel}
                      </label>
                      <select
                        value={
                          globalDefaults.transcription.whisperModel === "auto"
                            ? "large-v3-turbo"
                            : globalDefaults.transcription.whisperModel
                        }
                        onChange={(e) => handleUpdateGlobalTranscription({ whisperModel: e.target.value })}
                        className="w-full bg-surface1 border border-borderDefault rounded-md px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none cursor-pointer"
                      >
                        <option value="large-v3-turbo">{t.transcription.whisperModelTurbo}</option>
                        <option value="large-v3">{t.transcription.whisperModelLarge}</option>
                        <option value="medium">{t.transcription.whisperModelMedium}</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-textSecondary font-medium text-[11px]">
                        {t.transcription.langAudio}
                      </label>
                      <SearchableLanguageSelect
                        value={globalDefaults.transcription.audioLanguage}
                        onChange={(code) => handleUpdateGlobalTranscription({ audioLanguage: code })}
                        languages={WHISPER_AUDIO_LANGUAGES}
                        searchPlaceholder={lang === "vi" ? "Tìm ngôn ngữ âm thanh..." : "Search audio language..."}
                        ariaLabel={t.transcription.langAudio}
                        size="sm"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-textSecondary font-medium text-[11px]">
                        {t.transcription.speechSpeedLabel}
                      </label>
                      <select
                        value={globalDefaults.transcription.speechSpeed}
                        onChange={(e) =>
                          handleUpdateGlobalTranscription({
                            speechSpeed: e.target.value as "1.0" | "0.9" | "0.8",
                          })
                        }
                        className="w-full bg-surface1 border border-borderDefault rounded-md px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none cursor-pointer"
                      >
                        <option value="1.0">{t.transcription.speechSpeedNormal}</option>
                        <option value="0.9">{t.transcription.speechSpeedFast}</option>
                        <option value="0.8">{t.transcription.speechSpeedVeryFast}</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-textSecondary font-medium text-[11px]">
                        {t.transcription.processingSpeedLabel}
                      </label>
                      <select
                        value={globalDefaults.transcription.processingSpeed}
                        onChange={(e) =>
                          handleUpdateGlobalTranscription({
                            processingSpeed: e.target.value as SubtitleProcessingSpeed,
                          })
                        }
                        className="w-full bg-surface1 border border-borderDefault rounded-md px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none cursor-pointer"
                      >
                        <option value="auto">Tự động</option>
                        <option value="1x">1x</option>
                        <option value="2x">2x</option>
                        <option value="4x">4x</option>
                        <option value="8x">8x</option>
                      </select>
                    </div>
                  </div>

                  {/* Group 2: Hiển thị */}
                  <div className="space-y-3 p-3 bg-surface2/40 rounded-xl border border-borderDefault">
                    <div className="flex items-center gap-1.5 pb-1.5 border-b border-borderDefault/60">
                      <Sliders className="w-3.5 h-3.5 text-accent" />
                      <span className="font-semibold text-xs text-textPrimary uppercase tracking-wide">
                        {t.transcription.displayGroupTitle}
                      </span>
                    </div>

                    {/* Segmented Control for Aspect Ratio */}
                    <div className="space-y-1.5">
                      <label className="block text-textSecondary font-medium text-[11px]">
                        {t.transcription.aspectRatioLabel}
                      </label>
                      <div className="grid grid-cols-3 gap-1 p-1 bg-surface1 rounded-lg border border-borderDefault">
                        {(["16:9", "9:16", "1:1"] as SubtitleAspectRatio[]).map((ratio) => {
                          const isSelected = globalDefaults.transcription.aspectRatio === ratio;
                          const labels: Record<SubtitleAspectRatio, { ratio: string; sub: string }> = {
                            "16:9": { ratio: "16:9", sub: "Ngang" },
                            "9:16": { ratio: "9:16", sub: "Dọc" },
                            "1:1": { ratio: "1:1", sub: "Vuông" },
                          };
                          const info = labels[ratio];
                          return (
                            <button
                              key={ratio}
                              type="button"
                              onClick={() => handleUpdateGlobalTranscription({ aspectRatio: ratio })}
                              className={`py-1.5 px-1 rounded-md text-[11px] font-medium transition-all text-center cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                                isSelected
                                  ? "bg-accent text-background font-semibold shadow-sm"
                                  : "text-textSecondary hover:text-textPrimary hover:bg-surface2/60"
                              }`}
                            >
                              <span className="leading-tight">{info.ratio}</span>
                              <span
                                className={`text-[10px] leading-tight ${
                                  isSelected ? "text-background/80" : "text-textMuted"
                                }`}
                              >
                                {info.sub}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Segmented Control for Max Lines */}
                    <div className="space-y-1.5">
                      <label className="block text-textSecondary font-medium text-[11px]">
                        {t.transcription.maxLinesLabel}
                      </label>
                      <div className="grid grid-cols-2 gap-1 p-1 bg-surface1 rounded-lg border border-borderDefault">
                        {([1, 2] as SubtitleMaxLines[]).map((lines) => {
                          const isSelected = globalDefaults.transcription.maxLines === lines;
                          return (
                            <button
                              key={lines}
                              type="button"
                              onClick={() => handleUpdateGlobalTranscription({ maxLines: lines })}
                              className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all text-center cursor-pointer ${
                                isSelected
                                  ? "bg-accent text-background font-semibold shadow-sm"
                                  : "text-textSecondary hover:text-textPrimary hover:bg-surface2/60"
                              }`}
                            >
                              {lines} dòng
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: DỊCH THUẬT (TRANSLATION) */}
              {globalModalTab === "translation" && (
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-center gap-2 pb-1 border-b border-borderDefault/60">
                    <Languages className="w-4 h-4 text-accent" />
                    <span className="font-bold text-xs text-textPrimary uppercase tracking-wide">
                      Dịch Phụ Đề
                    </span>
                  </div>

                  {/* Phong Cách Dịch */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      Phong Cách Dịch
                    </label>
                    <select
                      value={globalDefaults.translation.style}
                      onChange={(e) => {
                        const val = e.target.value as TranslationStyle;
                        handleUpdateGlobalTranslation({ style: val });
                      }}
                      className="w-full h-[36px] bg-surface2/50 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
                    >
                      <option value="default">Mặc định</option>
                      <option value="cinema">Điện ảnh</option>
                    </select>
                  </div>

                  {/* Model Dịch */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      Model Dịch
                    </label>
                    <select
                      value={
                        availableTranslationProviders.some((p) => p.id === globalDefaults.translation.provider)
                          ? globalDefaults.translation.provider
                          : (availableTranslationProviders.find(
                              (p) =>
                                p.id.toLowerCase() === globalDefaults.translation.provider.toLowerCase() ||
                                globalDefaults.translation.provider.toLowerCase().includes(p.id)
                            )?.id || availableTranslationProviders[0]?.id || "google")
                      }
                      onChange={(e) => handleUpdateGlobalTranslation({ provider: e.target.value })}
                      className="w-full h-[36px] bg-surface2/50 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
                    >
                      {availableTranslationProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName} ({p.badge})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Ngôn Ngữ Gốc & Ngôn Ngữ Đích (Cùng dòng) */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Ngôn Ngữ Gốc */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider truncate">
                        {lang === "en" ? "Source Language" : lang === "zh" ? "源语言" : lang === "ja" ? "原言語" : "Ngôn Ngữ Gốc"}
                      </label>
                      <SearchableLanguageSelect
                        value={globalDefaults.translation.sourceLanguage}
                        onChange={(val) => handleUpdateGlobalTranslation({ sourceLanguage: val })}
                        languages={TRANSLATION_SOURCE_LANGUAGES}
                        size="sm"
                        dropdownAlign="left"
                        ariaLabel={lang === "en" ? "Source language" : lang === "zh" ? "源语言" : lang === "ja" ? "原言語" : "Ngôn ngữ gốc"}
                      />
                    </div>

                    {/* Ngôn Ngữ Đích */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider truncate">
                        {lang === "en" ? "Target Language" : lang === "zh" ? "目标语言" : lang === "ja" ? "対象言語" : "Ngôn Ngữ Đích"}
                      </label>
                      <SearchableLanguageSelect
                        value={globalDefaults.translation.targetLanguage}
                        onChange={(val) => handleUpdateGlobalTranslation({ targetLanguage: val })}
                        languages={TRANSLATION_TARGET_LANGUAGES}
                        size="sm"
                        dropdownAlign="right"
                        ariaLabel={lang === "en" ? "Target language" : lang === "zh" ? "目标语言" : lang === "ja" ? "対象言語" : "Ngôn ngữ đích"}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 6: LỒNG TIẾNG (DUBBING) */}
              {globalModalTab === "dubbing" && (
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-center gap-2 pb-1 border-b border-borderDefault/60">
                    <Volume2 className="w-4 h-4 text-accent" />
                    <span className="font-bold text-xs text-textPrimary uppercase tracking-wide">
                      Lồng Tiếng
                    </span>
                  </div>

                  {/* 1. GIỌNG LỒNG TIẾNG (Interactive Card with Avatar, Name, Flag, Region, "Đổi giọng >") */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      Chọn giọng
                    </label>
                    <div
                      id="batch-dubbing-voice-picker-trigger"
                      role="button"
                      tabIndex={0}
                      onClick={() => setIsDubbingVoiceModalOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setIsDubbingVoiceModalOpen(true);
                        }
                      }}
                      className="p-3 bg-surface1 hover:bg-surface2/60 border border-borderDefault hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl transition-all cursor-pointer flex items-center justify-between gap-3 group shadow-2xs"
                      title="Chọn giọng từ thư viện"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-full bg-gradient-to-tr ${
                            activeDubbingVoice.avatarColor || "from-pink-500 to-rose-600"
                          } flex items-center justify-center text-white font-bold text-xs shadow-sm flex-shrink-0`}
                        >
                          {activeDubbingVoice.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-semibold text-[13px] text-textPrimary truncate group-hover:text-accent transition-colors">
                            {activeDubbingVoice.name}
                          </h4>
                          {(() => {
                            const langInfo = getVoiceLanguageInfo(activeDubbingVoice, lang);
                            let accentOrTag = "";
                            if (activeDubbingVoice.accent) {
                              const normAcc = normalizeAccent(activeDubbingVoice.accent);
                              accentOrTag = getAccentLabel(normAcc, lang);
                            }
                            if (!accentOrTag) {
                              const secondaryTags = getVoiceSecondaryTags(activeDubbingVoice, lang);
                              accentOrTag =
                                secondaryTags.length > 0
                                  ? secondaryTags[0]
                                  : lang === "vi"
                                  ? "Tiêu chuẩn"
                                  : "Standard";
                            }
                            return (
                              <div className="flex items-center gap-1.5 mt-0.5 text-xs text-textSecondary font-medium truncate">
                                <CountryFlag countryCode={langInfo.countryCode || langInfo.code} />
                                <span className="truncate">{langInfo.name}</span>
                                {accentOrTag && (
                                  <>
                                    <span className="text-textMuted text-[10px]">·</span>
                                    <span className="text-[11px] text-textMuted truncate">
                                      {accentOrTag}
                                    </span>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 text-xs text-accent font-semibold flex-shrink-0 group-hover:translate-x-0.5 transition-transform">
                        <span>Đổi giọng</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>

                  {/* 2. MODEL ĐỌC */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      Model đọc
                    </label>
                    <select
                      value={globalDefaults.dubbing.ttsModel}
                      onChange={(e) => handleUpdateGlobalDubbing({ ttsModel: e.target.value })}
                      className="w-full h-[34px] bg-surface1 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
                    >
                      <option value="Omni Voice">Omni Voice</option>
                      <option value="Chatterbox Turbo">Chatterbox Turbo</option>
                      <option value="Qwen 1.7B">Qwen 1.7B</option>
                    </select>
                  </div>

                  {/* 3. CÀI ĐẶT (Tốc độ, Cao độ, Âm lượng) with Đặt lại */}
                  <div className="border-t border-borderDefault/60 pt-2 space-y-3">
                    <div className="flex items-center justify-between pb-0.5">
                      <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                        Cài đặt
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          handleUpdateGlobalDubbing({
                            speed: 1.0,
                            pitch: 1.0,
                            volume: 1.0,
                          });
                        }}
                        title="Đặt lại cài đặt âm thanh"
                        className="flex items-center gap-1 text-xs text-textMuted hover:text-accent focus-visible:ring-1 focus-visible:ring-accent rounded px-1.5 py-0.5 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Đặt lại</span>
                      </button>
                    </div>

                    {/* Speed Slider */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                          <Gauge className="w-3.5 h-3.5 text-textMuted" />
                          <span>Tốc độ</span>
                        </span>
                        <span className="font-mono text-accent font-semibold">
                          {(globalDefaults.dubbing.speed ?? 1.0).toFixed(2)}×
                        </span>
                      </div>
                      <div className="relative flex items-center">
                        <input
                          type="range"
                          min="0.5"
                          max="1.5"
                          step="0.05"
                          value={globalDefaults.dubbing.speed ?? 1.0}
                          onChange={(e) => handleUpdateGlobalDubbing({ speed: parseFloat(e.target.value) })}
                          className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                        <span>0.5×</span>
                        <span>1.5×</span>
                      </div>
                    </div>

                    {/* Pitch Slider */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                          <Activity className="w-3.5 h-3.5 text-textMuted" />
                          <span>Cao độ</span>
                        </span>
                        <span className="font-mono text-accent font-semibold">
                          {(globalDefaults.dubbing.pitch ?? 1.0).toFixed(2)}
                        </span>
                      </div>
                      <div className="relative flex items-center">
                        <input
                          type="range"
                          min="0.5"
                          max="1.5"
                          step="0.05"
                          value={globalDefaults.dubbing.pitch ?? 1.0}
                          onChange={(e) => handleUpdateGlobalDubbing({ pitch: parseFloat(e.target.value) })}
                          className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                        <span>Trầm</span>
                        <span>Bổng</span>
                      </div>
                    </div>

                    {/* Volume Slider */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                          <Volume2 className="w-3.5 h-3.5 text-textMuted" />
                          <span>Âm lượng</span>
                        </span>
                        <span className="font-mono text-accent font-semibold">
                          {Math.round((globalDefaults.dubbing.volume ?? 1.0) * 100)}%
                        </span>
                      </div>
                      <div className="relative flex items-center">
                        <input
                          type="range"
                          min="0"
                          max="2.0"
                          step="0.05"
                          value={globalDefaults.dubbing.volume ?? 1.0}
                          onChange={(e) => handleUpdateGlobalDubbing({ volume: parseFloat(e.target.value) })}
                          className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                        <span>0%</span>
                        <span>200%</span>
                      </div>
                    </div>

                    {/* Khớp thời gian file gốc */}
                    <div className="pt-2 border-t border-borderDefault/40">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-textSecondary font-medium select-none flex items-center gap-1.5">
                          <Zap className={`w-3.5 h-3.5 ${(globalDefaults.dubbing.autoFit ?? true) ? "text-accent" : "text-textMuted"}`} />
                          <span>Khớp thời gian file gốc</span>
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={globalDefaults.dubbing.autoFit ?? true}
                          onClick={() =>
                            handleUpdateGlobalDubbing({ autoFit: !(globalDefaults.dubbing.autoFit ?? true) })
                          }
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            (globalDefaults.dubbing.autoFit ?? true) ? "bg-accent" : "bg-surface3"
                          }`}
                          title={`Khớp thời gian file gốc: ${(globalDefaults.dubbing.autoFit ?? true) ? "Bật (ON)" : "Tắt (OFF)"}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                              (globalDefaults.dubbing.autoFit ?? true) ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 4. NGẮT NGHỈ (Punctuation Pauses Accordion) */}
                  <div className="pt-2 border-t border-borderDefault/60">
                    <button
                      type="button"
                      onClick={() => setDubbingPausesOpen(!dubbingPausesOpen)}
                      className="w-full flex items-center justify-between py-1.5 px-1 rounded-md text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-surface2/40 outline-none focus:outline-none transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-accent" />
                        <span className="uppercase tracking-wider font-bold">
                          Ngắt nghỉ
                        </span>
                      </div>
                      <ChevronRight
                        className={`w-3.5 h-3.5 transition-transform duration-200 ${
                          dubbingPausesOpen ? "rotate-90" : ""
                        }`}
                      />
                    </button>

                    {dubbingPausesOpen && (
                      <div className="space-y-3 pt-2">
                        <div className="grid grid-cols-2 gap-3">
                          {/* Dấu phẩy ( , ) */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              Dấu phẩy ( , )
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.1"
                                max="3.0"
                                step="0.1"
                                value={globalDefaults.dubbing.pauses?.comma ?? 0.5}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0.1;
                                  const base = globalDefaults.dubbing.pauses || { comma: 0.5, period: 0.5, questionExclamation: 1.0, colonSemicolon: 0.6 };
                                  handleUpdateGlobalDubbing({
                                    pauses: { ...base, comma: val },
                                  });
                                }}
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                giây
                              </span>
                            </div>
                          </div>

                          {/* Dấu chấm ( . ) */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              Dấu chấm ( . )
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.2"
                                max="5.0"
                                step="0.1"
                                value={globalDefaults.dubbing.pauses?.period ?? 0.5}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0.2;
                                  const base = globalDefaults.dubbing.pauses || { comma: 0.5, period: 0.5, questionExclamation: 1.0, colonSemicolon: 0.6 };
                                  handleUpdateGlobalDubbing({
                                    pauses: { ...base, period: val },
                                  });
                                }}
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                giây
                              </span>
                            </div>
                          </div>

                          {/* Hỏi / Than ( ? ! ) */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              Hỏi / Than ( ? ! )
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.2"
                                max="5.0"
                                step="0.1"
                                value={globalDefaults.dubbing.pauses?.questionExclamation ?? 1.0}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0.2;
                                  const base = globalDefaults.dubbing.pauses || { comma: 0.5, period: 0.5, questionExclamation: 1.0, colonSemicolon: 0.6 };
                                  handleUpdateGlobalDubbing({
                                    pauses: { ...base, questionExclamation: val },
                                  });
                                }}
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                giây
                              </span>
                            </div>
                          </div>

                          {/* Hai chấm ( : ; ) */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              Hai chấm ( : ; )
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.1"
                                max="3.0"
                                step="0.1"
                                value={globalDefaults.dubbing.pauses?.colonSemicolon ?? 0.6}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0.1;
                                  const base = globalDefaults.dubbing.pauses || { comma: 0.5, period: 0.5, questionExclamation: 1.0, colonSemicolon: 0.6 };
                                  handleUpdateGlobalDubbing({
                                    pauses: { ...base, colonSemicolon: val },
                                  });
                                }}
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                giây
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-borderDefault bg-surface1 flex items-center justify-between flex-shrink-0">
              <div className="text-[11px] text-textMuted">
                {selectedJobIds.size > 0 && (
                  <span>Áp dụng cấu hình cho {selectedJobIds.size} tệp đã chọn.</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleApplyDefaultsToSelected}
                  disabled={selectedJobIds.size === 0}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    selectedJobIds.size === 0
                      ? "text-textMuted/40 border border-borderDefault/40 bg-surface2/40 cursor-not-allowed"
                      : "text-accent hover:bg-accent/10 border border-accent/30 cursor-pointer"
                  }`}
                >
                  {selectedJobIds.size > 0 ? `Áp dụng cho ${selectedJobIds.size} tệp đã chọn` : "Áp dụng"}
                </button>
                <button
                  onClick={() => setIsGlobalModalOpen(false)}
                  className="px-4 py-1.5 text-xs font-bold text-slate-950 bg-accent hover:bg-accentHover rounded-lg transition-colors cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4.1 MODAL: CHỌN GIỌNG ĐỌC (VOICE SELECTION MODAL) */}
      {isTtsVoiceModalOpen && (
        <div className="relative z-[60]">
          <VoiceSelectionModal
            isOpen={isTtsVoiceModalOpen}
            onClose={() => setIsTtsVoiceModalOpen(false)}
            voices={MOCK_VOICES}
            activeVoiceId={activeTtsVoice.id}
            onSelectVoice={(voice) => {
              setGlobalDefaults((prev) => ({
                ...prev,
                tts: { ...prev.tts, voice: voice.name },
              }));
              setIsTtsVoiceModalOpen(false);
            }}
          />
        </div>
      )}

      {/* 4.2 MODAL: CHỌN GIỌNG LỒNG TIẾNG (DUBBING VOICE SELECTION MODAL) */}
      {isDubbingVoiceModalOpen && (
        <div className="relative z-[60]">
          <VoiceSelectionModal
            isOpen={isDubbingVoiceModalOpen}
            onClose={() => setIsDubbingVoiceModalOpen(false)}
            voices={MOCK_VOICES}
            activeVoiceId={activeDubbingVoice.id}
            onSelectVoice={(voice) => {
              handleUpdateGlobalDubbing({ voice: voice.name });
              setIsDubbingVoiceModalOpen(false);
            }}
          />
        </div>
      )}

      {/* 4.4 MODAL: CHỌN GIỌNG NÂNG CAO TỪNG TỆP / NHÂN VẬT (PER-FILE / CHARACTER VOICE MODAL) */}
      {voiceModalTarget && (
        <div className="relative z-[70]">
          <VoiceSelectionModal
            isOpen={!!voiceModalTarget}
            onClose={() => setVoiceModalTarget(null)}
            voices={(() => {
              if (voiceModalTarget.taskType === "dialogue" || voiceModalTarget.charId) {
                const targetJob = jobs.find((j) => j.id === voiceModalTarget.jobId);
                const currentModel = ((targetJob?.configOverrides as Record<string, any>)?.dialogue?.model) ?? globalDefaults.dialogue.model;
                return MOCK_VOICES.filter((v) => !v.modelCompatibility || v.modelCompatibility.includes(currentModel));
              }
              return MOCK_VOICES;
            })()}
            activeVoiceId={(() => {
              const targetJob = jobs.find((j) => j.id === voiceModalTarget.jobId);
              if (voiceModalTarget.charId) {
                const effective = resolveEffectiveCharacterVoice(
                  voiceModalTarget.charId,
                  targetJob || ({} as any),
                  globalDefaults,
                  ((targetJob?.configOverrides as Record<string, any>)?.dialogue?.model) ?? globalDefaults.dialogue.model,
                  MOCK_VOICES
                );
                return effective.voiceProfile?.id || MOCK_VOICES[0]?.id;
              }
              if (voiceModalTarget.taskType === "tts") {
                const vName = ((targetJob?.configOverrides as Record<string, any>)?.tts?.voice) || globalDefaults.tts.voice;
                return MOCK_VOICES.find((v) => v.name === vName || v.id === vName)?.id || MOCK_VOICES[0]?.id;
              }
              if (voiceModalTarget.taskType === "dubbing") {
                const vName = ((targetJob?.configOverrides as Record<string, any>)?.dubbing?.voice) || globalDefaults.dubbing.voice;
                return MOCK_VOICES.find((v) => v.name === vName || v.id === vName)?.id || MOCK_VOICES[0]?.id;
              }
              return MOCK_VOICES[0]?.id;
            })()}
            onSelectVoice={(voice) => {
              if (voiceModalTarget.charId) {
                setDraftCharacterVoices((prev) => ({
                  ...prev,
                  [voiceModalTarget.charId!]: voice.name,
                }));
                const targetJob = jobs.find((j) => j.id === voiceModalTarget.jobId);
                const prevVoices = { ...((targetJob?.configOverrides as Record<string, any>)?.dialogue?.characterVoices || {}) };
                prevVoices[voiceModalTarget.charId] = voice.name;
                handleUpdateJobTaskConfig(voiceModalTarget.jobId, "dialogue", {
                  characterVoices: prevVoices,
                });
                setNotification({
                  id: `char-voice-${Date.now()}`,
                  type: "success",
                  message: `Đã chọn giọng "${voice.name}" cho nhân vật.`,
                });
              } else if (voiceModalTarget.taskType === "dialogue") {
                handleUpdateJobTaskConfig(voiceModalTarget.jobId, "dialogue", {
                  defaultVoice: voice.name,
                });
              } else if (voiceModalTarget.taskType === "tts") {
                handleUpdateJobTaskConfig(voiceModalTarget.jobId, "tts", {
                  voice: voice.name,
                });
              } else if (voiceModalTarget.taskType === "dubbing") {
                handleUpdateJobTaskConfig(voiceModalTarget.jobId, "dubbing", {
                  voice: voice.name,
                });
              }
              setVoiceModalTarget(null);
            }}
          />
        </div>
      )}

      {/* 4.5 MODAL: QUẢN LÝ TỪ ĐIỂN PHÁT ÂM (PRONUNCIATION MANAGER MODAL) */}
      {isPronunciationModalOpen && (
        <div className="relative z-[80]">
          <PronunciationManagerModal
            isOpen={isPronunciationModalOpen}
            onClose={() => setIsPronunciationModalOpen(false)}
            projectId="global"
            onRulesUpdated={() => {
              setGlobalPronunciationRules(loadGlobalRules());
            }}
          />
        </div>
      )}

      {/* ========================================================= */}
      {/* 5. PER-FILE ADVANCED DRAWER (SLIDE-OVER)                 */}
      {/* ========================================================= */}
      {activeDrawerJob && (
        <div className="fixed inset-y-0 right-0 z-50 w-[420px] bg-panel border-l border-borderDefault shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
          {/* Drawer Header */}
          <div className="p-4 border-b border-borderDefault bg-surface1 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                {renderFileIcon(activeDrawerJob.fileKind)}
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-textPrimary truncate" title={activeDrawerJob.fileName}>
                    {activeDrawerJob.fileName}
                  </h4>
                  <div className="text-[10px] text-textMuted">
                    {activeDrawerJob.fileSize} • {activeDrawerJob.fileKind.toUpperCase()}
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setActiveDrawerJobId(null);
                  setIsPlayingPreview(false);
                }}
                className="p-1 text-textMuted hover:text-textPrimary rounded-md hover:bg-surface2 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Tabs: Cấu hình vs Xem kết quả */}
            <div className="flex items-center gap-1 bg-surface2 p-1 rounded-lg border border-borderDefault text-xs">
              <button
                onClick={() => setActiveDrawerTab("config")}
                className={`flex-1 py-1.5 text-center rounded-md font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeDrawerTab === "config"
                    ? "bg-surface1 text-textPrimary shadow-2xs"
                    : "text-textMuted hover:text-textPrimary"
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Cấu hình</span>
              </button>

              <button
                onClick={() => setActiveDrawerTab("preview")}
                className={`flex-1 py-1.5 text-center rounded-md font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeDrawerTab === "preview"
                    ? "bg-surface1 text-accent shadow-2xs"
                    : "text-textMuted hover:text-textPrimary"
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Xem kết quả</span>
                {(activeDrawerJob.outputArtifacts?.audioPath || (activeDrawerJob.outputArtifacts?.subtitles && activeDrawerJob.outputArtifacts.subtitles.length > 0)) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                )}
              </button>
            </div>
          </div>

          {/* TAB CONTENT: CẤU HÌNH */}
          {activeDrawerTab === "config" && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Drawer Override Notice */}
              {(() => {
                const drawerDiff = computeJobConfigDiff(activeDrawerJob);
                return (
                  <>
                    <div className="px-4 py-2 bg-surface2/60 border-b border-borderDefault flex items-center justify-between text-xs flex-shrink-0">
                      <span className="text-[11px] text-textMuted">
                        {activeDrawerJob.hasCustomConfig ? (
                          <span className="text-accent font-semibold flex items-center gap-1">
                            <span>● Đã tùy chỉnh riêng cho tệp</span>
                          </span>
                        ) : (
                          <span>Đang kế thừa cấu hình gốc của tệp</span>
                        )}
                      </span>

                      {activeDrawerJob.hasCustomConfig && (
                        <button
                          onClick={() => handleRestoreJobToSnapshot(activeDrawerJob.id)}
                          className="text-[11px] text-accent hover:text-accentHover font-medium underline cursor-pointer"
                          title="Khôi phục về đúng snapshot lúc chạy"
                        >
                          Khôi phục Snapshot gốc
                        </button>
                      )}
                    </div>

                    {/* Drawer Content: Output Settings + Active tasks for this file */}
                    <div className="p-4 flex-1 overflow-y-auto space-y-4 text-xs">
                      {activeDrawerJob.stage === "queued" && activeDrawerJob.status === "processing" && (
                        <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-[11px]">
                          🔒 Tệp đang trong luồng xử lý. Cấu hình đã được đóng băng Snapshot và chỉ đọc.
                        </div>
                      )}

                      {/* 3-Way Diff Status Banner for Failed / Completed Jobs */}
                      {activeDrawerJob.status === "failed" ||
                      activeDrawerJob.status === "failed_with_artifact" ||
                      activeDrawerJob.status === "cancelled" ||
                      activeDrawerJob.status === "interrupted" ? (
                        <div
                          className={`p-2.5 rounded-lg text-[11px] border ${
                            !drawerDiff.isConfigChanged
                              ? "bg-surface2 border-borderDefault text-textMuted"
                              : drawerDiff.aiConfigChanged
                              ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                          }`}
                        >
                          {!drawerDiff.isConfigChanged ? (
                            <div>
                              <div className="font-bold flex items-center gap-1 text-accent">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>ℹ️ Cấu hình khớp chính xác Snapshot lúc chạy</span>
                              </div>
                              <div className="mt-0.5 text-[10px] opacity-90">
                                Nút trên bảng là <strong>[Thử lại]</strong> (tái sử dụng snapshot cũ, tiếp tục từ bước lỗi).
                              </div>
                            </div>
                          ) : drawerDiff.aiConfigChanged ? (
                            <div>
                              <div className="font-bold flex items-center gap-1">
                                <Zap className="w-3.5 h-3.5 text-amber-400" />
                                <span>⚡ Cấu hình AI đã thay đổi so với Snapshot lúc chạy</span>
                              </div>
                              <div className="mt-0.5 text-[10px] opacity-90">
                                Nút trên bảng là <strong>[Tạo lại]</strong> (chạy lại từ bước [{drawerDiff.invalidatedFromStep || 'lỗi'}] theo Invalidation Graph).
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="font-bold flex items-center gap-1">
                                <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
                                <span>⚡ Chỉ thay đổi cấu hình xuất tệp (Thư mục / Định dạng)</span>
                              </div>
                              <div className="mt-0.5 text-[10px] opacity-90">
                                {drawerDiff.canReuseArtifacts
                                  ? "Nút trên bảng là [Xuất lại] (tái sử dụng artifact đã có, không chạy lại AI)."
                                  : "Chưa có đủ artifact hợp lệ ➔ Nút trên bảng là [Tạo lại] (chạy từ bước sinh artifact)."}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}

                      {/* Output Settings Card */}
                      <div className="p-3 bg-surface1 rounded-xl border border-borderDefault space-y-2.5">
                        <div className="font-bold text-textPrimary flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <FolderOpen className="w-3.5 h-3.5 text-accent" />
                            <span>Cấu hình Xuất tệp & Lưu trữ</span>
                          </span>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 pb-1">
                            <input
                              type="checkbox"
                              id={`drawer-saveInSourceFolder-${activeDrawerJob.id}`}
                              checked={!!getJobWorkingConfig(activeDrawerJob).saveInSourceFolder}
                              onChange={(e) =>
                                handleUpdateJobOutputConfig(activeDrawerJob.id, {
                                  saveInSourceFolder: e.target.checked,
                                })
                              }
                              disabled={activeDrawerJob.status === "processing"}
                              className="rounded border-borderDefault text-accent focus:ring-0 cursor-pointer disabled:opacity-50"
                            />
                            <label
                              htmlFor={`drawer-saveInSourceFolder-${activeDrawerJob.id}`}
                              className="text-xs text-textSecondary cursor-pointer select-none"
                            >
                              Lưu cùng thư mục với tệp gốc
                            </label>
                          </div>
                          <div>
                            <label className="text-[10px] text-textMuted block mb-1">Thư mục xuất kết quả</label>
                            <input
                              type="text"
                              value={getJobWorkingConfig(activeDrawerJob).outputPath || ""}
                              onChange={(e) =>
                                handleUpdateJobOutputConfig(activeDrawerJob.id, { outputPath: e.target.value })
                              }
                              disabled={
                                activeDrawerJob.status === "processing" ||
                                !!getJobWorkingConfig(activeDrawerJob).saveInSourceFolder
                              }
                              className="w-full px-2.5 py-1.5 bg-surface2 border border-borderDefault rounded-lg text-textPrimary text-xs focus:outline-hidden focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-[10px] text-textMuted block mb-1">Xử lý trùng tên</label>
                              <select
                                value={getJobWorkingConfig(activeDrawerJob).collisionPolicy || "auto_rename"}
                                onChange={(e) =>
                                  handleUpdateJobOutputConfig(activeDrawerJob.id, {
                                    collisionPolicy: e.target.value as any,
                                  })
                                }
                                disabled={activeDrawerJob.status === "processing"}
                                className="w-full px-2 py-1.5 bg-surface2 border border-borderDefault rounded-lg text-textPrimary text-xs disabled:opacity-50"
                              >
                                <option value="auto_rename">Tự đổi tên</option>
                                <option value="overwrite">Ghi đè</option>
                                <option value="skip">Bỏ qua</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-textMuted block mb-1">Âm thanh</label>
                              <select
                                value={getJobWorkingConfig(activeDrawerJob).outputAudioFormat || "wav"}
                                onChange={(e) =>
                                  handleUpdateJobOutputConfig(activeDrawerJob.id, {
                                    outputAudioFormat: e.target.value as any,
                                  })
                                }
                                disabled={activeDrawerJob.status === "processing"}
                                className="w-full px-2 py-1.5 bg-surface2 border border-borderDefault rounded-lg text-textPrimary text-xs disabled:opacity-50"
                              >
                                <option value="wav">WAV</option>
                                <option value="mp3">MP3</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-textMuted block mb-1">Phụ đề</label>
                              <select
                                value={getJobWorkingConfig(activeDrawerJob).outputSubtitleFormat || "srt"}
                                onChange={(e) =>
                                  handleUpdateJobOutputConfig(activeDrawerJob.id, {
                                    outputSubtitleFormat: e.target.value as any,
                                  })
                                }
                                disabled={activeDrawerJob.status === "processing"}
                                className="w-full px-2 py-1.5 bg-surface2 border border-borderDefault rounded-lg text-textPrimary text-xs disabled:opacity-50"
                              >
                                <option value="srt">SRT</option>
                                <option value="vtt">VTT</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>

                      {activeDrawerJob.selectedTasks.length === 0 ? (
                        <div className="text-center py-8 text-textMuted">
                          Tệp này chưa bật tác vụ nào. Hãy tích chọn tác vụ trên bảng để tùy chỉnh.
                        </div>
                      ) : (
                        activeDrawerJob.selectedTasks.map((task) => (
                          <div key={task} className="p-3 bg-surface1 rounded-xl border border-borderDefault space-y-2.5">
                            <div className="font-bold text-textPrimary capitalize flex items-center justify-between">
                              <span>
                                {task === "transcription"
                                  ? "Phụ đề (ASR)"
                                  : task === "translation"
                                  ? "Dịch thuật"
                                  : task === "dubbing"
                                  ? "Lồng tiếng"
                                  : task === "dialogue"
                                  ? "Hội thoại"
                                  : "TTS Đơn giọng"}
                              </span>
                              <span className="text-[10px] text-accent font-mono">BẬT</span>
                            </div>

                            {task === "tts" && (
                              <div className="space-y-3">
                                <div>
                                  <label className="block text-[11px] text-textMuted mb-1">Mô hình TTS</label>
                                  <select
                                    disabled={activeDrawerJob.status === "processing"}
                                    value={((activeDrawerJob.configOverrides as Record<string, any>)?.tts?.model) ?? globalDefaults.tts.model}
                                    onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "tts", { model: e.target.value })}
                                    className="w-full px-2.5 py-1.5 bg-surface2 border border-borderDefault rounded-md text-textPrimary text-xs disabled:opacity-50 cursor-pointer"
                                  >
                                    <option value="Omni Voice">Omni Voice</option>
                                    <option value="Chatterbox Turbo">Chatterbox Turbo</option>
                                    <option value="Qwen 1.7B">Qwen 1.7B</option>
                                  </select>
                                </div>

                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <label className="text-[11px] text-textMuted">Giọng đọc riêng</label>
                                    <button
                                      type="button"
                                      disabled={activeDrawerJob.status === "processing"}
                                      onClick={() => setVoiceModalTarget({ jobId: activeDrawerJob.id, taskType: "tts" })}
                                      className="text-[11px] text-accent hover:text-accentHover font-medium underline cursor-pointer disabled:opacity-50"
                                    >
                                      Thư viện giọng
                                    </button>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <select
                                      disabled={activeDrawerJob.status === "processing"}
                                      value={((activeDrawerJob.configOverrides as Record<string, any>)?.tts?.voice) ?? globalDefaults.tts.voice}
                                      onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "tts", { voice: e.target.value })}
                                      className="flex-1 px-2.5 py-1.5 bg-surface2 border border-borderDefault rounded-md text-textPrimary text-xs disabled:opacity-50 cursor-pointer truncate"
                                    >
                                      {MOCK_VOICES.map((v) => (
                                        <option key={v.id} value={v.name}>{v.name}</option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => handlePlayVoicePreview(((activeDrawerJob.configOverrides as Record<string, any>)?.tts?.voice) ?? globalDefaults.tts.voice)}
                                      className="p-1.5 text-textMuted hover:text-accent bg-surface2 hover:bg-surface3 border border-borderDefault rounded-md cursor-pointer transition-colors"
                                      title="Nghe thử giọng"
                                    >
                                      <Play className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-borderDefault/40">
                                  <div>
                                    <div className="flex items-center justify-between text-[10px] text-textMuted mb-0.5">
                                      <span>Tốc độ</span>
                                      <span className="font-mono text-accent font-semibold">
                                        {(((activeDrawerJob.configOverrides as Record<string, any>)?.tts?.speed) ?? globalDefaults.tts.speed).toFixed(2)}x
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0.5"
                                      max="1.5"
                                      step="0.05"
                                      disabled={activeDrawerJob.status === "processing"}
                                      value={((activeDrawerJob.configOverrides as Record<string, any>)?.tts?.speed) ?? globalDefaults.tts.speed}
                                      onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "tts", { speed: parseFloat(e.target.value) })}
                                      className="w-full accent-accent bg-surface3 h-1 rounded-full appearance-none cursor-pointer"
                                    />
                                  </div>
                                  <div>
                                    <div className="flex items-center justify-between text-[10px] text-textMuted mb-0.5">
                                      <span>Cao độ</span>
                                      <span className="font-mono text-accent font-semibold">
                                        {(((activeDrawerJob.configOverrides as Record<string, any>)?.tts?.pitch) ?? globalDefaults.tts.pitch).toFixed(2)}
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0.5"
                                      max="1.5"
                                      step="0.05"
                                      disabled={activeDrawerJob.status === "processing"}
                                      value={((activeDrawerJob.configOverrides as Record<string, any>)?.tts?.pitch) ?? globalDefaults.tts.pitch}
                                      onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "tts", { pitch: parseFloat(e.target.value) })}
                                      className="w-full accent-accent bg-surface3 h-1 rounded-full appearance-none cursor-pointer"
                                    />
                                  </div>
                                </div>
                              </div>
                            )}

                            {task === "dialogue" && (() => {
                              const dialogueWorking = getJobWorkingConfig(activeDrawerJob).dialogue || globalDefaults.dialogue;
                              const currentDialogueModel = dialogueWorking.model || "Omni Voice";
                              const rawScript = activeDrawerJob.scriptContent || DEFAULT_SAMPLE_DIALOGUE_SCRIPT;
                              const parseResult = parseDialogueScript(rawScript);
                              const compatibleVoices = MOCK_VOICES.filter(
                                (v) => !v.modelCompatibility || v.modelCompatibility.includes(currentDialogueModel)
                              );

                              return (
                                <div className="space-y-3.5">
                                  {/* Mô hình Hội thoại & Giọng mặc định file */}
                                  <div className="space-y-2.5">
                                    <div>
                                      <label className="block text-[11px] text-textMuted mb-1">Mô hình Hội thoại</label>
                                      <select
                                        disabled={activeDrawerJob.status === "processing"}
                                        value={((activeDrawerJob.configOverrides as Record<string, any>)?.dialogue?.model) ?? globalDefaults.dialogue.model}
                                        onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "dialogue", { model: e.target.value })}
                                        className="w-full px-2.5 py-1.5 bg-surface2 border border-borderDefault rounded-md text-textPrimary text-xs disabled:opacity-50 cursor-pointer"
                                      >
                                        <option value="Omni Voice">Omni Voice</option>
                                        <option value="Chatterbox Turbo">Chatterbox Turbo</option>
                                        <option value="Qwen 1.7B">Qwen 1.7B</option>
                                      </select>
                                    </div>

                                    {/* Giọng mặc định riêng của file (Tier 2 Precedence) */}
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="text-[11px] text-textMuted">Giọng mặc định của tệp</label>
                                        <button
                                          type="button"
                                          disabled={activeDrawerJob.status === "processing"}
                                          onClick={() => setVoiceModalTarget({ jobId: activeDrawerJob.id, taskType: "dialogue" })}
                                          className="text-[11px] text-accent hover:text-accentHover font-medium underline cursor-pointer disabled:opacity-50"
                                        >
                                          Thư viện giọng
                                        </button>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <select
                                          disabled={activeDrawerJob.status === "processing"}
                                          value={((activeDrawerJob.configOverrides as Record<string, any>)?.dialogue?.defaultVoice) ?? globalDefaults.dialogue.defaultVoice}
                                          onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "dialogue", { defaultVoice: e.target.value })}
                                          className="flex-1 px-2.5 py-1.5 bg-surface2 border border-borderDefault rounded-md text-textPrimary text-xs disabled:opacity-50 cursor-pointer truncate"
                                        >
                                          {compatibleVoices.map((v) => (
                                            <option key={v.id} value={v.name}>{v.name}</option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          onClick={() => handlePlayVoicePreview(((activeDrawerJob.configOverrides as Record<string, any>)?.dialogue?.defaultVoice) ?? globalDefaults.dialogue.defaultVoice)}
                                          className="p-1.5 text-textMuted hover:text-accent bg-surface2 hover:bg-surface3 border border-borderDefault rounded-md cursor-pointer transition-colors"
                                          title="Nghe thử giọng mặc định của tệp"
                                        >
                                          <Play className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                      <div className="text-[10px] text-textMuted mt-0.5">
                                        Áp dụng cho nhân vật chưa có giọng riêng khi kịch bản được thực thi.
                                      </div>
                                    </div>
                                  </div>

                                  {/* Bảng gán giọng từng nhân vật */}
                                  <div className="p-3 bg-surface2/60 rounded-xl border border-borderDefault space-y-2.5">
                                    <div className="flex items-center justify-between pb-1.5 border-b border-borderDefault/60">
                                      <div className="flex items-center gap-1.5">
                                        <Users className="w-3.5 h-3.5 text-purple-400" />
                                        <span className="font-bold text-xs text-textPrimary">
                                          Gán giọng nhân vật ({parseResult.characters.length})
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        disabled={activeDrawerJob.status === "processing"}
                                        onClick={() => handleSyncDialogueScript(activeDrawerJob.id)}
                                        className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-accent hover:text-accentHover bg-accent/10 hover:bg-accent/20 rounded border border-accent/30 transition-colors cursor-pointer disabled:opacity-40"
                                        title="Phân tích lại kịch bản, bảo toàn các nhân vật hiện có"
                                      >
                                        <RefreshCw className="w-3 h-3" />
                                        <span>Đồng bộ kịch bản</span>
                                      </button>
                                    </div>

                                    {parseResult.characters.length === 0 ? (
                                      <div className="text-center py-3 text-textMuted text-[11px]">
                                        Không phát hiện nhân vật nào theo cú pháp phân vai <code>[Tên]: Lời thoại</code>.
                                      </div>
                                    ) : (
                                      <div className="space-y-2.5">
                                        {parseResult.characters.map((char) => {
                                          const effective = resolveEffectiveCharacterVoice(
                                            char.id,
                                            activeDrawerJob,
                                            globalDefaults,
                                            currentDialogueModel,
                                            MOCK_VOICES
                                          );

                                          return (
                                            <div
                                              key={char.id}
                                              className="p-2.5 rounded-lg bg-surface1 border border-borderDefault space-y-1.5 hover:border-accent/40 transition-colors"
                                            >
                                              {/* Character Name + Turn count + Precedence source */}
                                              <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                  <span
                                                    className={`px-2 py-0.5 rounded text-[11px] font-bold truncate max-w-[120px] ${char.colorTheme.badgeClass}`}
                                                    title={char.name}
                                                  >
                                                    {char.name}
                                                  </span>
                                                  <span className="text-[10px] text-textMuted font-mono">
                                                    ({char.segmentCount} lượt)
                                                  </span>
                                                </div>

                                                <div className="flex items-center gap-1">
                                                  {effective.source === "character" ? (
                                                    <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/25" title="Ưu tiên 1: Đang sử dụng giọng riêng của nhân vật">
                                                      Giọng riêng
                                                    </span>
                                                  ) : effective.source === "file_custom" ? (
                                                    <span className="text-[10px] font-medium text-sky-400 bg-sky-500/10 px-1.5 py-0.2 rounded border border-sky-500/25" title="Ưu tiên 2: Kế thừa giọng tùy chỉnh của tệp này">
                                                      Mặc định tệp
                                                    </span>
                                                  ) : (
                                                    <span className="text-[10px] text-textMuted bg-surface2 px-1.5 py-0.2 rounded border border-borderDefault/60" title="Ưu tiên 3: Kế thừa giọng mặc định từ Cấu hình chung">
                                                      Mặc định chung
                                                    </span>
                                                  )}

                                                  {effective.source === "character" && (
                                                    <button
                                                      type="button"
                                                      disabled={activeDrawerJob.status === "processing"}
                                                      onClick={() => handleResetCharacterVoice(activeDrawerJob.id, char.id)}
                                                      className="text-[10px] text-textMuted hover:text-accent underline px-1 cursor-pointer disabled:opacity-40"
                                                      title="Khôi phục nhân vật về giọng mặc định của tệp"
                                                    >
                                                      Khôi phục
                                                    </button>
                                                  )}
                                                </div>
                                              </div>

                                              {/* Voice Selection Controls */}
                                              <div className="flex items-center gap-1.5">
                                                <select
                                                  disabled={activeDrawerJob.status === "processing"}
                                                  value={effective.voiceName}
                                                  onChange={(e) => {
                                                    const prevVoices = {
                                                      ...((activeDrawerJob.configOverrides as Record<string, any>)?.dialogue?.characterVoices || {}),
                                                    };
                                                    prevVoices[char.id] = e.target.value;
                                                    handleUpdateJobTaskConfig(activeDrawerJob.id, "dialogue", {
                                                      characterVoices: prevVoices,
                                                    });
                                                  }}
                                                  className="flex-1 px-2 py-1 bg-surface2 border border-borderDefault rounded text-textPrimary text-xs disabled:opacity-50 cursor-pointer truncate"
                                                >
                                                  {compatibleVoices.map((v) => (
                                                    <option key={v.id} value={v.name}>{v.name}</option>
                                                  ))}
                                                </select>

                                                <button
                                                  type="button"
                                                  disabled={activeDrawerJob.status === "processing"}
                                                  onClick={() =>
                                                    setVoiceModalTarget({
                                                      jobId: activeDrawerJob.id,
                                                      charId: char.id,
                                                      taskType: "dialogue",
                                                    })
                                                  }
                                                  className="px-2 py-1 text-[11px] font-semibold text-accent hover:text-accentHover bg-surface2 hover:bg-surface3 border border-borderDefault rounded cursor-pointer transition-colors disabled:opacity-40"
                                                  title="Mở Thư viện giọng để tìm kiếm nâng cao"
                                                >
                                                  Chọn...
                                                </button>

                                                <button
                                                  type="button"
                                                  onClick={() => handlePlayVoicePreview(effective.voiceName)}
                                                  className="p-1 text-textMuted hover:text-accent bg-surface2 hover:bg-surface3 border border-borderDefault rounded cursor-pointer transition-colors"
                                                  title={`Nghe thử giọng "${effective.voiceName}"`}
                                                >
                                                  <Play className="w-3.5 h-3.5" />
                                                </button>
                                              </div>

                                              {/* Incompatible Warning Banner */}
                                              {!effective.isCompatible && (
                                                <div className="p-1.5 bg-amber-500/10 border border-amber-500/25 rounded text-[10px] text-amber-300 font-medium flex items-center gap-1">
                                                  <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                                  <span>{effective.warning}</span>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>

                                  {/* Thông số Hội thoại (Ngắt nghỉ & Xuất SRT) */}
                                  <div className="space-y-2 pt-2 border-t border-borderDefault/40">
                                    <div className="flex items-center justify-between">
                                      <label className="text-[11px] text-textMuted">Khoảng lặng chuyển lượt</label>
                                      <span className="font-mono text-accent text-[11px] font-semibold">
                                        {((activeDrawerJob.configOverrides as Record<string, any>)?.dialogue?.turnPauseSec ?? globalDefaults.dialogue.turnPauseSec ?? 0.4)}s
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0.1"
                                      max="2.0"
                                      step="0.05"
                                      disabled={activeDrawerJob.status === "processing"}
                                      value={((activeDrawerJob.configOverrides as Record<string, any>)?.dialogue?.turnPauseSec ?? globalDefaults.dialogue.turnPauseSec ?? 0.4)}
                                      onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "dialogue", { turnPauseSec: parseFloat(e.target.value) })}
                                      className="w-full accent-accent bg-surface3 h-1 rounded-full appearance-none cursor-pointer"
                                    />

                                    <div className="flex items-center justify-between pt-1">
                                      <label className="text-[11px] text-textSecondary cursor-pointer select-none">Xuất kèm file phụ đề (.srt)</label>
                                      <input
                                        type="checkbox"
                                        disabled={activeDrawerJob.status === "processing"}
                                        checked={((activeDrawerJob.configOverrides as Record<string, any>)?.dialogue?.exportSrt ?? globalDefaults.dialogue.exportSrt ?? true)}
                                        onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "dialogue", { exportSrt: e.target.checked })}
                                        className="rounded border-borderDefault text-accent focus:ring-0 cursor-pointer"
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}

                            {task === "transcription" && (
                              <div className="space-y-3">
                                <div>
                                  <label className="block text-[11px] text-textMuted mb-1">Mô hình ASR (Whisper)</label>
                                  <select
                                    disabled={activeDrawerJob.status === "processing"}
                                    value={((activeDrawerJob.configOverrides as Record<string, any>)?.transcription?.whisperModel) ?? globalDefaults.transcription.whisperModel}
                                    onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "transcription", { whisperModel: e.target.value })}
                                    className="w-full px-2.5 py-1.5 bg-surface2 border border-borderDefault rounded-md text-textPrimary text-xs disabled:opacity-50 cursor-pointer"
                                  >
                                    <option value="large-v3-turbo">large-v3-turbo (Nhanh & Chính xác)</option>
                                    <option value="large-v3">large-v3 (Chuẩn)</option>
                                    <option value="medium">medium</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[11px] text-textMuted mb-1">Ngôn ngữ bóc băng</label>
                                  <SearchableLanguageSelect
                                    disabled={activeDrawerJob.status === "processing"}
                                    value={((activeDrawerJob.configOverrides as Record<string, any>)?.transcription?.audioLanguage) ?? globalDefaults.transcription.audioLanguage}
                                    onChange={(code) => handleUpdateJobTaskConfig(activeDrawerJob.id, "transcription", { audioLanguage: code })}
                                    languages={WHISPER_AUDIO_LANGUAGES}
                                    searchPlaceholder="Tìm ngôn ngữ bóc băng..."
                                    size="sm"
                                  />
                                </div>
                              </div>
                            )}

                            {task === "translation" && (
                              <div className="space-y-3">
                                <div>
                                  <label className="block text-[11px] text-textMuted mb-1">Mô hình Dịch</label>
                                  <select
                                    disabled={activeDrawerJob.status === "processing"}
                                    value={((activeDrawerJob.configOverrides as Record<string, any>)?.translation?.provider) ?? globalDefaults.translation.provider}
                                    onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "translation", { provider: e.target.value })}
                                    className="w-full px-2.5 py-1.5 bg-surface2 border border-borderDefault rounded-md text-textPrimary text-xs disabled:opacity-50 cursor-pointer"
                                  >
                                    {availableTranslationProviders.map((p) => (
                                      <option key={p.id} value={p.id}>{p.displayName} ({p.badge})</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[11px] text-textMuted mb-1">Phong cách Dịch</label>
                                  <select
                                    disabled={activeDrawerJob.status === "processing"}
                                    value={((activeDrawerJob.configOverrides as Record<string, any>)?.translation?.style) ?? globalDefaults.translation.style}
                                    onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "translation", { style: e.target.value as any })}
                                    className="w-full px-2.5 py-1.5 bg-surface2 border border-borderDefault rounded-md text-textPrimary text-xs disabled:opacity-50 cursor-pointer"
                                  >
                                    <option value="default">Mặc định</option>
                                    <option value="cinema">Điện ảnh (Phim ảnh)</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[11px] text-textMuted mb-1">Ngôn ngữ dịch đích</label>
                                  <SearchableLanguageSelect
                                    disabled={activeDrawerJob.status === "processing"}
                                    value={((activeDrawerJob.configOverrides as Record<string, any>)?.translation?.targetLanguage) ?? globalDefaults.translation.targetLanguage}
                                    onChange={(code) => handleUpdateJobTaskConfig(activeDrawerJob.id, "translation", { targetLanguage: code })}
                                    languages={TRANSLATION_TARGET_LANGUAGES}
                                    searchPlaceholder="Tìm ngôn ngữ dịch đích..."
                                    size="sm"
                                  />
                                </div>
                              </div>
                            )}

                            {task === "dubbing" && (
                              <div className="space-y-3">
                                <div>
                                  <label className="block text-[11px] text-textMuted mb-1">Mô hình Lồng tiếng</label>
                                  <select
                                    disabled={activeDrawerJob.status === "processing"}
                                    value={((activeDrawerJob.configOverrides as Record<string, any>)?.dubbing?.ttsModel) ?? globalDefaults.dubbing.ttsModel}
                                    onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "dubbing", { ttsModel: e.target.value })}
                                    className="w-full px-2.5 py-1.5 bg-surface2 border border-borderDefault rounded-md text-textPrimary text-xs disabled:opacity-50 cursor-pointer"
                                  >
                                    <option value="Omni Voice">Omni Voice</option>
                                    <option value="Chatterbox Turbo">Chatterbox Turbo</option>
                                    <option value="Qwen 1.7B">Qwen 1.7B</option>
                                  </select>
                                </div>

                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <label className="text-[11px] text-textMuted">Giọng lồng tiếng</label>
                                    <button
                                      type="button"
                                      disabled={activeDrawerJob.status === "processing"}
                                      onClick={() => setVoiceModalTarget({ jobId: activeDrawerJob.id, taskType: "dubbing" })}
                                      className="text-[11px] text-accent hover:text-accentHover font-medium underline cursor-pointer disabled:opacity-50"
                                    >
                                      Thư viện giọng
                                    </button>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <select
                                      disabled={activeDrawerJob.status === "processing"}
                                      value={((activeDrawerJob.configOverrides as Record<string, any>)?.dubbing?.voice) ?? globalDefaults.dubbing.voice}
                                      onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "dubbing", { voice: e.target.value })}
                                      className="flex-1 px-2.5 py-1.5 bg-surface2 border border-borderDefault rounded-md text-textPrimary text-xs disabled:opacity-50 cursor-pointer truncate"
                                    >
                                      {MOCK_VOICES.map((v) => (
                                        <option key={v.id} value={v.name}>{v.name}</option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => handlePlayVoicePreview(((activeDrawerJob.configOverrides as Record<string, any>)?.dubbing?.voice) ?? globalDefaults.dubbing.voice)}
                                      className="p-1.5 text-textMuted hover:text-accent bg-surface2 hover:bg-surface3 border border-borderDefault rounded-md cursor-pointer transition-colors"
                                      title="Nghe thử giọng lồng tiếng"
                                    >
                                      <Play className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-[11px] text-textMuted mb-1">Tốc độ lồng tiếng tối đa</label>
                                  <select
                                    disabled={activeDrawerJob.status === "processing"}
                                    value={((activeDrawerJob.configOverrides as Record<string, any>)?.dubbing?.speedMultiplier) ?? globalDefaults.dubbing.speedMultiplier}
                                    onChange={(e) => handleUpdateJobTaskConfig(activeDrawerJob.id, "dubbing", { speedMultiplier: parseFloat(e.target.value) })}
                                    className="w-full px-2.5 py-1.5 bg-surface2 border border-borderDefault rounded-md text-textPrimary text-xs disabled:opacity-50 cursor-pointer"
                                  >
                                    <option value="1.15">1.15x (Khuyên dùng)</option>
                                    <option value="1.2">1.20x (Trần an toàn)</option>
                                    <option value="1">1.00x (Chuẩn)</option>
                                  </select>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* TAB CONTENT: XEM KẾT QUẢ (AUDIO PLAYER & SUBTITLE VIEWER) */}
          {activeDrawerTab === "preview" && (
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 space-y-4">
              {/* Audio Player Card */}
              {activeDrawerJob.outputArtifacts?.audioPath ? (
                <div className="p-4 bg-surface1 rounded-2xl border border-borderDefault space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-textPrimary flex items-center gap-1.5">
                      <Music className="w-4 h-4 text-accent" />
                      <span>Audio Master Output (.wav)</span>
                    </span>
                    <span className="text-[10px] text-textMuted font-mono">
                      {Math.floor(previewPlaybackTime / 60)}:{(previewPlaybackTime % 60).toString().padStart(2, "0")} / 01:24
                    </span>
                  </div>

                  {/* Scrub Slider */}
                  {(() => {
                    const maxSec = activeDrawerJob.outputArtifacts.audioDuration || 84;
                    const progressPct = maxSec > 0 ? Math.min(100, Math.max(0, (previewPlaybackTime / maxSec) * 100)) : 0;
                    return (
                      <input
                        type="range"
                        min="0"
                        max={maxSec}
                        value={previewPlaybackTime}
                        onChange={(e) => setPreviewPlaybackTime(parseInt(e.target.value) || 0)}
                        style={{
                          background: `linear-gradient(to right, var(--theme-accent) 0%, var(--theme-accent) ${progressPct}%, var(--theme-surface3) ${progressPct}%, var(--theme-surface3) 100%)`,
                        }}
                        className="w-full accent-accent h-1.5 rounded-full appearance-none cursor-pointer outline-none border-none focus:outline-none focus:ring-0 focus:border-none"
                      />
                    );
                  })()}

                  {/* Player Controls */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsPlayingPreview(!isPlayingPreview)}
                        className="w-8 h-8 rounded-full bg-accent text-slate-950 flex items-center justify-center hover:bg-accentHover transition-colors shadow-sm cursor-pointer"
                        title={isPlayingPreview ? "Tạm dừng" : "Phát audio"}
                      >
                        {isPlayingPreview ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                      </button>
                      <button
                        onClick={() => setPreviewPlaybackTime(0)}
                        className="p-1.5 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface2 transition-colors cursor-pointer"
                        title="Phát lại từ đầu"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Volume Slider */}
                    <div className="flex items-center gap-2 w-32">
                      <button
                        onClick={() => setPreviewVolume(previewVolume === 0 ? 80 : 0)}
                        className="text-textMuted hover:text-textPrimary cursor-pointer"
                      >
                        {previewVolume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={previewVolume}
                        onChange={(e) => setPreviewVolume(parseInt(e.target.value) || 0)}
                        style={{
                          background: `linear-gradient(to right, var(--theme-accent) 0%, var(--theme-accent) ${previewVolume}%, var(--theme-surface3) ${previewVolume}%, var(--theme-surface3) 100%)`,
                        }}
                        className="w-full accent-accent h-1.5 rounded-full appearance-none cursor-pointer outline-none border-none focus:outline-none focus:ring-0 focus:border-none"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-surface2/30 rounded-2xl border border-dashed border-borderDefault text-center space-y-1">
                  <Music className="w-6 h-6 text-textMuted mx-auto mb-1 opacity-60" />
                  <div className="text-xs font-semibold text-textSecondary">Chưa có bản ghi Audio Master</div>
                  <div className="text-[11px] text-textMuted">Tệp này chưa chạy bước TTS hoặc Lồng tiếng.</div>
                </div>
              )}

              {/* Subtitle Viewer Card */}
              {activeDrawerJob.outputArtifacts?.subtitles && activeDrawerJob.outputArtifacts.subtitles.length > 0 ? (
                <div className="p-4 bg-surface1 rounded-2xl border border-borderDefault space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-textPrimary flex items-center gap-1.5">
                      <Subtitles className="w-4 h-4 text-amber-400" />
                      <span>Xem Phụ đề & Cues</span>
                    </span>
                    <span className="text-[10px] text-textMuted font-mono">
                      {activeDrawerJob.outputArtifacts.subtitles.length} bản phụ đề
                    </span>
                  </div>

                  {/* Subtitle File Tabs if multiple */}
                  {activeDrawerJob.outputArtifacts.subtitles.length > 1 && (
                    <div className="flex items-center gap-1 bg-surface2 p-0.5 rounded-lg border border-borderDefault text-[11px]">
                      {activeDrawerJob.outputArtifacts.subtitles.map((sub, sIdx) => (
                        <button
                          key={sub.path}
                          onClick={() => setPreviewSubtitleTab(sIdx === 0 ? "original" : "translated")}
                          className={`flex-1 py-1 text-center rounded font-medium transition-colors cursor-pointer ${
                            (sIdx === 0 && previewSubtitleTab === "original") || (sIdx === 1 && previewSubtitleTab === "translated")
                              ? "bg-surface1 text-textPrimary font-bold shadow-2xs"
                              : "text-textMuted hover:text-textPrimary"
                          }`}
                        >
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Cues List */}
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {(() => {
                      const selectedSub =
                        activeDrawerJob.outputArtifacts.subtitles.length > 1 && previewSubtitleTab === "original"
                          ? activeDrawerJob.outputArtifacts.subtitles[0]
                          : activeDrawerJob.outputArtifacts.subtitles[activeDrawerJob.outputArtifacts.subtitles.length - 1];

                      return selectedSub.cues.map((cue, cIdx) => (
                        <div
                          key={cIdx}
                          className="p-2.5 rounded-xl bg-surface2/50 border border-borderDefault text-xs space-y-1 hover:border-accent/40 transition-colors"
                        >
                          <div className="flex items-center justify-between text-[10px] text-textMuted font-mono">
                            <span className="px-1.5 py-0.2 rounded bg-surface3 text-accent font-bold">
                              #{cIdx + 1}
                            </span>
                            <span>{cue.time}</span>
                          </div>
                          <p className="text-textPrimary text-xs leading-relaxed font-medium">
                            {cue.text}
                          </p>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-surface2/30 rounded-2xl border border-dashed border-borderDefault text-center space-y-1">
                  <Subtitles className="w-6 h-6 text-textMuted mx-auto mb-1 opacity-60" />
                  <div className="text-xs font-semibold text-textSecondary">Chưa có bản ghi Phụ đề</div>
                  <div className="text-[11px] text-textMuted">Tệp này chưa hoàn tất bước Phụ đề hoặc Dịch.</div>
                </div>
              )}
            </div>
          )}

          {/* Drawer Footer */}
          <div className="p-4 border-t border-borderDefault bg-surface1 flex items-center justify-between flex-shrink-0">
            <span className="text-[11px] text-textMuted">
              Phím tắt: ESC để đóng
            </span>
            <button
              onClick={() => {
                setActiveDrawerJobId(null);
                setIsPlayingPreview(false);
              }}
              className="px-4 py-1.5 text-xs font-bold text-slate-950 bg-accent hover:bg-accentHover rounded-lg transition-colors cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 5b. DIALOGUE CHARACTER VOICES DRAWER (SLIDE-OVER)         */}
      {/* ========================================================= */}
      {dialogueDrawerJob && (
        <div className="fixed inset-y-0 right-0 z-50 w-[420px] lg:w-[460px] bg-panel border-l border-borderDefault shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
          {/* Drawer Header */}
          <div className="p-4 border-b border-borderDefault bg-surface1 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
                  <Settings className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-textPrimary truncate">
                    Cấu hình giọng nhân vật
                  </h4>
                  <div className="text-[11px] text-textMuted truncate flex items-center gap-1.5">
                    <span className="font-medium text-textSecondary truncate max-w-[220px]" title={dialogueDrawerJob.fileName}>
                      {dialogueDrawerJob.fileName}
                    </span>
                    <span>•</span>
                    <span>{dialogueDrawerJob.fileSize}</span>
                    {dialogueDrawerJob.status === "processing" && (
                      <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-semibold text-[10px]">
                        Đang xử lý (Chỉ đọc)
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseDialogueVoiceDrawer}
                className="p-1.5 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface2 cursor-pointer transition-colors"
                title="Đóng (ESC)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Drawer Scrollable Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
            {(() => {
              const globalDefaultVoiceName = globalDefaults.dialogue.defaultVoice || "Minh Quang (Hà Nội)";
              const rawScript = dialogueDrawerJob.scriptContent || DEFAULT_SAMPLE_DIALOGUE_SCRIPT;
              const parseResult = parseDialogueScript(rawScript);

              return (
                <>
                  {/* Section Header matching Dialogue Tab: Tùy chỉnh giọng đọc (3) ... 5 câu thoại */}
                  <div className="flex items-center justify-between px-1 text-xs text-textSecondary">
                    <span className="font-semibold text-textPrimary text-sm">
                      Tùy chỉnh giọng đọc ({parseResult.characters.length})
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-textMuted">
                        {parseResult.segments.length} câu thoại
                      </span>
                      <button
                        type="button"
                        disabled={dialogueDrawerJob.status === "processing"}
                        onClick={() => handleSyncDialogueScript(dialogueDrawerJob.id)}
                        className="flex items-center gap-1 text-[11px] text-accent hover:text-accentHover bg-accent/10 hover:bg-accent/20 px-2 py-0.5 rounded-md border border-accent/20 transition-colors cursor-pointer disabled:opacity-40"
                        title="Đồng bộ lại từ kịch bản nguồn"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Đồng bộ</span>
                      </button>
                    </div>
                  </div>

                  {/* Empty state or Character Cards */}
                  {parseResult.characters.length === 0 ? (
                    <div className="p-8 bg-surface2/30 rounded-xl border border-dashed border-borderDefault text-center space-y-1.5">
                      <FileText className="w-6 h-6 text-textMuted mx-auto mb-1 opacity-60" />
                      <div className="text-xs font-semibold text-textSecondary">Không phát hiện nhân vật</div>
                      <div className="text-[11px] text-textMuted">Kịch bản chưa có cú pháp phân vai <code>[Tên]: Lời thoại</code>.</div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {parseResult.characters.map((char) => {
                        const customVoiceName = draftCharacterVoices[char.id];
                        const isCustomVoice = typeof customVoiceName === "string" && customVoiceName.trim().length > 0;
                        const effectiveVoiceName = isCustomVoice ? customVoiceName : globalDefaultVoiceName;
                        const assignedVoice = MOCK_VOICES.find((v) => v.name === effectiveVoiceName || v.id === effectiveVoiceName) || null;
                        const currentSpeed = draftCharacterSpeeds[char.id] ?? 1.0;
                        const currentPitch = draftCharacterPitches[char.id] ?? 1.0;

                        const charObj: DialogueCharacter = {
                          ...char,
                          speed: currentSpeed,
                          pitch: currentPitch,
                          voiceId: assignedVoice?.id,
                        };

                        return (
                          <CharacterCard
                            key={char.id}
                            character={charObj}
                            assignedVoice={assignedVoice}
                            isCustomVoice={isCustomVoice}
                            disabled={dialogueDrawerJob.status === "processing"}
                            onSelectVoice={() => {
                              if (dialogueDrawerJob.status === "processing") return;
                              setVoiceModalTarget({
                                jobId: dialogueDrawerJob.id,
                                charId: char.id,
                                taskType: "dialogue",
                              });
                            }}
                            onUpdateSpeed={(s) => {
                              setDraftCharacterSpeeds((prev) => ({ ...prev, [char.id]: s }));
                            }}
                            onUpdatePitch={(p) => {
                              setDraftCharacterPitches((prev) => ({ ...prev, [char.id]: p }));
                            }}
                            onTestVoice={() => {
                              handlePlayVoicePreview(effectiveVoiceName);
                            }}
                            onReset={() => {
                              setDraftCharacterVoices((prev) => {
                                const next = { ...prev };
                                delete next[char.id];
                                return next;
                              });
                              setDraftCharacterSpeeds((prev) => {
                                const next = { ...prev };
                                delete next[char.id];
                                return next;
                              });
                              setDraftCharacterPitches((prev) => {
                                const next = { ...prev };
                                delete next[char.id];
                                return next;
                              });
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Drawer Sticky Footer with 2 Action Buttons */}
          <div className="p-4 border-t border-borderDefault bg-surface1 flex items-center justify-between flex-shrink-0">
            <button
              type="button"
              disabled={dialogueDrawerJob.status === "processing"}
              onClick={() => handleResetDialogueCustomVoices(dialogueDrawerJob.id)}
              className="px-3.5 py-2 text-xs font-semibold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
              title="Xóa toàn bộ tùy chỉnh giọng của file này, khôi phục về mặc định"
            >
              Khôi phục mặc định
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCloseDialogueVoiceDrawer}
                className="px-3.5 py-2 text-xs font-semibold text-textSecondary hover:text-textPrimary bg-surface2 hover:bg-surface3 rounded-lg transition-colors cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={dialogueDrawerJob.status === "processing"}
                onClick={() => handleApplyDialogueCustomVoices(dialogueDrawerJob.id)}
                className="px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                title="Lưu bảng gán giọng riêng cho tệp này"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Áp dụng</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification for Dependency & Action Feedback */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md animate-in slide-in-from-bottom duration-200 shadow-2xl">
          <div
            className={`p-3.5 rounded-xl border flex items-start gap-3 backdrop-blur-md ${
              notification.type === "warning"
                ? "bg-amber-950/90 border-amber-500/40 text-amber-200"
                : notification.type === "info"
                ? "bg-sky-950/90 border-sky-500/40 text-sky-200"
                : "bg-emerald-950/90 border-emerald-500/40 text-emerald-200"
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {notification.type === "warning" ? (
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              ) : notification.type === "info" ? (
                <Info className="w-4 h-4 text-sky-400" />
              ) : (
                <Check className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <div className="flex-1 text-xs leading-relaxed font-medium">
              {notification.message}
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-textMuted hover:text-textPrimary p-0.5 rounded cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};



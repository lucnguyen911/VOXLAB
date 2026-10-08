/**
 * Global Advanced TTS Settings Service (Gate E)
 *
 * Single source of truth for advanced inference hyperparameters across local TTS models:
 * - OmniVoice
 * - Chatterbox Turbo
 * - Qwen3-TTS 1.7B Base
 *
 * Persisted in App Data: `settings/tts_advanced.json`.
 * Synchronously accessible via snapshot, automatically loaded at startup.
 */

import { readAppDataFile, saveAppDataFile } from "../storage/tauriFsBridge";

export const TTS_ADVANCED_SETTINGS_FILE = "settings/tts_advanced.json";
export const TTS_ADVANCED_SETTINGS_VERSION = 1;

export type TtsModelKey = "omnivoice" | "chatterbox" | "qwen";
export type ModelPresetId = "stable" | "balanced" | "expressive" | "custom";

export interface OmniVoiceAdvancedSettings {
  /** Số bước suy luận Flow Matching (Khuyến nghị: 32, phạm vi 4 - 128) */
  num_step: number;
  /** Mức độ bám sát văn bản Classifier-Free Guidance (Khuyến nghị: 2.0, phạm vi 1.0 - 10.0) */
  guidance_scale: number;
  /** Khử nhiễu tiền xử lý (Khuyến nghị: Bật) */
  denoise: boolean;
  /** Nhiệt độ chọn vị trí căn chỉnh khung thời gian (Khuyến nghị: 5.0, phạm vi 0.0 - 20.0) */
  position_temperature: number;
  /** Nhiệt độ lấy mẫu mã nhãn âm thanh; 0.0 là greedy (Khuyến nghị: 0.0, phạm vi 0.0 - 5.0) */
  class_temperature: number;
  /** Hậu xử lý cắt khoảng lặng và fade viền âm thanh (Khuyến nghị: Bật) */
  postprocess_output: boolean;
}

export interface ChatterboxAdvancedSettings {
  /** Nhiệt độ lấy mẫu (Khuyến nghị: 0.8, phạm vi 0.1 - 2.0) */
  temperature: number;
  /** Xác suất tích lũy Nucleus Sampling (Khuyến nghị: 0.95, phạm vi 0.1 - 1.0) */
  top_p: number;
  /** Giới hạn số ứng viên token (Khuyến nghị: 1000, phạm vi 10 - 2000) */
  top_k: number;
  /** Phạt lặp từ (Khuyến nghị: 1.2, phạm vi 1.0 - 2.0) */
  repetition_penalty: number;
}

export interface QwenAdvancedSettings {
  /** Nhiệt độ lấy mẫu sinh âm thanh (Khuyến nghị: 0.9, phạm vi 0.1 - 2.0) */
  temperature: number;
  /** Xác suất tích lũy (Khuyến nghị: 1.0, phạm vi 0.1 - 1.0) */
  top_p: number;
  /** Giới hạn số ứng viên mã âm thanh (Khuyến nghị: 50, phạm vi 1 - 200) */
  top_k: number;
  /** Hệ số phạt lặp âm thanh (Khuyến nghị: 1.05, phạm vi 1.0 - 2.0) */
  repetition_penalty: number;
  /** Cơ chế lấy mẫu ngẫu nhiên (Khuyến nghị: Bật) */
  do_sample: boolean;
  /** Chỉ dùng đặc trưng người nói; Tắt để dùng ICL clone chất lượng cao (Khuyến nghị: Tắt) */
  x_vector_only_mode: boolean;
}

export interface ModelAdvancedState<T> {
  preset: ModelPresetId;
  settings: T;
}

export interface StoredTtsAdvancedSettings {
  version: number;
  omnivoice: ModelAdvancedState<OmniVoiceAdvancedSettings>;
  chatterbox: ModelAdvancedState<ChatterboxAdvancedSettings>;
  qwen: ModelAdvancedState<QwenAdvancedSettings>;
}

// ---------------------------------------------------------------------------
// Presets Definitions
// ---------------------------------------------------------------------------

export const OMNIVOICE_DEFAULT_SETTINGS: OmniVoiceAdvancedSettings = {
  num_step: 32,
  guidance_scale: 2.0,
  denoise: true,
  position_temperature: 5.0,
  class_temperature: 0.0,
  postprocess_output: true,
};

export const OMNIVOICE_PRESETS: Record<"stable" | "balanced" | "expressive", OmniVoiceAdvancedSettings> = {
  stable: {
    num_step: 40,
    guidance_scale: 2.5,
    denoise: true,
    position_temperature: 3.0,
    class_temperature: 0.0,
    postprocess_output: true,
  },
  balanced: { ...OMNIVOICE_DEFAULT_SETTINGS },
  expressive: {
    num_step: 32,
    guidance_scale: 1.8,
    denoise: true,
    position_temperature: 6.0,
    class_temperature: 0.2,
    postprocess_output: true,
  },
};

export const CHATTERBOX_DEFAULT_SETTINGS: ChatterboxAdvancedSettings = {
  temperature: 0.8,
  top_p: 0.95,
  top_k: 1000,
  repetition_penalty: 1.2,
};

export const CHATTERBOX_PRESETS: Record<"stable" | "balanced" | "expressive", ChatterboxAdvancedSettings> = {
  stable: {
    temperature: 0.6,
    top_p: 0.90,
    top_k: 500,
    repetition_penalty: 1.3,
  },
  balanced: { ...CHATTERBOX_DEFAULT_SETTINGS },
  expressive: {
    temperature: 0.95,
    top_p: 0.98,
    top_k: 1500,
    repetition_penalty: 1.15,
  },
};

export const QWEN_DEFAULT_SETTINGS: QwenAdvancedSettings = {
  temperature: 0.9,
  top_p: 1.0,
  top_k: 50,
  repetition_penalty: 1.05,
  do_sample: true,
  x_vector_only_mode: false,
};

export const QWEN_PRESETS: Record<"stable" | "balanced" | "expressive", QwenAdvancedSettings> = {
  stable: {
    temperature: 0.7,
    top_p: 0.95,
    top_k: 30,
    repetition_penalty: 1.15,
    do_sample: true,
    x_vector_only_mode: false,
  },
  balanced: { ...QWEN_DEFAULT_SETTINGS },
  expressive: {
    temperature: 1.0,
    top_p: 1.0,
    top_k: 70,
    repetition_penalty: 1.02,
    do_sample: true,
    x_vector_only_mode: false,
  },
};

export function getDefaultTtsAdvancedSettings(): StoredTtsAdvancedSettings {
  return {
    version: TTS_ADVANCED_SETTINGS_VERSION,
    omnivoice: {
      preset: "balanced",
      settings: { ...OMNIVOICE_DEFAULT_SETTINGS },
    },
    chatterbox: {
      preset: "balanced",
      settings: { ...CHATTERBOX_DEFAULT_SETTINGS },
    },
    qwen: {
      preset: "balanced",
      settings: { ...QWEN_DEFAULT_SETTINGS },
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers & Sanitizers
// ---------------------------------------------------------------------------

function clamp(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== "number" || isNaN(val) || !isFinite(val)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, val));
}

function toBoolean(val: unknown, fallback: boolean): boolean {
  if (typeof val === "boolean") return val;
  return fallback;
}

function sanitizePreset(val: unknown): ModelPresetId {
  if (val === "stable" || val === "balanced" || val === "expressive" || val === "custom") {
    return val;
  }
  return "balanced";
}

export function sanitizeOmniVoiceSettings(raw: unknown): OmniVoiceAdvancedSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    num_step: Math.round(clamp(o.num_step, 4, 128, OMNIVOICE_DEFAULT_SETTINGS.num_step)),
    guidance_scale: clamp(o.guidance_scale, 1.0, 10.0, OMNIVOICE_DEFAULT_SETTINGS.guidance_scale),
    denoise: toBoolean(o.denoise, OMNIVOICE_DEFAULT_SETTINGS.denoise),
    position_temperature: clamp(o.position_temperature, 0.0, 20.0, OMNIVOICE_DEFAULT_SETTINGS.position_temperature),
    class_temperature: clamp(o.class_temperature, 0.0, 5.0, OMNIVOICE_DEFAULT_SETTINGS.class_temperature),
    postprocess_output: toBoolean(o.postprocess_output, OMNIVOICE_DEFAULT_SETTINGS.postprocess_output),
  };
}

export function sanitizeChatterboxSettings(raw: unknown): ChatterboxAdvancedSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    temperature: clamp(o.temperature, 0.1, 2.0, CHATTERBOX_DEFAULT_SETTINGS.temperature),
    top_p: clamp(o.top_p, 0.1, 1.0, CHATTERBOX_DEFAULT_SETTINGS.top_p),
    top_k: Math.round(clamp(o.top_k, 10, 2000, CHATTERBOX_DEFAULT_SETTINGS.top_k)),
    repetition_penalty: clamp(o.repetition_penalty, 1.0, 2.0, CHATTERBOX_DEFAULT_SETTINGS.repetition_penalty),
  };
}

export function sanitizeQwenSettings(raw: unknown): QwenAdvancedSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    temperature: clamp(o.temperature, 0.1, 2.0, QWEN_DEFAULT_SETTINGS.temperature),
    top_p: clamp(o.top_p, 0.1, 1.0, QWEN_DEFAULT_SETTINGS.top_p),
    top_k: Math.round(clamp(o.top_k, 1, 200, QWEN_DEFAULT_SETTINGS.top_k)),
    repetition_penalty: clamp(o.repetition_penalty, 1.0, 2.0, QWEN_DEFAULT_SETTINGS.repetition_penalty),
    do_sample: toBoolean(o.do_sample, QWEN_DEFAULT_SETTINGS.do_sample),
    x_vector_only_mode: toBoolean(o.x_vector_only_mode, QWEN_DEFAULT_SETTINGS.x_vector_only_mode),
  };
}

export function sanitizeTtsAdvancedSettings(raw: unknown): StoredTtsAdvancedSettings {
  const defaults = getDefaultTtsAdvancedSettings();
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const omniRaw = (o.omnivoice && typeof o.omnivoice === "object" ? o.omnivoice : {}) as Record<string, unknown>;
  const chatterRaw = (o.chatterbox && typeof o.chatterbox === "object" ? o.chatterbox : {}) as Record<string, unknown>;
  const qwenRaw = (o.qwen && typeof o.qwen === "object" ? o.qwen : {}) as Record<string, unknown>;

  return {
    version: typeof o.version === "number" ? o.version : defaults.version,
    omnivoice: {
      preset: sanitizePreset(omniRaw.preset),
      settings: sanitizeOmniVoiceSettings(omniRaw.settings),
    },
    chatterbox: {
      preset: sanitizePreset(chatterRaw.preset),
      settings: sanitizeChatterboxSettings(chatterRaw.settings),
    },
    qwen: {
      preset: sanitizePreset(qwenRaw.preset),
      settings: sanitizeQwenSettings(qwenRaw.settings),
    },
  };
}

// ---------------------------------------------------------------------------
// In-Memory Cache & Durable Persistence
// ---------------------------------------------------------------------------

let cachedSettings: StoredTtsAdvancedSettings = getDefaultTtsAdvancedSettings();
let activeSaveSeq = 0;

export function isFileNotFoundError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("not found") ||
    msg.includes("cannot find the file") ||
    msg.includes("no such file") ||
    msg.includes("os error 2") ||
    // @ts-ignore
    err?.code === "ENOENT"
  );
}

/** Returns a synchronous deep clone snapshot of the active advanced settings. */
export function getTtsAdvancedSettingsSnapshot(): StoredTtsAdvancedSettings {
  return JSON.parse(JSON.stringify(cachedSettings));
}

/**
 * Loads persistent settings from App Data.
 * Distinguishes between:
 * 1) File does not exist yet (first launch / defaults).
 * 2) File exists but cannot be read or JSON is corrupted (preserves existing cachedSettings and logs error).
 */
export async function loadTtsAdvancedSettings(): Promise<StoredTtsAdvancedSettings> {
  let fileContent: string;
  try {
    fileContent = await readAppDataFile(TTS_ADVANCED_SETTINGS_FILE);
  } catch (err: unknown) {
    if (isFileNotFoundError(err)) {
      // First run / file not yet created -> safely use defaults
      cachedSettings = getDefaultTtsAdvancedSettings();
      return getTtsAdvancedSettingsSnapshot();
    }
    // Read / I/O / permission failure -> log error, retain current cached settings to protect user configuration
    console.error(`[loadTtsAdvancedSettings] Failed to read ${TTS_ADVANCED_SETTINGS_FILE}:`, err);
    return getTtsAdvancedSettingsSnapshot();
  }

  try {
    const raw = JSON.parse(fileContent);
    cachedSettings = sanitizeTtsAdvancedSettings(raw);
  } catch (parseErr) {
    console.error(`[loadTtsAdvancedSettings] Corrupt JSON in ${TTS_ADVANCED_SETTINGS_FILE}:`, parseErr);
  }
  return getTtsAdvancedSettingsSnapshot();
}

/**
 * Persists settings to App Data atomically and updates active in-memory cache ONLY AFTER
 * write succeeds.
 * If disk write fails, throws error and leaves existing cachedSettings unmodified.
 * Uses sequence counter to prevent race condition from concurrent saves.
 */
export async function saveTtsAdvancedSettings(settings: StoredTtsAdvancedSettings): Promise<void> {
  const sanitized = sanitizeTtsAdvancedSettings(settings);
  const jsonStr = JSON.stringify(sanitized, null, 2);
  const currentSeq = ++activeSaveSeq;

  // Persist to disk FIRST before updating in-memory cache
  await saveAppDataFile(TTS_ADVANCED_SETTINGS_FILE, jsonStr);

  // Prevent race condition: update in-memory cache only if no newer save was initiated
  if (currentSeq === activeSaveSeq) {
    cachedSettings = sanitized;
  }
}

/** Resets a specific model's settings to its Balanced default and saves. */
export async function resetModelTtsAdvancedSettings(model: TtsModelKey): Promise<StoredTtsAdvancedSettings> {
  const current = getTtsAdvancedSettingsSnapshot();
  if (model === "omnivoice") {
    current.omnivoice = {
      preset: "balanced",
      settings: { ...OMNIVOICE_DEFAULT_SETTINGS },
    };
  } else if (model === "chatterbox") {
    current.chatterbox = {
      preset: "balanced",
      settings: { ...CHATTERBOX_DEFAULT_SETTINGS },
    };
  } else if (model === "qwen") {
    current.qwen = {
      preset: "balanced",
      settings: { ...QWEN_DEFAULT_SETTINGS },
    };
  }
  await saveTtsAdvancedSettings(current);
  return current;
}

/**
 * Resolves the appropriate advanced settings payload for a given model/engine identifier.
 * Accepts engine name ("omnivoice", "chatterbox", "qwen") or model ID ("chatterbox-turbo", "qwen3-tts-1.7b-base").
 * If snapshot is omitted, uses the current active cached settings.
 */
export function getEngineAdvancedSettings(
  engineOrModelId: string,
  snapshot?: StoredTtsAdvancedSettings
): Record<string, unknown> {
  const snap = snapshot || cachedSettings;
  const id = engineOrModelId.toLowerCase().replace(/_/g, "-");

  if (id.includes("chatterbox")) {
    return { ...snap.chatterbox.settings };
  }
  if (id.includes("qwen")) {
    return { ...snap.qwen.settings };
  }
  // Default to OmniVoice for "omnivoice" or other local models
  return { ...snap.omnivoice.settings };
}

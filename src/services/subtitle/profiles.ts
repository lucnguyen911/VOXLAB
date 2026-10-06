import { SubtitleAspectRatio, SubtitleProfile, SubtitleSettings } from "./types";

export const SUBTITLE_PROFILES: Record<SubtitleAspectRatio, SubtitleProfile> = {
  "16:9": {
    formatId: "16:9",
    maxLines: 2,
    targetWidth: 32,
    maxWidth: 40,
    targetWords: 8,
    maxWords: 16,
    minDuration: 0.8,
    targetDuration: 2.8,
    maxDuration: 7.0,
    targetCps: 16.0,
    maxCps: 20.0,
  },
  "1:1": {
    formatId: "1:1",
    maxLines: 2,
    targetWidth: 26,
    maxWidth: 34,
    targetWords: 6,
    maxWords: 13,
    minDuration: 0.8,
    targetDuration: 2.4,
    maxDuration: 7.0,
    targetCps: 15.0,
    maxCps: 19.0,
  },
  "9:16": {
    formatId: "9:16",
    maxLines: 2,
    targetWidth: 20,
    maxWidth: 26,
    targetWords: 5,
    maxWords: 10,
    minDuration: 0.7,
    targetDuration: 2.0,
    maxDuration: 6.0,
    targetCps: 14.0,
    maxCps: 18.0,
  },
};

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  audioLanguage: "auto",
  whisperModel: "large-v3-turbo",
  speechSpeed: 1.0,
  processingSpeed: "auto",
  aspectRatio: "16:9",
  maxLines: 2,
};

export const SUBTITLE_STORAGE_KEY = "voxlab_subtitle_settings";

export function getSubtitleProfile(
  aspectRatio: SubtitleAspectRatio = "16:9",
  maxLines: number = 2
): SubtitleProfile {
  const base = SUBTITLE_PROFILES[aspectRatio] || SUBTITLE_PROFILES["16:9"];
  const safeLines = maxLines === 1 ? 1 : 2;
  return {
    ...base,
    maxLines: safeLines,
  };
}

export function loadSubtitleSettings(): SubtitleSettings {
  if (typeof localStorage === "undefined") {
    return DEFAULT_SUBTITLE_SETTINGS;
  }
  try {
    const raw = localStorage.getItem(SUBTITLE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        // Migration of legacy keys
        const aspectRatio: SubtitleAspectRatio =
          ["16:9", "1:1", "9:16"].includes(parsed.aspectRatio)
            ? parsed.aspectRatio
            : ["16:9", "1:1", "9:16"].includes(parsed.video_format)
            ? parsed.video_format
            : "16:9";

        const speechSpeed = [1.0, 0.9, 0.8].includes(Number(parsed.speechSpeed))
          ? (Number(parsed.speechSpeed) as 1.0 | 0.9 | 0.8)
          : [1.0, 0.9, 0.8].includes(Number(parsed.asr_speed))
          ? (Number(parsed.asr_speed) as 1.0 | 0.9 | 0.8)
          : 1.0;

        let processingSpeed = parsed.processingSpeed;
        if (!["auto", "1x", "2x", "4x", "8x"].includes(processingSpeed)) {
          // Migration from batch_size number if present
          if (parsed.batch_size === 1) processingSpeed = "1x";
          else if (parsed.batch_size === 4) processingSpeed = "2x";
          else if (parsed.batch_size === 8 || parsed.batch_size === 16) processingSpeed = "4x";
          else if (parsed.batch_size === 32) processingSpeed = "8x";
          else processingSpeed = "auto";
        }

        const maxLines = parsed.maxLines === 1 || parsed.max_lines === 1 ? 1 : 2;

        const VALID_WHISPER_MODELS = ["large-v3-turbo", "large-v3", "medium"];
        let whisperModel = parsed.whisperModel;
        if (!VALID_WHISPER_MODELS.includes(whisperModel)) {
          if (typeof whisperModel === "string" && whisperModel.toLowerCase().includes("medium")) {
            whisperModel = "medium";
          } else if (typeof whisperModel === "string" && whisperModel.toLowerCase().includes("v3") && !whisperModel.toLowerCase().includes("turbo")) {
            whisperModel = "large-v3";
          } else {
            whisperModel = "large-v3-turbo";
          }
        }

        return {
          ...DEFAULT_SUBTITLE_SETTINGS,
          ...parsed,
          whisperModel,
          aspectRatio,
          speechSpeed,
          processingSpeed,
          maxLines,
        };
      }
    }
  } catch {
    // Return default on parse failure
  }
  return DEFAULT_SUBTITLE_SETTINGS;
}

export function saveSubtitleSettings(settings: Partial<SubtitleSettings>): void {
  if (typeof localStorage === "undefined") return;
  try {
    const current = loadSubtitleSettings();
    const updated: SubtitleSettings = {
      ...current,
      ...settings,
    };
    localStorage.setItem(SUBTITLE_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

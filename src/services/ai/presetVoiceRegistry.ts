/**
 * Preset voice registry: authoritative references (audio + transcript) for built-in system voices.
 * Ensures local zero-shot TTS models (OmniVoice, Chatterbox Turbo, Qwen TTS) receive proper conditioning
 * so all synthesized chunks maintain speaker consistency instead of randomizing per chunk.
 */
import type { VoiceReference } from "./localAiServices";
import { resolveCloneVoiceReference } from "./cloneVoiceRegistry";

export interface PresetVoiceDefinition {
  voiceId: string;
  name: string;
  fileName: string;
  refText: string;
  language: string;
  engine: "omnivoice" | "chatterbox_turbo" | "qwen_tts_1_7b";
}

export const PRESET_VOICE_DEFINITIONS: Record<string, PresetVoiceDefinition> = {
  voice_01: {
    voiceId: "voice_01",
    name: "Thảo Trinh (Hà Nội)",
    fileName: "thao_trinh.mp3",
    refText: "Xin chào, đây là bản nghe thử giọng đọc của Thảo Trinh trên VoxLab.",
    language: "vi",
    engine: "omnivoice",
  },
  voice_02: {
    voiceId: "voice_02",
    name: "Nam Anh (Sài Gòn)",
    fileName: "nam_anh.mp3",
    refText: "Xin chào, đây là bản nghe thử giọng đọc của Nam Anh trên VoxLab.",
    language: "vi",
    engine: "chatterbox_turbo",
  },
  voice_06: {
    voiceId: "voice_06",
    name: "Sarah (US Professional)",
    fileName: "sarah.mp3",
    refText: "Hello, this is Sarah with a professional voice sample on VoxLab.",
    language: "en",
    engine: "omnivoice",
  },
  voice_07: {
    voiceId: "voice_07",
    name: "David (UK Documentary)",
    fileName: "david.mp3",
    refText: "Hello, this is David with a documentary voice sample on VoxLab.",
    language: "en",
    engine: "chatterbox_turbo",
  },
  // Aliases and system voices mapped to appropriate gender/language acoustic references
  voice_03: {
    voiceId: "voice_03",
    name: "Mai Phương (Hải Phòng)",
    fileName: "thao_trinh.mp3",
    refText: "Xin chào, đây là bản nghe thử giọng đọc của Thảo Trinh trên VoxLab.",
    language: "vi",
    engine: "omnivoice",
  },
  voice_09: {
    voiceId: "voice_09",
    name: "Bảo Long (Đà Nẵng)",
    fileName: "nam_anh.mp3",
    refText: "Xin chào, đây là bản nghe thử giọng đọc của Nam Anh trên VoxLab.",
    language: "vi",
    engine: "omnivoice",
  },
  voice_10: {
    voiceId: "voice_10",
    name: "Hương Giang (Huế)",
    fileName: "thao_trinh.mp3",
    refText: "Xin chào, đây là bản nghe thử giọng đọc của Thảo Trinh trên VoxLab.",
    language: "vi",
    engine: "omnivoice",
  },
  voice_11: {
    voiceId: "voice_11",
    name: "Quốc Cường (Cần Thơ)",
    fileName: "nam_anh.mp3",
    refText: "Xin chào, đây là bản nghe thử giọng đọc của Nam Anh trên VoxLab.",
    language: "vi",
    engine: "omnivoice",
  },
  voice_12: {
    voiceId: "voice_12",
    name: "Linh Chi (Hà Nội)",
    fileName: "thao_trinh.mp3",
    refText: "Xin chào, đây là bản nghe thử giọng đọc của Thảo Trinh trên VoxLab.",
    language: "vi",
    engine: "omnivoice",
  },
  voice_13: {
    voiceId: "voice_13",
    name: "Minh Quang (Hà Nội)",
    fileName: "nam_anh.mp3",
    refText: "Xin chào, đây là bản nghe thử giọng đọc của Nam Anh trên VoxLab.",
    language: "vi",
    engine: "omnivoice",
  },
  voice_14: {
    voiceId: "voice_14",
    name: "Mai Chi (Sài Gòn)",
    fileName: "thao_trinh.mp3",
    refText: "Xin chào, đây là bản nghe thử giọng đọc của Thảo Trinh trên VoxLab.",
    language: "vi",
    engine: "omnivoice",
  },
  default_local: {
    voiceId: "default_local",
    name: "Default Local Voice",
    fileName: "default_local.mp3",
    refText: "Xin chào, đây là bản nghe thử giọng đọc mẫu trên VoxLab.",
    language: "vi",
    engine: "omnivoice",
  },
};

let cachedAppDataDir: string | null = null;

export function setPresetVoicesAppDataDir(dir: string): void {
  cachedAppDataDir = dir.replace(/[\\/]+$/, "");
}

export function getPresetVoicesAppDataDir(): string {
  if (cachedAppDataDir) return cachedAppDataDir;
  // Node / test environment fallback
  return "C:/Users/AppData/Roaming/com.voxlab.app";
}

/**
 * Resolves the absolute disk path of a preset voice sample.
 */
export function resolvePresetSampleDiskPath(fileName: string, appDataDir?: string): string {
  const baseDir = (appDataDir || getPresetVoicesAppDataDir()).replace(/[\\/]+$/, "");
  return `${baseDir}/voices/samples/${fileName}`.replace(/\//g, "\\");
}

/**
 * Resolves reference audio and transcript for a preset voice ID.
 */
export function resolvePresetVoiceReference(voiceId: string, appDataDir?: string): VoiceReference | null {
  const def = PRESET_VOICE_DEFINITIONS[voiceId];
  if (!def) return null;

  return {
    refAudioPath: resolvePresetSampleDiskPath(def.fileName, appDataDir),
    refText: def.refText,
    language: def.language,
  };
}

/**
 * Unified resolver: resolves cloned voices first, then preset system voices, then default fallback.
 */
export function resolveUnifiedVoiceReference(voiceId: string, appDataDir?: string): VoiceReference | null {
  // 1. Cloned voice registry takes precedence
  const cloneRef = resolveCloneVoiceReference(voiceId);
  if (cloneRef) return cloneRef;

  // 2. Preset system voice
  const presetRef = resolvePresetVoiceReference(voiceId, appDataDir);
  if (presetRef) return presetRef;

  // 3. Fallback to default local sample for unknown local voices
  return resolvePresetVoiceReference("default_local", appDataDir);
}

/**
 * Ensures all preset audio samples are present in the AppData directory.
 * Idempotent. Called during runtime initialization.
 */
export async function ensurePresetVoiceSamples(appDataDir: string): Promise<void> {
  setPresetVoicesAppDataDir(appDataDir);
  const normalizedBase = appDataDir.replace(/[\\/]+$/, "");
  const samplesDir = `${normalizedBase}/voices/samples`;

  const uniqueFiles = Array.from(new Set(Object.values(PRESET_VOICE_DEFINITIONS).map((d) => d.fileName)));

  try {
    const isTauri = typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
    if (!isTauri) return;

    const core = await import("@tauri-apps/api/core");

    for (const fileName of uniqueFiles) {
      const targetPath = `${samplesDir}/${fileName}`.replace(/\//g, "\\");
      try {
        const exists = await core.invoke<boolean>("fs_exists", { path: targetPath });
        if (exists) continue;

        // Fetch sample bytes from frontend asset server
        const resp = await fetch(`/audio/samples/${fileName}`);
        if (resp.ok) {
          const arr = await resp.arrayBuffer();
          await core.invoke<void>("fs_write_bytes", {
            path: targetPath,
            bytes: Array.from(new Uint8Array(arr)),
          });
        }
      } catch (err) {
        console.warn(`Could not seed preset sample ${fileName}:`, err);
      }
    }
  } catch (err) {
    console.warn("ensurePresetVoiceSamples failed:", err);
  }
}

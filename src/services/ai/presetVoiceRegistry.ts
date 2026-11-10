/**
 * Preset voice registry: authoritative references (audio + transcript) for built-in system voices.
 * - Pre-bundled Kokoro-82M voices (`kokoro_*`) use native speaker embeddings inside `voices-v1.0.bin`
 *   when synthesized with `Kokoro-82M`, and also provide clean 24kHz WAV reference audio + transcripts
 *   when synthesized with zero-shot clone engines (`OmniVoice`, `Chatterbox Turbo`, `Qwen3-TTS 1.7B`).
 */
import type { VoiceReference } from "./localAiServices";
import { resolveCloneVoiceReference } from "./cloneVoiceRegistry";

export interface PresetVoiceDefinition {
  voiceId: string;
  name: string;
  fileName: string;
  refText: string;
  language: string;
  engine: "kokoro_82m" | "omnivoice" | "chatterbox_turbo" | "qwen_tts_1_7b";
}

export const PRESET_VOICE_DEFINITIONS: Record<string, PresetVoiceDefinition> = {
  kokoro_af_heart: {
    voiceId: "kokoro_af_heart",
    name: "Heart (Kokoro Local)",
    fileName: "kokoro_af_heart.wav",
    refText: "Hello, I am Heart from Kokoro on VoxLab. My voice is warm, natural, and expressive for storytelling.",
    language: "en",
    engine: "kokoro_82m",
  },
  kokoro_af_bella: {
    voiceId: "kokoro_af_bella",
    name: "Bella (Kokoro Local)",
    fileName: "kokoro_af_bella.wav",
    refText: "Hi there, this is Bella on VoxLab, bringing a bright and engaging tone to your podcasts and videos.",
    language: "en",
    engine: "kokoro_82m",
  },
  kokoro_af_nicole: {
    voiceId: "kokoro_af_nicole",
    name: "Nicole (Kokoro Local)",
    fileName: "kokoro_af_nicole.wav",
    refText: "Welcome to VoxLab. I am Nicole, delivering a calm, soft, and intimate voice for late-night narration.",
    language: "en",
    engine: "kokoro_82m",
  },
  kokoro_af_sarah: {
    voiceId: "kokoro_af_sarah",
    name: "Sarah (Kokoro Local)",
    fileName: "kokoro_af_sarah.wav",
    refText: "Hello, this is Sarah with a clear and professional voice sample for presentations and news on VoxLab.",
    language: "en",
    engine: "kokoro_82m",
  },
  kokoro_am_adam: {
    voiceId: "kokoro_am_adam",
    name: "Adam (Kokoro Local)",
    fileName: "kokoro_am_adam.wav",
    refText: "Hello, I am Adam on VoxLab, offering a resonant and confident American male voice for documentaries.",
    language: "en",
    engine: "kokoro_82m",
  },
  kokoro_am_michael: {
    voiceId: "kokoro_am_michael",
    name: "Michael (Kokoro Local)",
    fileName: "kokoro_am_michael.wav",
    refText: "Hi, this is Michael from Kokoro on VoxLab, ready for natural conversational dialogue and tutorials.",
    language: "en",
    engine: "kokoro_82m",
  },
  kokoro_am_fenrir: {
    voiceId: "kokoro_am_fenrir",
    name: "Fenrir (Kokoro Local)",
    fileName: "kokoro_am_fenrir.wav",
    refText: "Greetings from VoxLab. I am Fenrir, providing a deep, dramatic, and commanding voice for trailers.",
    language: "en",
    engine: "kokoro_82m",
  },
  kokoro_am_puck: {
    voiceId: "kokoro_am_puck",
    name: "Puck (Kokoro Local)",
    fileName: "kokoro_am_puck.wav",
    refText: "Hey everyone, this is Puck on VoxLab! Let us dive right into an energetic and lively story.",
    language: "en",
    engine: "kokoro_82m",
  },
  kokoro_bf_emma: {
    voiceId: "kokoro_bf_emma",
    name: "Emma UK (Kokoro Local)",
    fileName: "kokoro_bf_emma.wav",
    refText: "Good day, I am Emma on VoxLab, speaking with a refined and articulate British accent for audiobooks.",
    language: "en",
    engine: "kokoro_82m",
  },
  kokoro_bf_isabella: {
    voiceId: "kokoro_bf_isabella",
    name: "Isabella UK (Kokoro Local)",
    fileName: "kokoro_bf_isabella.wav",
    refText: "Hello, this is Isabella on VoxLab, offering a gentle and poised British voice for classic literature.",
    language: "en",
    engine: "kokoro_82m",
  },
  kokoro_bm_george: {
    voiceId: "kokoro_bm_george",
    name: "George UK (Kokoro Local)",
    fileName: "kokoro_bm_george.wav",
    refText: "Hello, this is George on VoxLab, delivering a distinguished British documentary and narration voice.",
    language: "en",
    engine: "kokoro_82m",
  },
  kokoro_bm_lewis: {
    voiceId: "kokoro_bm_lewis",
    name: "Lewis UK (Kokoro Local)",
    fileName: "kokoro_bm_lewis.wav",
    refText: "Welcome to VoxLab. I am Lewis, bringing a modern and clear British male voice to your projects.",
    language: "en",
    engine: "kokoro_82m",
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

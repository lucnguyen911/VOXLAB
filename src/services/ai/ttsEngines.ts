/**
 * TtsEngineAdapter capability registry (frontend mirror of sidecar/voxlab_sidecar/tts/*_adapter.py).
 * Values come from the adapters' declared capabilities and real-hardware verification;
 * `requiredVramMb` is only filled from the real benchmark (TASK-16).
 *
 * No silent fallback: if an engine cannot serve a request, `checkEngineSupport` returns the reason
 * and callers must surface it instead of switching engines.
 */
import { AiRuntime } from "./types";

export type LocalTtsEngineId = "omnivoice" | "chatterbox" | "qwen";
export type DevicePreference = "auto" | "cuda" | "cpu";

export interface TtsEngineCapabilities {
  engine: LocalTtsEngineId;
  /** Model id used in VoxLab snapshots / VoiceProfile.engine */
  voxlabModelId: "omnivoice" | "chatterbox_turbo" | "qwen_tts_1_7b";
  displayName: string;
  runtime: AiRuntime;
  modelId: string; // folder in the Models directory (src-tauri/src/ai/models.rs)
  supportedLanguages: readonly string[]; // ["*"] = language-agnostic multilingual
  supportsVietnamese: boolean;
  supportsVoiceClone: boolean;
  referenceAudioRequired: boolean;
  referenceTextRequired: boolean;
  minReferenceSec?: number;
  supportsCUDA: boolean;
  supportsCPU: boolean;
  supportsSpeed: boolean;
  modelSizeMb: number;
  requiredVramMb: number | null;
  notes: readonly string[];
}

export const TTS_ENGINES: Record<LocalTtsEngineId, TtsEngineCapabilities> = {
  omnivoice: {
    engine: "omnivoice",
    voxlabModelId: "omnivoice",
    displayName: "OmniVoice",
    runtime: "core",
    modelId: "omnivoice",
    supportedLanguages: ["*"],
    supportsVietnamese: true,
    supportsVoiceClone: true,
    referenceAudioRequired: false,
    referenceTextRequired: false, // Auto-transcribed by backend faster-whisper when omitted
    supportsCUDA: true,
    supportsCPU: false,
    supportsSpeed: true,
    modelSizeMb: 3116,
    requiredVramMb: 3200,
    notes: ["Weights CC-BY-NC-4.0; audio tokenizer: Boson Higgs Audio 2 Community License."],
  },
  chatterbox: {
    engine: "chatterbox",
    voxlabModelId: "chatterbox_turbo",
    displayName: "Chatterbox Turbo",
    runtime: "chatterbox",
    modelId: "chatterbox-turbo",
    supportedLanguages: ["en"],
    supportsVietnamese: false,
    supportsVoiceClone: true,
    referenceAudioRequired: false,
    referenceTextRequired: false,
    minReferenceSec: 5,
    supportsCUDA: true,
    supportsCPU: false,
    supportsSpeed: false,
    modelSizeMb: 2849,
    requiredVramMb: 3300,
    notes: ["English only.", "Output carries Resemble Perth watermark.", "MIT."],
  },
  qwen: {
    engine: "qwen",
    voxlabModelId: "qwen_tts_1_7b",
    displayName: "Qwen3-TTS 1.7B Base",
    runtime: "qwen",
    modelId: "qwen3-tts-1.7b-base",
    supportedLanguages: ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"],
    supportsVietnamese: false,
    supportsVoiceClone: true,
    referenceAudioRequired: true,
    referenceTextRequired: true,
    supportsCUDA: true,
    supportsCPU: false,
    supportsSpeed: false,
    modelSizeMb: 4334,
    requiredVramMb: 4800,
    notes: ["No Vietnamese.", "Base variant: reference audio + transcript required.", "Apache-2.0."],
  },
};

/** Maps a VoxLab model id (snapshot `model`, VoiceProfile.engine, display name) to a local engine, or null if not local. */
export function resolveLocalEngine(model: string | undefined | null): TtsEngineCapabilities | null {
  if (!model) return null;
  const m = model.toLowerCase().replace(/[\s_-]+/g, "");
  for (const caps of Object.values(TTS_ENGINES)) {
    const v = caps.voxlabModelId.replace(/[\s_-]+/g, "").toLowerCase();
    const e = caps.engine.replace(/[\s_-]+/g, "").toLowerCase();
    const d = caps.displayName.replace(/[\s_-]+/g, "").toLowerCase();
    const mid = caps.modelId.replace(/[\s_-]+/g, "").toLowerCase();
    if (m === v || m === e || m === d || m === mid) return caps;
    if (m.includes("omni") && (e === "omnivoice" || v === "omnivoice")) return caps;
    if (m.includes("chatterbox") && (e === "chatterbox" || v === "chatterboxturbo")) return caps;
    if (m.includes("qwen") && (e === "qwen" || v === "qwentts17b")) return caps;
  }
  return null;
}

export interface EngineRequest {
  language?: string; // ISO 639-1, e.g. "vi"
  hasReferenceAudio?: boolean;
  hasReferenceText?: boolean;
  speed?: number;
  device?: DevicePreference;
  cudaAvailable?: boolean;
}

export interface SupportCheck {
  ok: boolean;
  reason?: string;
}

export function baseLanguage(lang: string | undefined): string | undefined {
  return lang ? lang.toLowerCase().split(/[-_]/)[0] : undefined;
}

export function checkEngineSupport(caps: TtsEngineCapabilities, req: EngineRequest): SupportCheck {
  const lang = baseLanguage(req.language);
  if (lang && !caps.supportedLanguages.includes("*") && !caps.supportedLanguages.includes(lang)) {
    return {
      ok: false,
      reason:
        lang === "vi"
          ? `${caps.displayName} không hỗ trợ tiếng Việt.`
          : `${caps.displayName} không hỗ trợ ngôn ngữ "${lang}".`,
    };
  }
  if (caps.referenceAudioRequired && !req.hasReferenceAudio) {
    return { ok: false, reason: `${caps.displayName} cần giọng tham chiếu (voice clone) để tổng hợp.` };
  }
  if (req.hasReferenceAudio && !caps.supportsVoiceClone) {
    return { ok: false, reason: `${caps.displayName} không hỗ trợ nhân bản giọng.` };
  }
  if (req.hasReferenceAudio && caps.referenceTextRequired && !req.hasReferenceText) {
    return { ok: false, reason: `${caps.displayName} cần lời thoại (transcript) của audio tham chiếu.` };
  }
  if (req.speed !== undefined && Math.abs(req.speed - 1) > 1e-6 && !caps.supportsSpeed) {
    return { ok: false, reason: `${caps.displayName} không hỗ trợ điều chỉnh tốc độ.` };
  }
  const device = req.device ?? "auto";
  if (device === "cpu" && !caps.supportsCPU) {
    return { ok: false, reason: `${caps.displayName} chưa được xác minh chạy trên CPU.` };
  }
  if ((device === "cuda" || (device === "auto" && !caps.supportsCPU)) && req.cudaAvailable === false) {
    return { ok: false, reason: `${caps.displayName} cần GPU CUDA nhưng không tìm thấy GPU khả dụng.` };
  }
  return { ok: true };
}

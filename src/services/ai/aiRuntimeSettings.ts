/**
 * Local AI runtime settings (Gate E): models directory, device preference, ASR model folder,
 * default TTS engine. Persisted in App Data (`settings/ai_runtime.json`), never in source.
 *
 * `asrModelId` default "faster-whisper-small" is the DEVELOPMENT VERIFICATION BASELINE only;
 * the production default is still TUNING REQUIRED (to be decided from the real benchmark).
 */
import { readAppDataFile, saveAppDataFile } from "../storage/tauriFsBridge";
import type { AiRuntimeSettings } from "./localAiServices";
import type { DevicePreference, LocalTtsEngineId } from "./ttsEngines";

export interface StoredAiRuntimeSettings extends AiRuntimeSettings {
  defaultTtsEngine: LocalTtsEngineId;
  /** True when modelsDir was explicitly chosen by the user (else App Data default). */
  customModelsDir: boolean;
}

const FILE = "settings/ai_runtime.json";
export const DEV_BASELINE_ASR_MODEL = "faster-whisper-small";

const DEVICES: DevicePreference[] = ["auto", "cuda", "cpu"];
const ENGINES: LocalTtsEngineId[] = ["omnivoice", "chatterbox", "qwen"];

async function defaultModelsDir(): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("ai_models_dir");
}

export function sanitizeAiRuntimeSettings(raw: unknown, fallbackModelsDir: string): StoredAiRuntimeSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const customModelsDir = o.customModelsDir === true && typeof o.modelsDir === "string" && o.modelsDir.trim() !== "";
  return {
    modelsDir: customModelsDir ? String(o.modelsDir) : fallbackModelsDir,
    customModelsDir,
    device: DEVICES.includes(o.device as DevicePreference) ? (o.device as DevicePreference) : "auto",
    asrModelId:
      typeof o.asrModelId === "string" && /^[\w.-]+$/.test(o.asrModelId) ? o.asrModelId : DEV_BASELINE_ASR_MODEL,
    defaultTtsEngine: ENGINES.includes(o.defaultTtsEngine as LocalTtsEngineId)
      ? (o.defaultTtsEngine as LocalTtsEngineId)
      : "omnivoice",
  };
}

export async function loadAiRuntimeSettings(): Promise<StoredAiRuntimeSettings> {
  const fallback = await defaultModelsDir();
  let raw: unknown = null;
  try {
    raw = JSON.parse(await readAppDataFile(FILE));
  } catch {
    raw = null; // first run or unreadable → defaults
  }
  return sanitizeAiRuntimeSettings(raw, fallback);
}

export async function saveAiRuntimeSettings(s: StoredAiRuntimeSettings): Promise<void> {
  await saveAppDataFile(FILE, JSON.stringify(s, null, 2));
}

export interface ModelStatus {
  id: string;
  kind: "asr" | "tts";
  engine: string;
  runtime: string;
  displayName: string;
  sourceRepo: string;
  approxSizeMb: number;
  license: string;
  requiredFiles: string[];
  path: string;
  installed: boolean;
  missingFiles: string[];
  sizeOnDiskMb: number;
}

export async function scanAiModels(modelsDir?: string): Promise<ModelStatus[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ModelStatus[]>("ai_scan_models", { modelsDir: modelsDir || null });
  } catch (e) {
    console.error("ai_scan_models failed:", e);
    return [];
  }
}

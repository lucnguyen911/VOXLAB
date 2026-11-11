/**
 * Local AI runtime settings (Gate E): models directory, device preference, ASR model folder,
 * default TTS engine. Persisted in App Data (`settings/ai_runtime.json`), never in source.
 *
 * Production default is `faster-whisper-large-v3-turbo` (synchronized from `DEFAULT_SUBTITLE_SETTINGS.whisperModel`,
 * verified in Phase 11 `PERFORMANCE.md` §2.4: RTF 0.0225, WER 2.13%, 2.2 GB VRAM standalone / 4.2 GB co-resident).
 * `DEV_BASELINE_ASR_MODEL` ("faster-whisper-small") is used only as the headless fallback when `localStorage` is absent.
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

export function normalizeWhisperModelId(raw?: string | null): string {
  if (!raw) return "large-v3-turbo";
  let s = raw.toLowerCase().trim();
  if (s.startsWith("faster-whisper-")) {
    s = s.slice("faster-whisper-".length);
  }
  if (s.includes("turbo")) return "large-v3-turbo";
  if (s.includes("v3")) return "large-v3";
  if (s.includes("medium")) return "medium";
  if (s.includes("small")) return "small";
  return s;
}

const DEVICES: DevicePreference[] = ["auto", "cuda", "cpu"];
const ENGINES: LocalTtsEngineId[] = ["omnivoice", "chatterbox", "qwen"];

async function defaultModelsDir(): Promise<string> {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
    return "";
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("ai_models_dir");
  } catch {
    return "";
  }
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
  const settings = sanitizeAiRuntimeSettings(raw, fallback);

  // Single Source of Truth: synchronize ASR model from Subtitle settings
  try {
    const { loadSubtitleSettings } = await import("../subtitle/profiles");
    const sub = loadSubtitleSettings();
    if (sub && sub.whisperModel) {
      settings.asrModelId = `faster-whisper-${normalizeWhisperModelId(sub.whisperModel)}`;
    }
  } catch {
    // ignore
  }

  return settings;
}

export const AI_MODELS_CHANGED_EVENT = "voxlab_ai_models_changed";

export function notifyAiModelsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AI_MODELS_CHANGED_EVENT));
  }
}

export function onAiModelsChanged(handler: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(AI_MODELS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(AI_MODELS_CHANGED_EVENT, handler);
}

export async function saveAiRuntimeSettings(s: StoredAiRuntimeSettings): Promise<void> {
  await saveAppDataFile(FILE, JSON.stringify(s, null, 2));
  notifyAiModelsChanged();
}

export async function syncAsrModelToAiRuntime(whisperModel: string): Promise<void> {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
    return;
  }
  try {
    const canonical = normalizeWhisperModelId(whisperModel);
    const targetAsrId = `faster-whisper-${canonical}`;
    const s = await loadAiRuntimeSettings();
    if (s.asrModelId !== targetAsrId) {
      s.asrModelId = targetAsrId;
      await saveAiRuntimeSettings(s);
    }
  } catch (err) {
    console.warn("[aiRuntimeSettings] Failed to sync ASR model to ai_runtime.json:", err);
  }
}

export interface ModelStatus {
  id: string;
  kind: "asr" | "tts";
  engine: string;
  runtime: string;
  displayName: string;
  sourceRepo?: string;
  approxSizeMb: number;
  license?: string;
  requiredFiles?: string[];
  path: string;
  installed: boolean;
  weightsInstalled?: boolean;
  runtimeInstalled?: boolean;
  requiresCuda?: boolean;
  missingFiles: string[];
  sizeOnDiskMb: number;
}

export interface HardwareAcceleratorInfo {
  hasNvidiaGpu: boolean;
  gpuName: string | null;
  mode: "cuda" | "cpu";
}

export interface ModelInstallProgressEvent {
  modelId: string;
  status: "installing" | "completed" | "cancelled" | "error";
  stage: "preparing" | "runtime" | "weights" | "verifying" | "done";
  pct: number;
  message: string;
  downloadedMb?: number | null;
  totalMb?: number | null;
  speedMbps?: number | null;
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

export async function getAiHardwareInfo(): Promise<HardwareAcceleratorInfo> {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
    return { hasNvidiaGpu: false, gpuName: null, mode: "cpu" };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<HardwareAcceleratorInfo>("ai_hardware_info");
  } catch {
    return { hasNvidiaGpu: false, gpuName: null, mode: "cpu" };
  }
}

export async function installAiModel(modelId: string, modelsDir?: string): Promise<ModelStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  const status = await invoke<ModelStatus>("ai_install_model", {
    modelId,
    modelsDir: modelsDir || null,
  });
  notifyAiModelsChanged();
  return status;
}

export async function cancelAiModelInstall(modelId?: string): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("ai_cancel_model_install", {
      modelId: modelId || null,
    });
  } catch {
    return false;
  }
}

export const BOOTSTRAP_JOB_ID = "__bootstrap__";

export interface RuntimeBootstrapStatus {
  ready: boolean;
  hasNvidiaGpu: boolean;
  gpuName: string | null;
  missingRuntimes: string[];
}

export async function getAiBootstrapStatus(): Promise<RuntimeBootstrapStatus> {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
    return { ready: true, hasNvidiaGpu: false, gpuName: null, missingRuntimes: [] };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<RuntimeBootstrapStatus>("ai_bootstrap_status");
  } catch {
    return { ready: true, hasNvidiaGpu: false, gpuName: null, missingRuntimes: [] };
  }
}

export async function bootstrapAiRuntimes(): Promise<RuntimeBootstrapStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  const status = await invoke<RuntimeBootstrapStatus>("ai_bootstrap_runtimes");
  notifyAiModelsChanged();
  return status;
}

export async function onModelInstallProgress(
  handler: (event: ModelInstallProgressEvent) => void
): Promise<() => void> {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
    return () => {};
  }
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<ModelInstallProgressEvent>("ai://model-install-progress", (ev) => {
    if (ev && ev.payload) {
      handler(ev.payload);
    }
  });
  return unlisten;
}

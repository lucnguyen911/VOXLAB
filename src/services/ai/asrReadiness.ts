import { normalizeWhisperModelId, scanAiModels, syncAsrModelToAiRuntime } from "./aiRuntimeSettings";
import { loadSubtitleSettings, saveSubtitleSettings } from "../subtitle/profiles";
import { getSharedAiServices } from "../batch/batchRuntime";
import type { LocalAiServices } from "./localAiServices";

export interface AsrModelInfo {
  id: string; // canonical id: "large-v3-turbo", "large-v3", "medium", "small"
  fullId: string; // e.g. "faster-whisper-large-v3-turbo"
  displayName: string;
  installed: boolean;
  missingFiles?: string[];
  path?: string;
}

export interface AsrReadinessResult {
  ready: boolean;
  selectedModel: string;
  selectedModelDisplayName: string;
  code: "OK" | "MODEL_NOT_FOUND" | "SIDECAR_UNAVAILABLE";
  reason?: string;
  installedModels: AsrModelInfo[];
}

export function getFriendlyAsrName(rawId?: string | null): string {
  const norm = normalizeWhisperModelId(rawId);
  switch (norm) {
    case "large-v3-turbo":
      return "Whisper Large V3 Turbo";
    case "large-v3":
      return "Whisper Large V3";
    case "medium":
      return "Whisper Medium";
    case "small":
      return "Whisper Small";
    default:
      return norm ? `Whisper (${norm})` : "Whisper Large V3 Turbo";
  }
}

/**
 * Checks readiness of the unified ASR subsystem before generating speech.
 * Verifies:
 * 1. Currently selected Whisper model from Subtitle settings (Single Source of Truth).
 * 2. Physical existence of model files (model.bin, config.json, etc.) on disk.
 * 3. Python Sidecar availability.
 *
 * Never silently downgrades without user consent.
 */
export async function checkAsrReadiness(
  targetModel?: string,
  customAi?: LocalAiServices | null
): Promise<AsrReadinessResult> {
  const effectiveModel = targetModel || loadSubtitleSettings().whisperModel || "large-v3-turbo";
  const canonical = normalizeWhisperModelId(effectiveModel);
  const displayName = getFriendlyAsrName(canonical);

  // In test / headless mock environment where Tauri is not present
  const isTauriEnv = typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);

  let scannedModels: AsrModelInfo[] = [];
  if (isTauriEnv) {
    try {
      const rawList = await scanAiModels();
      const asrOnly = rawList.filter((m) => m.kind === "asr" || m.engine === "faster-whisper");
      scannedModels = asrOnly.map((m) => {
        const id = normalizeWhisperModelId(m.id);
        return {
          id,
          fullId: m.id.startsWith("faster-whisper-") ? m.id : `faster-whisper-${m.id}`,
          displayName: m.displayName || getFriendlyAsrName(id),
          installed: Boolean(m.installed),
          missingFiles: m.missingFiles,
          path: m.path,
        };
      });
    } catch (err) {
      console.warn("[asrReadiness] scanAiModels failed:", err);
    }
  }

  const installedModels = scannedModels.filter((m) => m.installed);

  // If in desktop Tauri environment and model scan was performed
  if (isTauriEnv && scannedModels.length > 0) {
    const isTargetInstalled = installedModels.some((m) => m.id === canonical);
    if (!isTargetInstalled) {
      return {
        ready: false,
        selectedModel: canonical,
        selectedModelDisplayName: displayName,
        code: "MODEL_NOT_FOUND",
        reason: `Mô hình nhận dạng giọng nói '${displayName}' chưa được cài đặt hoặc thiếu model.bin trong thư mục lưu trữ.`,
        installedModels,
      };
    }
  }

  // Check sidecar connectivity
  try {
    const ai = customAi !== undefined ? customAi : await getSharedAiServices();
    if (!ai && isTauriEnv) {
      return {
        ready: false,
        selectedModel: canonical,
        selectedModelDisplayName: displayName,
        code: "SIDECAR_UNAVAILABLE",
        reason: "Không thể kết nối đến Sidecar AI để thực hiện kiểm tra chất lượng.",
        installedModels,
      };
    }
  } catch (aiErr: any) {
    if (isTauriEnv) {
      return {
        ready: false,
        selectedModel: canonical,
        selectedModelDisplayName: displayName,
        code: "SIDECAR_UNAVAILABLE",
        reason: `Sidecar AI đang bận hoặc gặp sự cố: ${aiErr?.message || aiErr}`,
        installedModels,
      };
    }
  }

  return {
    ready: true,
    selectedModel: canonical,
    selectedModelDisplayName: displayName,
    code: "OK",
    installedModels,
  };
}

/**
 * Explicitly switches the active ASR model when the user approves.
 * Synchronizes with Subtitle settings and ai_runtime.json.
 */
export async function applyAsrModelSwitch(targetModelId: string): Promise<void> {
  const canonical = normalizeWhisperModelId(targetModelId);
  saveSubtitleSettings({ whisperModel: canonical });
  await syncAsrModelToAiRuntime(canonical);
}

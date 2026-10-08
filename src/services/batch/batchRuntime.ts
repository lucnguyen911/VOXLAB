/**
 * Production wiring for Batch (Gate E): connects the BatchOrchestrator to the real desktop runtime.
 *
 *   file IO      → Tauri fs_* commands (atomic writes in Rust)
 *   inference    → LocalAiServices → TauriAiBackend → Rust SidecarManager → Python sidecar
 *   collisions   → output-folder listing refreshed before every step (external files are seen)
 *   durability   → queue persisted on structural changes
 *
 * Outside Tauri (browser preview / unit tests) nothing is wired and executors fail explicitly.
 */
import { BatchOrchestrator } from "./batchOrchestrator";
import { resolveJobOutputDirectory } from "./outputResolver";
import { LocalAiServices, type AiFs, type AiRuntimeSettings } from "../ai/localAiServices";
import { TauriAiBackend, isTauriRuntime } from "../ai/tauriBackend";
import { loadAiRuntimeSettings } from "../ai/aiRuntimeSettings";
import { loadTtsAdvancedSettings } from "../ai/ttsAdvancedSettings";
import { loadCloneVoiceRegistry } from "../ai/cloneVoiceRegistry";
import { resolveUnifiedVoiceReference, ensurePresetVoiceSamples } from "../ai/presetVoiceRegistry";
import { getAppDataDir } from "../storage/tauriFsBridge";

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

export const tauriAiFs: AiFs = {
  readText: (path) => invoke<string>("fs_read_text", { path }),
  writeText: (path, content) => invoke<void>("fs_write_text", { path, content }),
  listDir: (path) => invoke<string[]>("fs_list_dir", { path }),
  removeFile: (path) => invoke<void>("fs_remove_file", { path }),
  scratchDir: (name) => invoke<string>("fs_scratch_dir", { name }),
};

function normalizeKey(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function joinDir(dir: string, name: string): string {
  const d = dir.replace(/[\\/]+$/, "");
  return `${d}/${name}`;
}

/** Synchronous existence oracle backed by directory listings refreshed before each step. */
export class OutputExistenceIndex {
  private known = new Set<string>();

  constructor(private readonly listDir: (dir: string) => Promise<string[]> = tauriAiFs.listDir) {}

  async refresh(dir: string): Promise<void> {
    const names = await this.listDir(dir).catch(() => [] as string[]);
    for (const n of names) this.known.add(normalizeKey(joinDir(dir, n)));
  }

  /** Record a path written by this app so later steps of the same job see it immediately. */
  mark(path: string): void {
    this.known.add(normalizeKey(path));
  }

  exists = (path: string): boolean => this.known.has(normalizeKey(path));
}

let initialized: Promise<LocalAiServices | null> | null = null;
let currentSettings: AiRuntimeSettings | null = null;
let defaultOutputDir = "";

/** Absolute default Batch output folder (Documents/VoxLab/Batch_Export); "" outside Tauri. */
export function getDefaultBatchOutputDir(): string {
  return defaultOutputDir;
}

/** Idempotent. Returns the shared LocalAiServices, or null outside the Tauri runtime. */
export function initBatchRuntime(): Promise<LocalAiServices | null> {
  if (initialized) return initialized;
  initialized = (async () => {
    if (!isTauriRuntime()) return null;
    currentSettings = await loadAiRuntimeSettings();
    await loadTtsAdvancedSettings();
    try {
      const pathApi = await import("@tauri-apps/api/path");
      defaultOutputDir = await pathApi.join(await pathApi.documentDir(), "VoxLab", "Batch_Export");
    } catch (e) {
      console.warn("Could not determine documentDir via @tauri-apps/api/path:", e);
      defaultOutputDir = "C:/VoxLabOutput";
    }
    await loadCloneVoiceRegistry();
    let appDataDir = "C:/Users/AppData/Roaming/com.voxlab.app";
    try {
      appDataDir = await getAppDataDir();
      await ensurePresetVoiceSamples(appDataDir);
    } catch (e) {
      console.warn("Could not ensure preset voice samples:", e);
    }

    const ai = new LocalAiServices(
      new TauriAiBackend(),
      tauriAiFs,
      () => currentSettings as AiRuntimeSettings,
      (voiceId) => resolveUnifiedVoiceReference(voiceId, appDataDir)
    );

    const orchestrator = BatchOrchestrator.getInstance();
    const index = new OutputExistenceIndex();

    orchestrator.ai = ai;
    orchestrator.fileReader = async (path) => {
      const text = await tauriAiFs.readText(path);
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip UTF-8 BOM
    };
    orchestrator.fileWriter = async (path, content) => {
      if (typeof content !== "string") {
        await invoke<void>("fs_write_bytes", { path, bytes: Array.from(content) });
      } else {
        await tauriAiFs.writeText(path, content);
      }
      index.mark(path);
    };
    orchestrator.pathExists = index.exists;
    orchestrator.fileStatsReader = async (path) => {
      const st = await invoke<{ size: number; mtimeMs: number } | null>("fs_stat", { path });
      return st ? { size: st.size, mtime: st.mtimeMs } : null;
    };
    orchestrator.beforeStep = async (job) => {
      await index.refresh(resolveJobOutputDirectory(job));
    };
    orchestrator.autoPersist = true;
    return ai;
  })();
  return initialized;
}

/** Re-read runtime settings (models dir, device, ASR model) after the user changes them. */
export async function reloadAiRuntimeSettings(): Promise<void> {
  if (currentSettings) currentSettings = await loadAiRuntimeSettings();
  await loadTtsAdvancedSettings();
}

export const getSharedAiServices = initBatchRuntime;

/** Read a file from disk into a Blob URL for webview audio playback. */
export async function readAudioFileBlobUrl(filePath: string): Promise<string> {
  let cleanPath = filePath;
  if (cleanPath.startsWith("file://")) {
    cleanPath = cleanPath.replace(/^file:\/\/\/?/, "");
    cleanPath = decodeURIComponent(cleanPath);
    if (/^\/[a-zA-Z]:/.test(cleanPath)) {
      cleanPath = cleanPath.slice(1);
    }
  }
  const bytes = await invoke<number[]>("fs_read_bytes", { path: cleanPath });
  const ext = cleanPath.toLowerCase().split(".").pop();
  const mime = ext === "mp3" ? "audio/mpeg" : ext === "ogg" ? "audio/ogg" : "audio/wav";
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  return URL.createObjectURL(blob);
}

/** Open or reveal a file or directory in Windows Explorer. */
export async function showPathInFolder(filePath: string): Promise<void> {
  await invoke<void>("fs_show_in_folder", { path: filePath });
}

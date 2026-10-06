/**
 * VoxLab — Tauri Filesystem Storage Bridge
 * Provides atomic persistence for durable state via Tauri v2 Rust IPC commands:
 * `save_app_data_file`, `read_app_data_file`, `get_app_data_dir`.
 * Includes in-memory mock fallback for tests and development without native window.
 */

// In-memory fallback map for Node test environments or web preview
const memoryStorage = new Map<string, string>();
let mockAppDataDir = "C:/Users/AppData/Roaming/com.voxlab.app";
let forceMemoryMode = false;

function isTauriEnvironment(): boolean {
  if (forceMemoryMode) return false;
  if (typeof window === "undefined") return false;
  return Boolean(
    // @ts-ignore
    window.__TAURI_INTERNALS__ || window.__TAURI__
  );
}

/**
 * Returns the absolute path of the app data directory
 */
export async function getAppDataDir(): Promise<string> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string>("get_app_data_dir");
    } catch {
      // Fallback if invoke fails
      return mockAppDataDir;
    }
  }
  return mockAppDataDir;
}

/**
 * Saves a file to the app data directory atomically
 */
export async function saveAppDataFile(
  relativePath: string,
  content: string
): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_app_data_file", { relativePath, content });
      return;
    } catch (err) {
      // If native invoke fails, log and fallback to memory
      console.warn("Tauri save_app_data_file failed, falling back to memory:", err);
    }
  }
  memoryStorage.set(relativePath, content);
}

/**
 * Reads a file from the app data directory
 */
export async function readAppDataFile(relativePath: string): Promise<string> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string>("read_app_data_file", { relativePath });
    } catch (err) {
      // If native invoke fails, check memory fallback
      if (memoryStorage.has(relativePath)) {
        return memoryStorage.get(relativePath)!;
      }
      throw new Error(`File not found: ${relativePath} (${err})`);
    }
  }

  if (memoryStorage.has(relativePath)) {
    return memoryStorage.get(relativePath)!;
  }
  throw new Error(`File not found: ${relativePath}`);
}

/**
 * Checks if a file exists in the app data directory
 */
export async function existsAppDataFile(relativePath: string): Promise<boolean> {
  try {
    await readAppDataFile(relativePath);
    return true;
  } catch {
    return false;
  }
}

// Test / Mock Helper Utilities
export function setForceMemoryMode(enabled: boolean): void {
  forceMemoryMode = enabled;
}

export function clearMemoryStorage(): void {
  memoryStorage.clear();
}

export function setMemoryFile(relativePath: string, content: string): void {
  memoryStorage.set(relativePath, content);
}

export function getMemoryFile(relativePath: string): string | undefined {
  return memoryStorage.get(relativePath);
}

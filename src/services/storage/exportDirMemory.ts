/**
 * Shared last-used export directory memory across Master exports (`Ghép & xuất`)
 * and single-chunk / preview downloads (`BottomAudioPlayer`).
 */

const LAST_EXPORT_DIR_KEY = "voxlab_last_export_dir";

export function sanitizeExportFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[\s.]+$/, "")
    .trim();
}

export function extractParentDir(filePath: string): string | null {
  if (!filePath) return null;
  const trimmed = filePath.trim();
  const lastBackslash = trimmed.lastIndexOf("\\");
  const lastSlash = trimmed.lastIndexOf("/");
  const sepIdx = Math.max(lastBackslash, lastSlash);
  if (sepIdx <= 0) return null;

  const parent = trimmed.slice(0, sepIdx);
  // Preserve Windows drive root separator (e.g. "D:\" or "D:/")
  if (sepIdx === 2 && /^[a-zA-Z]:$/.test(parent)) {
    return trimmed.slice(0, 3);
  }
  return parent;
}

export function getLastExportDir(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LAST_EXPORT_DIR_KEY);
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export function saveLastExportDirFromFilePath(filePath: string): void {
  const parent = extractParentDir(filePath);
  if (!parent) return;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LAST_EXPORT_DIR_KEY, parent);
    }
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function clearLastExportDir(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(LAST_EXPORT_DIR_KEY);
    }
  } catch {
    // Ignore
  }
}

export function buildDefaultExportPath(defaultFilename: string): string {
  const safeName = sanitizeExportFilename(defaultFilename) || "VoxLab_Audio.wav";
  const lastDir = getLastExportDir();
  if (!lastDir) return safeName;

  const sep = lastDir.includes("\\") ? "\\" : "/";
  const baseDir = /^[a-zA-Z]:[\\/]$/.test(lastDir)
    ? lastDir.slice(0, 2)
    : lastDir.replace(/[\\/]+$/, "");
  return `${baseDir}${sep}${safeName}`;
}

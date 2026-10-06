/**
 * Output Resolver & Artifact Fingerprinting (TASK-06 / AC-13, AC-17, AC-18, AC-30, AC-31, AC-32)
 *
 * Enforces Output Safety Invariants:
 * 1. External Modification Protection > Global Collision Policy (AC-17).
 * 2. Mandatory Per-File Output Subfolder & Disambiguation (AC-31).
 * 3. Save In Source Folder vs Common Output Path (AC-32).
 * 4. Dubbing Granular Skip: Skip subtitle if present but generate audio (AC-18).
 * 5. Reusable Subtitle Format Conversion (SRT <-> VTT) via domain services (AC-30).
 */

import { BatchCollisionPolicy, BatchJob } from "../../types/batch";
import { parseSubtitle } from "../subtitle/parser";
import { exportToSrt, exportToVtt } from "../subtitle/exporter";
import { SubtitleCue } from "../subtitle/types";

export interface ArtifactFingerprint {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface ResolveArtifactPathParams {
  outputDir: string;
  baseName: string;
  extension: string;
  collisionPolicy: BatchCollisionPolicy;
  recordedFingerprint?: ArtifactFingerprint;
  currentFileStats?: { size: number; mtimeMs: number } | null;
  checkPathExists?: (path: string) => boolean;
}

export type ArtifactResolutionAction = "write" | "skip" | "auto_renamed" | "overwrite";

export interface ResolveArtifactPathResult {
  resolvedPath: string;
  action: ArtifactResolutionAction;
  isExternalModified: boolean;
}

/**
 * Normalizes file path separators to standard forward slashes.
 */
export function normalizePath(pathStr: string): string {
  return pathStr.replace(/\\/g, "/").replace(/\/+/g, "/");
}

/**
 * Derives parent folder directory from a file path.
 */
export function getFileDirectory(filePath: string): string {
  const normalized = normalizePath(filePath);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return ".";
  }
  return normalized.slice(0, lastSlash);
}

/**
 * Derives file stem (name without extension) from file path or file name.
 */
export function getFileStem(filePathOrName: string): string {
  const normalized = normalizePath(filePathOrName);
  const lastSlash = normalized.lastIndexOf("/");
  const fileName = lastSlash !== -1 ? normalized.slice(lastSlash + 1) : normalized;
  const lastDot = fileName.lastIndexOf(".");
  return lastDot !== -1 ? fileName.slice(0, lastDot) : fileName;
}

/**
 * Resolves the mandatory per-file subfolder for a batch job (AC-31, AC-32).
 */
export function resolveJobOutputDirectory(
  job: BatchJob,
  disambiguator?: string
): string {
  const outputCfg = job.outputSnapshot;
  const saveInSourceFolder = outputCfg?.saveInSourceFolder ?? false;
  const configuredOutputPath = outputCfg?.resolvedOutputDirectory?.trim() || "./output";

  let baseDir: string;
  if (saveInSourceFolder && job.sourceFilePath) {
    baseDir = getFileDirectory(job.sourceFilePath);
  } else {
    baseDir = configuredOutputPath;
  }

  let folderName = getFileStem(job.sourceFileName || job.sourceFilePath || "job_output");
  if (disambiguator) {
    const cleanDisambiguator = disambiguator.replace(/^[_.-]+/, "");
    folderName = `${folderName}_${cleanDisambiguator}`;
  }

  return normalizePath(`${baseDir}/${folderName}`);
}

/**
 * Determines whether a file on disk has been modified externally compared to recorded fingerprint.
 */
export function isArtifactModifiedExternally(
  recorded: ArtifactFingerprint | undefined,
  current: { size: number; mtimeMs: number } | null | undefined
): boolean {
  if (!current) {
    return false;
  }
  if (!recorded) {
    // If destination exists but was never recorded by the app, treat as external modification
    return true;
  }

  // Size mismatch is definitive
  if (recorded.size !== current.size) {
    return true;
  }

  // Mtime mismatch with 1-second margin of tolerance for filesystem timestamps
  if (Math.abs(recorded.mtimeMs - current.mtimeMs) > 1000) {
    return true;
  }

  return false;
}

/**
 * Resolves safe artifact path implementing:
 * External Modification Protection > Global Collision Policy (AC-17).
 */
export function resolveArtifactPath(
  params: ResolveArtifactPathParams
): ResolveArtifactPathResult {
  const {
    outputDir,
    baseName,
    extension,
    collisionPolicy,
    recordedFingerprint,
    currentFileStats,
    checkPathExists = () => false,
  } = params;

  const cleanExt = extension.replace(/^\./, "");
  const normalizedDir = normalizePath(outputDir);
  const primaryPath = normalizePath(`${normalizedDir}/${baseName}.${cleanExt}`);

  const exists = checkPathExists(primaryPath);
  if (!exists) {
    return {
      resolvedPath: primaryPath,
      action: "write",
      isExternalModified: false,
    };
  }

  // File exists on disk - verify if externally modified
  const isExternalModified = isArtifactModifiedExternally(
    recordedFingerprint,
    currentFileStats
  );

  // AC-17: If externally modified, NEVER overwrite, unconditionally fallback to auto_rename
  if (isExternalModified) {
    const autoRenamedPath = findNextAvailableNumberedPath(
      normalizedDir,
      baseName,
      cleanExt,
      checkPathExists
    );
    return {
      resolvedPath: autoRenamedPath,
      action: "auto_renamed",
      isExternalModified: true,
    };
  }

  // Not externally modified: apply collision policy
  if (collisionPolicy === "skip") {
    return {
      resolvedPath: primaryPath,
      action: "skip",
      isExternalModified: false,
    };
  }

  if (collisionPolicy === "overwrite") {
    return {
      resolvedPath: primaryPath,
      action: "overwrite",
      isExternalModified: false,
    };
  }

  // collisionPolicy === "auto_rename"
  const autoRenamedPath = findNextAvailableNumberedPath(
    normalizedDir,
    baseName,
    cleanExt,
    checkPathExists
  );
  return {
    resolvedPath: autoRenamedPath,
    action: "auto_renamed",
    isExternalModified: false,
  };
}

/**
 * Generates sequentially numbered paths (_001, _002, ...) until an unused path is found.
 */
function findNextAvailableNumberedPath(
  dir: string,
  baseName: string,
  ext: string,
  checkPathExists: (p: string) => boolean
): string {
  let counter = 1;
  while (counter < 10000) {
    const suffix = String(counter).padStart(3, "0");
    const candidate = normalizePath(`${dir}/${baseName}_${suffix}.${ext}`);
    if (!checkPathExists(candidate)) {
      return candidate;
    }
    counter++;
  }
  return normalizePath(`${dir}/${baseName}_${Date.now()}.${ext}`);
}

/**
 * Dubbing Granular Skip Helper (AC-18):
 * Evaluates whether a specific artifact in dubbing should be skipped.
 */
export function shouldSkipDubbingArtifact(
  artifactPath: string,
  collisionPolicy: BatchCollisionPolicy,
  checkPathExists: (path: string) => boolean
): boolean {
  if (collisionPolicy !== "skip") {
    return false;
  }
  return checkPathExists(artifactPath);
}

/**
 * Converts subtitle formats (SRT <-> VTT) reusing domain parser and exporter (AC-30).
 * Strictly forbids re-implementing subtitle converter.
 */
export function convertSubtitleFormat(
  content: string,
  fromFormat: "srt" | "vtt",
  toFormat: "srt" | "vtt"
): string {
  if (fromFormat === toFormat) {
    return content;
  }

  const originalCues = parseSubtitle(content);
  if (!originalCues || originalCues.length === 0) {
    throw new Error("Không có phụ đề hợp lệ để chuyển đổi định dạng.");
  }

  const subtitleCues: SubtitleCue[] = originalCues.map((c, i) => ({
    index: i + 1,
    startSec: c.startSec,
    endSec: c.endSec,
    text: c.text,
  }));

  if (toFormat === "vtt") {
    return exportToVtt(subtitleCues);
  } else {
    return exportToSrt(subtitleCues);
  }
}

/**
 * Convenience namespace for OutputResolver functions
 */
export const OutputResolver = {
  resolveArtifactPath,
  resolveJobOutputDirectory,
  getFileStem,
  getFileDirectory,
  normalizePath,
  isArtifactModifiedExternally,
  resolveOutputPath: (
    sourceFilePath: string,
    outputSnapshot: { resolvedOutputDirectory: string; saveInSourceFolder?: boolean; collisionPolicy?: BatchCollisionPolicy },
    extension: string,
    checkPathExists: (p: string) => boolean = () => false
  ) => {
    const baseDir =
      outputSnapshot.saveInSourceFolder && sourceFilePath
        ? getFileDirectory(sourceFilePath)
        : outputSnapshot.resolvedOutputDirectory?.trim() || "./output";
    const subfolder = getFileStem(sourceFilePath || "output");
    const fullDir = normalizePath(`${baseDir}/${subfolder}`);
    const res = resolveArtifactPath({
      outputDir: fullDir,
      baseName: subfolder,
      extension: extension.replace(/^\./, ""),
      collisionPolicy: outputSnapshot.collisionPolicy || "auto_rename",
      checkPathExists,
    });
    return res.resolvedPath;
  },
};


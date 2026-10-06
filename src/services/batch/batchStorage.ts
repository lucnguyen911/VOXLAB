/**
 * VoxLab — Batch Durable State Storage & Crash Normalizer
 * Specification: SPEC-batch.md v3.2.0 (AC-09, AC-10, AC-11, AC-24, AC-25)
 * Storage Target: batch_queue_v3.json via Atomic Tauri FS Bridge
 */

import {
  BatchQueueDurableState,
  BatchJob,
  BatchSessionSettings,
  BatchQueueStatus,
  BatchStepResult,
  BatchTaskType,
} from "../../types/batch";
import {
  readAppDataFile,
  saveAppDataFile,
  existsAppDataFile,
} from "../storage/tauriFsBridge";
import {
  getDefaultTaskConfigMap,
} from "./configSnapshotResolver";

export const BATCH_STORAGE_FILE = "batch_queue_v3.json";
export const BATCH_SCHEMA_VERSION = 3;

/**
 * Creates default initial settings for Batch Workspace
 */
export function createDefaultSessionSettings(): BatchSessionSettings {
  return {
    outputDirectory: "",
    saveInSourceFolder: false,
    collisionPolicy: "auto_rename",
    outputAudioFormat: "wav",
    outputSubtitleFormat: "srt",
    globalDefaults: getDefaultTaskConfigMap(),
  };
}

/**
 * Creates a clean default durable state
 */
export function createInitialBatchState(): BatchQueueDurableState {
  return {
    version: BATCH_SCHEMA_VERSION,
    queueStatus: "idle",
    settings: createDefaultSessionSettings(),
    jobs: [],
    updatedAt: Date.now(),
  };
}

/**
 * Normalizes state upon app startup if previous session closed unexpectedly (Crash Recovery Normalizer - AC-09, AC-24).
 * Invariants:
 * 1. Queue status in running/pausing/cancelling is reverted to paused.
 * 2. In-flight jobs with status "processing" are reverted to "interrupted".
 * 3. In-flight steps with status "processing" are reverted to "interrupted" with progressPct = 0.
 * 4. Transient runtime flags (isCancelling) are cleared.
 * 5. Committed artifacts of finished steps remain preserved 100%.
 */
export function normalizeCrashedState(state: BatchQueueDurableState): BatchQueueDurableState {
  let needsNormalization = false;

  // 1. Normalize Queue Status
  let queueStatus: BatchQueueStatus = state.queueStatus;
  if (
    queueStatus === "running" ||
    queueStatus === "pausing" ||
    queueStatus === "cancelling"
  ) {
    queueStatus = "paused";
    needsNormalization = true;
  }

  // 2. Normalize Jobs
  const normalizedJobs: BatchJob[] = state.jobs.map((job) => {
    let jobChanged = false;
    let jobStatus = job.status;
    let isCancelling = job.isCancelling;

    if (isCancelling) {
      isCancelling = undefined;
      jobChanged = true;
    }

    if (jobStatus === "processing") {
      jobStatus = "interrupted";
      jobChanged = true;
    }

    // Normalize Step Results
    const normalizedStepResults: Partial<Record<BatchTaskType, BatchStepResult>> = {};
    for (const [taskKey, step] of Object.entries(job.stepResults || {})) {
      const task = taskKey as BatchTaskType;
      if (!step) continue;

      if (step.status === "processing") {
        normalizedStepResults[task] = {
          ...step,
          status: "interrupted",
          progressPct: 0,
          stageMessage: "Gián đoạn do ứng dụng bị tắt đột ngột",
        };
        jobChanged = true;
      } else {
        // Completed artifacts are preserved intact
        normalizedStepResults[task] = step;
      }
    }

    if (jobChanged) {
      needsNormalization = true;
      return {
        ...job,
        status: jobStatus,
        isCancelling,
        stepResults: normalizedStepResults,
      };
    }

    return job;
  });

  if (!needsNormalization) {
    return state;
  }

  return {
    ...state,
    queueStatus,
    jobs: normalizedJobs,
    updatedAt: Date.now(),
  };
}

/**
 * Validates that an object contains zero audio binary data (PCM, base64, buffer)
 */
function assertZeroAudioBinary(obj: unknown, path = "root"): void {
  if (!obj || typeof obj !== "object") return;

  if (obj instanceof Uint8Array || obj instanceof ArrayBuffer) {
    throw new Error(`Zero Audio Binary Invariant Violated: Raw buffer found at ${path}`);
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      assertZeroAudioBinary(obj[i], `${path}[${i}]`);
    }
    return;
  }

  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === "string" && val.startsWith("data:audio/") && val.length > 500) {
      throw new Error(`Zero Audio Binary Invariant Violated: Base64 audio found at ${path}.${key}`);
    }
    assertZeroAudioBinary(val, `${path}.${key}`);
  }
}

/**
 * Loads durable state from disk.
 * If file does not exist, returns initial state.
 * If file is corrupt or older schema version, safely backs it up and resets.
 * Normalizes any in-flight crashed jobs.
 */
export async function loadBatchState(): Promise<BatchQueueDurableState> {
  const fileExists = await existsAppDataFile(BATCH_STORAGE_FILE);
  if (!fileExists) {
    return createInitialBatchState();
  }

  let content: string;
  try {
    content = await readAppDataFile(BATCH_STORAGE_FILE);
  } catch {
    return createInitialBatchState();
  }

  try {
    const rawData = JSON.parse(content);

    // Schema Version Validation
    if (!rawData || rawData.version !== BATCH_SCHEMA_VERSION) {
      // Backup older or invalid file
      const backupPath = `${BATCH_STORAGE_FILE}.backup-${Date.now()}`;
      await saveAppDataFile(backupPath, content);
      console.warn(
        `Incompatible batch schema version (${rawData?.version}). Backed up to ${backupPath} and resetting.`
      );
      const newState = createInitialBatchState();
      await saveBatchState(newState);
      return newState;
    }

    // Normalize any crashed or interrupted jobs
    const normalized = normalizeCrashedState(rawData as BatchQueueDurableState);
    if (normalized !== rawData) {
      await saveBatchState(normalized);
    }
    return normalized;
  } catch (parseError) {
    // Corrupt JSON: Backup and reset safely
    const backupPath = `${BATCH_STORAGE_FILE}.corrupt-${Date.now()}`;
    await saveAppDataFile(backupPath, content);
    console.error(`Corrupt batch state JSON. Backed up to ${backupPath}.`, parseError);
    const cleanState = createInitialBatchState();
    await saveBatchState(cleanState);
    return cleanState;
  }
}

/**
 * Saves durable state to disk atomically via Tauri FS Bridge.
 * Enforces Zero Audio Binary Invariant.
 */
export async function saveBatchState(state: BatchQueueDurableState): Promise<void> {
  assertZeroAudioBinary(state);

  const payload: BatchQueueDurableState = {
    ...state,
    version: BATCH_SCHEMA_VERSION,
    updatedAt: Date.now(),
  };

  const jsonString = JSON.stringify(payload, null, 2);
  await saveAppDataFile(BATCH_STORAGE_FILE, jsonString);
}

/**
 * Convenience helper to save jobs and queueStatus while preserving existing settings.
 */
export async function saveBatchQueueState(
  jobs: BatchJob[],
  queueStatus: BatchQueueStatus,
  settings?: BatchSessionSettings
): Promise<void> {
  const currentState = await loadBatchState();
  const nextState: BatchQueueDurableState = {
    ...currentState,
    queueStatus,
    jobs,
    settings: settings || currentState.settings,
    updatedAt: Date.now(),
  };
  await saveBatchState(nextState);
}


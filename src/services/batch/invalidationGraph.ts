/**
 * VoxLab — Batch Config Invalidation Graph & Mutation Safety (TASK-11 / AC-11, AC-12, AC-26, AC-30)
 *
 * Implements:
 * 1. Topological Invalidation Propagation across executionSequence.
 * 2. Earliest Invalidated Step Detection.
 * 3. Step Artifact Preservation vs Invalidation filtering.
 * 4. Input Mutation Safety (mtime/size check) with stale artifact tagging.
 */

import { BatchJob, BatchTaskType } from "../../types/batch";

export interface InputMutationCheckResult {
  mutated: boolean;
  sizeChanged: boolean;
  mtimeChanged: boolean;
  warningMessage?: string;
}

/**
 * Returns the earliest step in executionSequence that is invalidated by changes.
 * Because executionSequence is topologically ordered (upstream -> downstream),
 * any change to an upstream task invalidates that task AND all downstream tasks.
 */
export function getEarliestInvalidatedStep(
  changedTasks: BatchTaskType[],
  executionSequence: BatchTaskType[]
): BatchTaskType | undefined {
  if (!changedTasks || changedTasks.length === 0 || !executionSequence) {
    return undefined;
  }

  for (const step of executionSequence) {
    if (changedTasks.includes(step)) {
      return step;
    }
  }

  return undefined;
}

/**
 * Returns all steps in executionSequence that must be re-run,
 * starting from earliestInvalidatedStep to the end of the sequence.
 */
export function getInvalidatedSteps(
  earliestInvalidatedStep: BatchTaskType,
  executionSequence: BatchTaskType[]
): BatchTaskType[] {
  const startIndex = executionSequence.indexOf(earliestInvalidatedStep);
  if (startIndex === -1) return [];
  return executionSequence.slice(startIndex);
}

/**
 * Returns all steps that can safely retain their committed artifacts,
 * i.e. steps strictly prior to earliestInvalidatedStep in executionSequence.
 */
export function getPreservedSteps(
  earliestInvalidatedStep: BatchTaskType,
  executionSequence: BatchTaskType[]
): BatchTaskType[] {
  const startIndex = executionSequence.indexOf(earliestInvalidatedStep);
  if (startIndex === -1) return [...executionSequence];
  return executionSequence.slice(0, startIndex);
}

/**
 * Determines whether a step's artifacts can be reused based on the invalidation point.
 */
export function canReuseStepArtifact(
  stepTask: BatchTaskType,
  earliestInvalidatedStep?: BatchTaskType,
  executionSequence: BatchTaskType[] = []
): boolean {
  if (!earliestInvalidatedStep) {
    return true; // No invalidation
  }

  const targetIdx = executionSequence.indexOf(stepTask);
  const invalIdx = executionSequence.indexOf(earliestInvalidatedStep);

  if (targetIdx === -1 || invalIdx === -1) {
    return false;
  }

  return targetIdx < invalIdx;
}

/**
 * Checks if the source file on disk has been mutated outside the app.
 * If mutated:
 * - Flags warning: "⚠️ Đã sửa ngoài app"
 * - Invalidation: Entire pipeline must re-run from Step 1 (zero cache reuse)
 * - Old committed artifacts are preserved but marked stale: true
 */
export function checkInputFileMutation(
  job: BatchJob,
  currentDiskSize: number,
  currentDiskMtime: number
): InputMutationCheckResult {
  const sizeChanged = job.sourceFileSize > 0 && currentDiskSize !== job.sourceFileSize;
  const mtimeChanged = job.sourceFileMtime > 0 && currentDiskMtime !== job.sourceFileMtime;

  if (sizeChanged || mtimeChanged) {
    return {
      mutated: true,
      sizeChanged,
      mtimeChanged,
      warningMessage: "⚠️ Đã sửa ngoài app",
    };
  }

  return {
    mutated: false,
    sizeChanged: false,
    mtimeChanged: false,
  };
}

/**
 * Applies Input Mutation to a BatchJob:
 * - Updates size and mtime
 * - Marks warning message
 * - Sets artifacts.stale = true
 * - Clears reusable cache, forcing re-execution from first step
 */
export function applyInputMutationToJob(
  job: BatchJob,
  newSize: number,
  newMtime: number
): void {
  job.sourceFileSize = newSize;
  job.sourceFileMtime = newMtime;
  job.warningMessage = "⚠️ Đã sửa ngoài app";

  // Retain committed artifacts on disk, but tag as stale
  if (job.artifacts) {
    job.artifacts.stale = true;
  }

  // Force re-run from first step
  if (job.executionSequence && job.executionSequence.length > 0) {
    job.retryFromStep = job.executionSequence[0];
  }
}

/**
 * VoxLab — Batch Config Diff Resolver & Invalidation Graph
 * Specification: SPEC-batch.md v3.2.0 (AC-14, AC-26)
 */

import {
  BatchJob,
  BatchTaskType,
  BatchEffectiveConfigSnapshot,
  ConfigDiffResult,
  BatchDynamicCtaType,
} from "../../types/batch";

/**
 * Checks deep equality of two JSON-serializable primitives/objects
 */
function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return a === b;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);

  if (keysA.length !== keysB.length) return false;

  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!isDeepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }

  return true;
}

/**
 * Normalizes output snapshot to exclude UI-only or transient fields for comparison
 */
function normalizeOutputConfig(output: Record<string, unknown>): Record<string, unknown> {
  return {
    resolvedOutputDirectory: output.resolvedOutputDirectory || "",
    saveInSourceFolder: Boolean(output.saveInSourceFolder),
    collisionPolicy: output.collisionPolicy || "auto_rename",
    outputAudioFormat: output.outputAudioFormat || "wav",
    outputSubtitleFormat: output.outputSubtitleFormat || "srt",
  };
}

/**
 * Computes deep difference between working config and frozen execution snapshot.
 * Determines invalidation graph starting step and 3-way Dynamic CTA.
 */
export function computeJobConfigDiff(
  job: BatchJob,
  workingConfig: BatchEffectiveConfigSnapshot
): ConfigDiffResult {
  const snapshot = job.effectiveConfigSnapshot;

  // If no snapshot exists yet (never executed), baseline is not changed
  if (!snapshot) {
    return {
      hasChanged: false,
      aiConfigChanged: false,
      outputConfigChanged: false,
      changedTasks: [],
      changedFields: [],
      canReuseArtifacts: true,
      recommendedCta: "retry",
    };
  }

  const changedTasks: BatchTaskType[] = [];
  const changedFields: string[] = [];

  // 1. Compare AI Task Configurations for tasks in executionSequence
  const tasksToCheck = job.executionSequence.length > 0 ? job.executionSequence : job.selectedTasks;

  for (const task of tasksToCheck) {
    const snapTaskConfig = snapshot.tasks[task];
    const workTaskConfig = workingConfig.tasks[task];

    if (!isDeepEqual(snapTaskConfig, workTaskConfig)) {
      changedTasks.push(task);
      changedFields.push(`tasks.${task}`);
    }
  }

  const aiConfigChanged = changedTasks.length > 0;

  // 2. Compare Output Configurations
  const normSnapOutput = normalizeOutputConfig(snapshot.output as unknown as Record<string, unknown>);
  const normWorkOutput = normalizeOutputConfig(workingConfig.output as unknown as Record<string, unknown>);

  const outputChanged = !isDeepEqual(normSnapOutput, normWorkOutput);
  if (outputChanged) {
    changedFields.push("output");
  }

  const hasChanged = aiConfigChanged || outputChanged;

  // 3. Determine Invalidation Starting Step based on topological order
  let invalidatedFromStep: BatchTaskType | undefined;
  if (aiConfigChanged) {
    // Find the first task in the execution sequence that changed
    for (const step of job.executionSequence) {
      if (changedTasks.includes(step)) {
        invalidatedFromStep = step;
        break;
      }
    }
  }

  // 4. Artifact Reusability Check
  // Can only reuse artifacts if NO AI tasks changed, and all previous step artifacts exist
  let canReuseArtifacts = false;
  if (!aiConfigChanged && outputChanged) {
    const hasAnyArtifacts =
      (job.artifacts.ownedArtifactPaths && job.artifacts.ownedArtifactPaths.length > 0) ||
      Boolean(job.artifacts.primaryPath);
    canReuseArtifacts = hasAnyArtifacts;
  }

  // 5. Recommended 3-Way Dynamic CTA
  let recommendedCta: BatchDynamicCtaType = "retry";
  if (!hasChanged) {
    recommendedCta = "retry";
  } else if (aiConfigChanged) {
    recommendedCta = "regenerate";
  } else if (outputChanged) {
    recommendedCta = canReuseArtifacts ? "reexport" : "regenerate";
  }

  return {
    hasChanged,
    aiConfigChanged,
    outputConfigChanged: outputChanged,
    changedTasks,
    changedFields,
    invalidatedFromStep,
    canReuseArtifacts,
    recommendedCta,
  };
}

/**
 * VoxLab — Batch Task Dependency & Execution Sequence Resolver
 * Specification: SPEC-batch.md v3.2.0 (AC-05, AC-07, AC-08, AC-44)
 */

import { BatchFileKind, BatchTaskType } from "../../types/batch";

export interface PrerequisiteResolutionResult {
  resolvedTasks: BatchTaskType[];
  autoEnabledTasks: BatchTaskType[];
  noticeMessages: string[];
}

export interface UncheckGuardResult {
  canUncheck: boolean;
  blockingTasks: BatchTaskType[];
  reason?: string;
}

export interface ConditionalTranslationResult {
  shouldSkip: boolean;
  skipReason?: string;
}

/**
 * Automatically enables required prerequisite tasks based on file kind, selected tasks,
 * and language options (AC-05, AC-08).
 */
export function resolvePrerequisites(
  tasks: BatchTaskType[],
  fileKind: BatchFileKind,
  isDialogueScript: boolean = false,
  sourceLanguage?: string,
  targetLanguage?: string
): PrerequisiteResolutionResult {
  const currentSet = new Set<BatchTaskType>(tasks);
  const autoEnabled: BatchTaskType[] = [];
  const notices: string[] = [];

  const isDifferentLanguage =
    !sourceLanguage ||
    sourceLanguage === "auto" ||
    !targetLanguage ||
    sourceLanguage.toLowerCase().trim() !== targetLanguage.toLowerCase().trim();

  if (fileKind === "media") {
    // 1. Media + Translation => Auto-enable Transcription
    if (currentSet.has("translation") && !currentSet.has("transcription")) {
      currentSet.add("transcription");
      autoEnabled.push("transcription");
      notices.push("Đã tự động bật Phụ đề vì Dịch cần dữ liệu phụ đề từ âm thanh.");
    }

    // 2. Media + Dubbing => Auto-enable Transcription (and Translation if languages differ)
    if (currentSet.has("dubbing")) {
      if (!currentSet.has("transcription")) {
        currentSet.add("transcription");
        autoEnabled.push("transcription");
        notices.push("Đã tự động bật Phụ đề vì Lồng tiếng cần dữ liệu phụ đề.");
      }
      if (isDifferentLanguage && !currentSet.has("translation")) {
        currentSet.add("translation");
        autoEnabled.push("translation");
        notices.push("Đã tự động bật Dịch thuật vì ngôn ngữ nguồn khác ngôn ngữ đích.");
      }
    }
  } else if (fileKind === "text") {
    // Determine base audio task: TTS for normal text, Dialogue for dialogue script
    const baseAudioTask: BatchTaskType = isDialogueScript ? "dialogue" : "tts";
    const baseAudioName = isDialogueScript ? "Hội thoại" : "TTS";

    // 1. Text + Subtitle (transcription) => Auto-enable TTS or Dialogue (AC-05, AC-44)
    if (currentSet.has("transcription") && !currentSet.has(baseAudioTask)) {
      currentSet.add(baseAudioTask);
      autoEnabled.push(baseAudioTask);
      notices.push(`Đã tự động bật ${baseAudioName} để tạo âm thanh nền tảng cho phụ đề.`);
    }

    // 2. Text + Translation => Auto-enable Subtitle (transcription) and Base Audio (TTS/Dialogue)
    if (currentSet.has("translation")) {
      if (!currentSet.has("transcription")) {
        currentSet.add("transcription");
        autoEnabled.push("transcription");
        notices.push("Đã tự động bật Phụ đề vì Dịch cần dữ liệu phụ đề từ kịch bản.");
      }
      if (!currentSet.has(baseAudioTask)) {
        currentSet.add(baseAudioTask);
        autoEnabled.push(baseAudioTask);
        notices.push(`Đã tự động bật ${baseAudioName} để tạo âm thanh nền tảng cho văn bản.`);
      }
    }

    // 3. Text + Dubbing => Auto-enable Subtitle, Base Audio, and Translation (if different language)
    if (currentSet.has("dubbing")) {
      if (!currentSet.has("transcription")) {
        currentSet.add("transcription");
        autoEnabled.push("transcription");
        notices.push("Đã tự động bật Phụ đề vì Lồng tiếng cần dữ liệu phụ đề.");
      }
      if (!currentSet.has(baseAudioTask)) {
        currentSet.add(baseAudioTask);
        autoEnabled.push(baseAudioTask);
        notices.push(`Đã tự động bật ${baseAudioName} để tạo âm thanh nền tảng cho văn bản.`);
      }
      if (isDifferentLanguage && !currentSet.has("translation")) {
        currentSet.add("translation");
        autoEnabled.push("translation");
        notices.push("Đã tự động bật Dịch thuật vì Lồng tiếng cần bản dịch ngôn ngữ đích.");
      }
    }
  } else if (fileKind === "subtitle") {
    // Subtitle file input: Only Translation and Dubbing
    if (currentSet.has("dubbing") && isDifferentLanguage && !currentSet.has("translation")) {
      currentSet.add("translation");
      autoEnabled.push("translation");
      notices.push("Đã tự động bật Dịch thuật vì Lồng tiếng cần bản dịch sang ngôn ngữ đích.");
    }
  }

  const resolvedTasks = computeExecutionSequence(Array.from(currentSet), fileKind);

  return {
    resolvedTasks,
    autoEnabledTasks: autoEnabled,
    noticeMessages: notices,
  };
}

/**
 * Computes deterministic linear execution sequence following DAG order for the file kind.
 */
export function computeExecutionSequence(
  tasks: BatchTaskType[],
  fileKind: BatchFileKind
): BatchTaskType[] {
  const taskSet = new Set(tasks);

  let fullDagOrder: BatchTaskType[];
  switch (fileKind) {
    case "text":
      fullDagOrder = ["tts", "dialogue", "transcription", "translation", "dubbing"];
      break;
    case "media":
      fullDagOrder = ["transcription", "translation", "dubbing"];
      break;
    case "subtitle":
      fullDagOrder = ["translation", "dubbing"];
      break;
    default:
      fullDagOrder = ["tts", "dialogue", "transcription", "translation", "dubbing"];
      break;
  }

  return fullDagOrder.filter((t) => taskSet.has(t));
}

/**
 * Guard preventing prerequisite tasks from being disabled if downstream tasks depend on them.
 */
export function canUncheckTask(
  taskToUncheck: BatchTaskType,
  currentTasks: BatchTaskType[],
  fileKind: BatchFileKind
): UncheckGuardResult {
  const currentSet = new Set(currentTasks);
  const blocking: BatchTaskType[] = [];

  if (fileKind === "media") {
    if (taskToUncheck === "transcription") {
      if (currentSet.has("translation")) blocking.push("translation");
      if (currentSet.has("dubbing")) blocking.push("dubbing");
      if (blocking.length > 0) {
        return {
          canUncheck: false,
          blockingTasks: blocking,
          reason: "Không thể tắt Phụ đề (ASR) khi Dịch thuật hoặc Lồng tiếng đang bật.",
        };
      }
    }
    if (taskToUncheck === "translation") {
      if (currentSet.has("dubbing")) {
        return {
          canUncheck: false,
          blockingTasks: ["dubbing"],
          reason: "Không thể tắt Dịch thuật khi Lồng tiếng đang bật.",
        };
      }
    }
  } else if (fileKind === "text") {
    if (taskToUncheck === "tts" || taskToUncheck === "dialogue") {
      if (currentSet.has("transcription")) blocking.push("transcription");
      if (currentSet.has("translation")) blocking.push("translation");
      if (currentSet.has("dubbing")) blocking.push("dubbing");
      if (blocking.length > 0) {
        return {
          canUncheck: false,
          blockingTasks: blocking,
          reason: `Không thể tắt ${taskToUncheck === "tts" ? "TTS" : "Hội thoại"} khi Phụ đề, Dịch thuật hoặc Lồng tiếng đang bật.`,
        };
      }
    }
    if (taskToUncheck === "transcription") {
      if (currentSet.has("translation")) blocking.push("translation");
      if (currentSet.has("dubbing")) blocking.push("dubbing");
      if (blocking.length > 0) {
        return {
          canUncheck: false,
          blockingTasks: blocking,
          reason: "Không thể tắt Phụ đề khi Dịch thuật hoặc Lồng tiếng đang bật.",
        };
      }
    }
    if (taskToUncheck === "translation") {
      if (currentSet.has("dubbing")) {
        return {
          canUncheck: false,
          blockingTasks: ["dubbing"],
          reason: "Không thể tắt Dịch thuật khi Lồng tiếng đang bật.",
        };
      }
    }
  } else if (fileKind === "subtitle") {
    if (taskToUncheck === "translation") {
      if (currentSet.has("dubbing")) {
        return {
          canUncheck: false,
          blockingTasks: ["dubbing"],
          reason: "Không thể tắt Dịch thuật khi Lồng tiếng đang bật.",
        };
      }
    }
  }

  return { canUncheck: true, blockingTasks: [] };
}

/**
 * Cascades deselect downstream tasks when a prerequisite is forcefully unchecked.
 */
export function cascadeDeselect(
  taskToUncheck: BatchTaskType,
  currentTasks: BatchTaskType[],
  fileKind: BatchFileKind
): BatchTaskType[] {
  let remaining = currentTasks.filter((t) => t !== taskToUncheck);

  if (fileKind === "media") {
    if (taskToUncheck === "transcription") {
      remaining = remaining.filter((t) => t !== "translation" && t !== "dubbing");
    } else if (taskToUncheck === "translation") {
      remaining = remaining.filter((t) => t !== "dubbing");
    }
  } else if (fileKind === "text") {
    if (taskToUncheck === "tts" || taskToUncheck === "dialogue") {
      remaining = remaining.filter(
        (t) => t !== "transcription" && t !== "translation" && t !== "dubbing"
      );
    } else if (taskToUncheck === "transcription") {
      remaining = remaining.filter((t) => t !== "translation" && t !== "dubbing");
    } else if (taskToUncheck === "translation") {
      remaining = remaining.filter((t) => t !== "dubbing");
    }
  } else if (fileKind === "subtitle") {
    if (taskToUncheck === "translation") {
      remaining = remaining.filter((t) => t !== "dubbing");
    }
  }

  return computeExecutionSequence(remaining, fileKind);
}

/**
 * Checks if translation step should be skipped due to identical source and target languages (AC-07, AC-08).
 */
export function shouldSkipTranslation(
  sourceLanguage?: string,
  targetLanguage?: string
): ConditionalTranslationResult {
  if (!sourceLanguage || !targetLanguage) {
    return { shouldSkip: false };
  }

  const normSource = sourceLanguage.trim().toLowerCase();
  const normTarget = targetLanguage.trim().toLowerCase();

  // If source is auto, we cannot skip prior to ASR detection
  if (normSource === "auto") {
    return { shouldSkip: false };
  }

  if (normSource === normTarget) {
    return {
      shouldSkip: true,
      skipReason: "Không cần dịch vì ngôn ngữ nguồn trùng ngôn ngữ đích.",
    };
  }

  return { shouldSkip: false };
}

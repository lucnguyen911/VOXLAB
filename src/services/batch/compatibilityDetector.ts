/**
 * VoxLab — Batch File Compatibility Detector
 * Specification: SPEC-batch.md v3.2.0 (AC-02, AC-03, AC-04, AC-06)
 */

import {
  BatchFileKind,
  BatchTaskType,
  BatchTaskCompatibility,
  BatchFileCompatibilityReport,
} from "../../types/batch";
import { validateDialogueScript } from "./dialogueValidator";

export const TEXT_EXTENSIONS = new Set([".txt", ".docx"]);
export const MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".mp3",
  ".wav",
  ".m4a",
  ".flac",
]);
export const SUBTITLE_EXTENSIONS = new Set([".srt", ".vtt"]);

/**
 * Detects the file kind (text, media, subtitle) from the filename or path.
 * Returns null if the extension is not supported.
 */
export function detectFileKind(filename: string): BatchFileKind | null {
  const ext = getFileExtension(filename).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (MEDIA_EXTENSIONS.has(ext)) return "media";
  if (SUBTITLE_EXTENSIONS.has(ext)) return "subtitle";
  return null;
}

/**
 * Extracts extension with leading dot from filename
 */
export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx !== -1 ? filename.slice(idx) : "";
}

/**
 * Checks compatibility of a specific task against a file kind and script detection.
 */
export function checkTaskCompatibility(
  fileKind: BatchFileKind,
  task: BatchTaskType,
  isDialogueScript: boolean = false
): BatchTaskCompatibility {
  switch (fileKind) {
    case "media":
      if (task === "tts") {
        return {
          isCompatible: false,
          reason: "Tệp video/âm thanh không hỗ trợ tác vụ Chuyển văn bản thành giọng nói (TTS).",
        };
      }
      if (task === "dialogue") {
        return {
          isCompatible: false,
          reason: "Tệp video/âm thanh không hỗ trợ tác vụ Kịch bản phân vai (Hội thoại).",
        };
      }
      if (task === "transcription") {
        return {
          isCompatible: true,
          reason: "Tạo phụ đề từ âm thanh qua mô hình ASR (Whisper).",
        };
      }
      if (task === "translation") {
        return {
          isCompatible: true,
          reason: "Dịch phụ đề sau khi nhận diện ASR.",
        };
      }
      if (task === "dubbing") {
        return {
          isCompatible: true,
          reason: "Lồng tiếng âm thanh AI cho tệp đa phương tiện.",
        };
      }
      break;

    case "subtitle":
      if (task === "tts") {
        return {
          isCompatible: false,
          reason: "Tệp phụ đề không hỗ trợ tác vụ TTS đơn (sử dụng Lồng tiếng để đọc phụ đề).",
        };
      }
      if (task === "dialogue") {
        return {
          isCompatible: false,
          reason: "Tệp phụ đề không hỗ trợ kịch bản phân vai.",
        };
      }
      if (task === "transcription") {
        return {
          isCompatible: false,
          reason: "Tệp đã là phụ đề hoàn chỉnh, không cần bóc băng ASR.",
        };
      }
      if (task === "translation") {
        return {
          isCompatible: true,
          reason: "Dịch trực tiếp các cue phụ đề sang ngôn ngữ đích.",
        };
      }
      if (task === "dubbing") {
        return {
          isCompatible: true,
          reason: "Lồng tiếng theo từng cue mốc thời gian của phụ đề.",
        };
      }
      break;

    case "text":
      if (task === "transcription") {
        return {
          isCompatible: true,
          reason: "Tạo phụ đề đồng bộ từ thời lượng âm thanh thực tế của TTS hoặc Hội thoại (không chạy ASR/Whisper).",
        };
      }
      if (isDialogueScript) {
        if (task === "tts") {
          return {
            isCompatible: false,
            reason: "Kịch bản phân vai chỉ hỗ trợ chế độ Hội thoại, không dùng TTS đơn.",
          };
        }
        if (task === "dialogue") {
          return {
            isCompatible: true,
            reason: "Kịch bản phân vai hợp lệ, hỗ trợ gán giọng riêng từng nhân vật.",
          };
        }
      } else {
        if (task === "dialogue") {
          return {
            isCompatible: false,
            reason: "Tệp văn bản thường chưa có định dạng phân vai [Tên nhân vật]: thoại.",
          };
        }
        if (task === "tts") {
          return {
            isCompatible: true,
            reason: "Chuyển văn bản thành giọng đọc tự nhiên.",
          };
        }
      }
      if (task === "translation") {
        return {
          isCompatible: true,
          reason: "Dịch nội dung kịch bản qua dòng phụ đề.",
        };
      }
      if (task === "dubbing") {
        return {
          isCompatible: true,
          reason: "Lồng tiếng từ phụ đề kịch bản.",
        };
      }
      break;
  }

  return { isCompatible: false, reason: "Tác vụ không tương thích với định dạng tệp." };
}

/**
 * Generates a comprehensive compatibility report for a file.
 */
export function getFileCompatibilityReport(
  filename: string,
  contentOrIsDialogue?: string | boolean
): BatchFileCompatibilityReport {
  const fileKind = detectFileKind(filename);
  if (!fileKind) {
    return {
      fileKind: "text",
      isCompatible: false,
      reason: `Định dạng tệp "${getFileExtension(filename)}" không được hỗ trợ.`,
      isDialogueScript: false,
      dialogueCharacterCount: 0,
      tasks: {
        tts: { isCompatible: false, reason: "Định dạng không được hỗ trợ." },
        dialogue: { isCompatible: false, reason: "Định dạng không được hỗ trợ." },
        transcription: { isCompatible: false, reason: "Định dạng không được hỗ trợ." },
        translation: { isCompatible: false, reason: "Định dạng không được hỗ trợ." },
        dubbing: { isCompatible: false, reason: "Định dạng không được hỗ trợ." },
      },
    };
  }

  let isDialogueScript = false;
  let characterCount = 0;

  if (fileKind === "text") {
    if (typeof contentOrIsDialogue === "boolean") {
      isDialogueScript = contentOrIsDialogue;
    } else if (typeof contentOrIsDialogue === "string") {
      const val = validateDialogueScript(contentOrIsDialogue);
      isDialogueScript = val.isDialogueScript;
      characterCount = val.characterCount;
    }
  }

  const tasks: Record<BatchTaskType, BatchTaskCompatibility> = {
    tts: checkTaskCompatibility(fileKind, "tts", isDialogueScript),
    dialogue: checkTaskCompatibility(fileKind, "dialogue", isDialogueScript),
    transcription: checkTaskCompatibility(fileKind, "transcription", isDialogueScript),
    translation: checkTaskCompatibility(fileKind, "translation", isDialogueScript),
    dubbing: checkTaskCompatibility(fileKind, "dubbing", isDialogueScript),
  };

  return {
    fileKind,
    isCompatible: true,
    isDialogueScript,
    dialogueCharacterCount: characterCount,
    tasks,
  };
}

/**
 * Validates a user selection of tasks for a file, checking mutual exclusion and compatibility.
 */
export function validateTaskSelection(
  tasks: BatchTaskType[],
  fileKind: BatchFileKind,
  isDialogueScript: boolean = false
): { isValid: boolean; error?: string } {
  if (!tasks || tasks.length === 0) {
    return { isValid: false, error: "Vui lòng chọn ít nhất một tác vụ." };
  }

  // Mutual exclusion rule (AC-06): Text file cannot select BOTH tts and dialogue
  if (tasks.includes("tts") && tasks.includes("dialogue")) {
    return {
      isValid: false,
      error: "Không thể chọn đồng thời TTS và Hội thoại trên cùng một tệp văn bản.",
    };
  }

  // Check each selected task's compatibility
  for (const task of tasks) {
    const compat = checkTaskCompatibility(fileKind, task, isDialogueScript);
    if (!compat.isCompatible) {
      return {
        isValid: false,
        error: `Tác vụ "${task}" không tương thích: ${compat.reason}`,
      };
    }
  }

  return { isValid: true };
}

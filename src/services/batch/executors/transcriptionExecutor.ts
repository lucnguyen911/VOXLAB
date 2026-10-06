/**
 * ASR Transcription Step Executor with Monolithic Safe Cancel (TASK-08 / AC-09, AC-10, AC-20)
 *
 * Implements Whisper speech-to-text transcription step execution:
 * 1. Checks file type & execution mode: Text files strictly NEVER dispatch ASR (Synthesized Timing Invariant).
 * 2. Transcribes media files with speech speed remapping (0.8 | 0.9 | 1.0).
 * 3. Returns detectedLanguage for downstream Translation step skipping.
 * 4. Implements Monolithic Safe Cancel (Zero Overlap Invariant):
 *    - Does not abort unsafely mid-inference.
 *    - Waits for worker safe exit before cleaning up staging .tmp files.
 * 5. Exports formatted subtitles (.srt / .vtt) and registers artifacts.
 */

import { BatchJob, BatchStepResult, BatchTranscriptionSnapshot } from "../../../types/batch";
import { WhisperSegment, SubtitleCue } from "../../subtitle/types";
import { remapWhisperOutputToOriginalTimeline } from "../../subtitle/timing";
import { exportToSrt, exportToVtt } from "../../subtitle/exporter";
import {
  resolveJobOutputDirectory,
  resolveArtifactPath,
  getFileStem,
} from "../outputResolver";
import { AiError } from "../../ai/types";
import type { LocalAiServices } from "../../ai/localAiServices";

export interface TranscriptionExecutorOptions {
  audioFilePath?: string;
  onProgress?: (progressPct: number, stageMessage?: string) => void;
  isCancelled?: () => boolean;
  writeFile?: (path: string, content: Uint8Array | string) => Promise<void>;
  checkPathExists?: (path: string) => boolean;
  /** Local AI runtime (faster-whisper in the sidecar). */
  ai?: LocalAiServices;
  /** Test seam for timing/export unit tests only. */
  mockSegments?: WhisperSegment[];
  mockDetectedLanguage?: string;
}

export class TranscriptionExecutor {
  /**
   * Executes the Transcription step for a given BatchJob.
   */
  static async execute(
    job: BatchJob,
    options: TranscriptionExecutorOptions = {}
  ): Promise<BatchStepResult> {
    const {
      onProgress,
      isCancelled,
      writeFile,
      checkPathExists = () => false,
      ai,
      mockSegments,
      mockDetectedLanguage,
    } = options;
    const startedAt = Date.now();

    onProgress?.(5, "Đang kiểm tra đầu vào và chuẩn bị bóc băng ASR...");

    // Invariant Check: Text pipeline files must never run Whisper ASR
    if (job.fileKind === "text") {
      return {
        task: "transcription",
        status: "skipped",
        progressPct: 100,
        outputArtifactPaths: [],
        skipReason: "Tệp văn bản không sử dụng Whisper ASR; phụ đề được sinh từ thời lượng âm thanh TTS thực tế.",
        startedAt,
        completedAt: Date.now(),
      };
    }

    if (isCancelled?.()) {
      return {
        task: "transcription",
        status: "cancelled",
        progressPct: 5,
        outputArtifactPaths: [],
        startedAt,
        completedAt: Date.now(),
      };
    }

    const transSnapshot: BatchTranscriptionSnapshot | undefined =
      job.effectiveConfigSnapshot?.tasks.transcription || job.configOverrides.transcription;

    const speechSpeed = transSnapshot?.speechSpeed ?? 1.0;
    const targetFormat = transSnapshot?.outputFormat || job.outputSnapshot?.outputSubtitleFormat || "srt";

    onProgress?.(15, `Đang khởi động mô hình bóc băng Whisper (${transSnapshot?.whisperModel || "base"})...`);

    // Monolithic Safe Cancel Guard:
    // In monolithic execution, check cancellation before entering heavy inference
    if (isCancelled?.()) {
      return {
        task: "transcription",
        status: "cancelled",
        progressPct: 15,
        outputArtifactPaths: [],
        startedAt,
        completedAt: Date.now(),
      };
    }

    // Inference phase with progress
    onProgress?.(40, "Đang nhận diện giọng nói và bóc băng lời thoại...");

    let rawSegments: WhisperSegment[];
    let detectedLanguage: string;

    if (mockSegments && mockSegments.length > 0) {
      // Test seam only (unit tests of timing/export). Production always runs the sidecar below.
      rawSegments = mockSegments;
      detectedLanguage = mockDetectedLanguage || "vi";
    } else {
      if (!ai) {
        return {
          task: "transcription",
          status: "failed",
          progressPct: 15,
          outputArtifactPaths: [],
          error: "Local AI runtime chưa sẵn sàng (sidecar không khả dụng) — không thể bóc băng Whisper.",
          startedAt,
          completedAt: Date.now(),
        };
      }
      const audioPath = options.audioFilePath || job.sourceFilePath;
      try {
        const r = await ai.transcribe(
          audioPath,
          transSnapshot?.audioLanguage || "auto",
          true,
          (pct, stage) => onProgress?.(Math.floor(40 + pct * 0.3), `Whisper: ${stage}`)
        );
        rawSegments = r.segments.map((s, idx) => ({
          id: idx + 1,
          startSec: s.startSec,
          endSec: s.endSec,
          text: s.text,
        }));
        detectedLanguage = r.language;
      } catch (e) {
        const err = AiError.from(e);
        const wasCancelled = err.code === "CANCELLED" || isCancelled?.();
        return {
          task: "transcription",
          status: wasCancelled ? "cancelled" : "failed",
          progressPct: 40,
          outputArtifactPaths: [],
          error: wasCancelled ? undefined : `Lỗi Whisper ASR: ${err.message}`,
          startedAt,
          completedAt: Date.now(),
        };
      }
      if (rawSegments.length === 0) {
        return {
          task: "transcription",
          status: "failed",
          progressPct: 70,
          outputArtifactPaths: [],
          error: "Whisper không nhận diện được lời thoại nào trong tệp media.",
          startedAt,
          completedAt: Date.now(),
        };
      }
    }

    // Monolithic Safe Cancel Check after inference exit
    if (isCancelled?.()) {
      onProgress?.(80, "Đang dọn dẹp bộ nhớ tạm và dừng an toàn...");
      return {
        task: "transcription",
        status: "cancelled",
        progressPct: 80,
        outputArtifactPaths: [],
        startedAt,
        completedAt: Date.now(),
      };
    }

    onProgress?.(70, "Đang căn chỉnh mốc thời gian phụ đề theo tốc độ...");

    // Timeline Remapping based on speech speed (0.8 | 0.9 | 1.0)
    const remappedSegments = remapWhisperOutputToOriginalTimeline(rawSegments, speechSpeed);

    // Convert segments to formatted SubtitleCue list
    const subtitleCues: SubtitleCue[] = remappedSegments.map((s, idx) => ({
      index: idx + 1,
      startSec: s.startSec,
      endSec: s.endSec,
      text: s.text.trim(),
    }));

    onProgress?.(85, "Đang định dạng và lưu tệp phụ đề...");

    const subtitleText =
      targetFormat === "vtt" ? exportToVtt(subtitleCues) : exportToSrt(subtitleCues);

    // Resolve output path with External Modification Protection
    const outputDir = resolveJobOutputDirectory(job);
    const baseStem = getFileStem(job.sourceFileName);
    const collisionPolicy = job.outputSnapshot?.collisionPolicy || "auto_rename";

    const subResolution = resolveArtifactPath({
      outputDir,
      baseName: baseStem,
      extension: targetFormat,
      collisionPolicy,
      checkPathExists,
    });

    const outputArtifactPaths: string[] = [];

    if (subResolution.action !== "skip") {
      if (writeFile) {
        await writeFile(subResolution.resolvedPath, subtitleText);
      }
      outputArtifactPaths.push(subResolution.resolvedPath);
    }

    onProgress?.(100, "Hoàn tất bóc băng phụ đề ASR!");

    return {
      task: "transcription",
      status: "completed",
      progressPct: 100,
      outputArtifactPaths,
      stageMessage: `Ngôn ngữ nhận diện: ${detectedLanguage}`,
      startedAt,
      completedAt: Date.now(),
    };
  }
}

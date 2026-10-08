/**
 * Translation Step Executor with 1:1 Cue Invariant (TASK-09 / AC-05, AC-07, AC-08, AC-26)
 *
 * Implements Subtitle Translation step execution:
 * 1. Loads subtitle cues from upstream artifact (.srt/.vtt) or source input.
 * 2. Checks dynamic language skipping: if detectedSourceLanguage === targetLanguage -> skipped with reason.
 * 3. Calls TranslationManager and enforces strict 1:1 Cue Invariant (cues count & timestamps unchanged).
 * 4. Exports translated subtitles (.srt / .vtt) and registers artifacts.
 */

import { BatchJob, BatchStepResult, BatchTranslationSnapshot } from "../../../types/batch";
import { OriginalCue, TranslatedCue } from "../../../types/dubbing";
import { TranslationManager } from "../../translation/manager";
import { parseSubtitle } from "../../subtitle/parser";
import { exportToSrt, exportToVtt } from "../../subtitle/exporter";
import {
  resolveJobOutputDirectory,
  resolveArtifactPath,
  getFileStem,
} from "../outputResolver";

export interface TranslationExecutorOptions {
  subtitleContent?: string;
  sourceLanguage?: string;
  onProgress?: (progressPct: number, stageMessage?: string) => void;
  isCancelled?: () => boolean;
  writeFile?: (path: string, content: Uint8Array | string) => Promise<void>;
  checkPathExists?: (path: string) => boolean;
}

export class TranslationExecutor {
  /**
   * Executes the Translation step for a given BatchJob.
   */
  static async execute(
    job: BatchJob,
    options: TranslationExecutorOptions = {}
  ): Promise<BatchStepResult> {
    const { onProgress, isCancelled, writeFile, checkPathExists = () => false } = options;
    const startedAt = Date.now();

    onProgress?.(5, "Đang nạp phụ đề gốc chuẩn bị dịch thuật...");

    if (isCancelled?.()) {
      return {
        task: "translation",
        status: "cancelled",
        progressPct: 5,
        outputArtifactPaths: [],
        startedAt,
        completedAt: Date.now(),
      };
    }

    // 1. Resolve source subtitle cues
    let rawSubtitle = options.subtitleContent || "";
    if (!rawSubtitle.trim()) {
      return {
        task: "translation",
        status: "failed",
        progressPct: 0,
        outputArtifactPaths: [],
        error: "Không tìm thấy phụ đề đầu vào để thực hiện dịch thuật.",
        startedAt,
        completedAt: Date.now(),
      };
    }

    let originalCues: OriginalCue[];
    try {
      originalCues = parseSubtitle(rawSubtitle);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        task: "translation",
        status: "failed",
        progressPct: 10,
        outputArtifactPaths: [],
        error: `Lỗi bóc tách phụ đề đầu vào: ${msg}`,
        startedAt,
        completedAt: Date.now(),
      };
    }

    if (originalCues.length === 0) {
      return {
        task: "translation",
        status: "failed",
        progressPct: 10,
        outputArtifactPaths: [],
        error: "Tệp phụ đề không có câu nào hợp lệ.",
        startedAt,
        completedAt: Date.now(),
      };
    }

    // 2. Check Dynamic Source Language Skipping (AC-07 / AC-08)
    const transSnapshot: BatchTranslationSnapshot | undefined =
      job.effectiveConfigSnapshot?.tasks.translation || job.configOverrides.translation;

    const targetLang = transSnapshot?.targetLanguage || "vi";

    // Extract detected source language from transcription step if available
    let detectedSource = options.sourceLanguage || transSnapshot?.sourceLanguage || "auto";
    const asrStageMessage = job.stepResults.transcription?.stageMessage;
    if (asrStageMessage && asrStageMessage.includes(":")) {
      const parts = asrStageMessage.split(":");
      if (parts[1]) {
        detectedSource = parts[1].trim();
      }
    }

    if (
      detectedSource &&
      detectedSource !== "auto" &&
      detectedSource.toLowerCase() === targetLang.toLowerCase()
    ) {
      onProgress?.(100, "Ngôn ngữ nguồn trùng ngôn ngữ đích - tự động bỏ qua bước dịch.");
      return {
        task: "translation",
        status: "skipped",
        progressPct: 100,
        outputArtifactPaths: [],
        skipReason: `Không cần dịch vì ngôn ngữ nguồn ("${detectedSource}") trùng với ngôn ngữ đích ("${targetLang}").`,
        startedAt,
        completedAt: Date.now(),
      };
    }

    onProgress?.(20, `Đang dịch ${originalCues.length} câu sang tiếng [${targetLang}]...`);

    // 3. Execute 1:1 Translation via TranslationManager
    const manager = TranslationManager.getInstance();
    let translatedCues: TranslatedCue[];

    try {
      translatedCues = await manager.translateOriginalCues(
        originalCues,
        targetLang,
        transSnapshot?.providerId || "google",
        (done, total) => {
          const pct = Math.floor(20 + (done / total) * 65);
          onProgress?.(pct, `Đang dịch phụ đề: ${done}/${total} câu...`);
        },
        transSnapshot?.style || "default",
        {
          sourceLang: detectedSource,
          isCancelled,
          strict: true,
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        task: "translation",
        status: "failed",
        progressPct: 50,
        outputArtifactPaths: [],
        error: `Lỗi dịch thuật AI: ${msg}`,
        startedAt,
        completedAt: Date.now(),
      };
    }

    if (isCancelled?.() || translatedCues.length < originalCues.length) {
      return {
        task: "translation",
        status: "cancelled",
        progressPct: 80,
        outputArtifactPaths: [],
        startedAt,
        completedAt: Date.now(),
      };
    }

    onProgress?.(90, "Đang xuất file phụ đề đã dịch...");

    // 4. Export translated subtitle
    const targetFormat =
      transSnapshot?.outputFormat === "vtt" ||
      job.outputSnapshot?.outputSubtitleFormat === "vtt"
        ? "vtt"
        : "srt";

    const subtitleCues = translatedCues.map((c) => ({
      index: c.index,
      startSec: c.startSec,
      endSec: c.endSec,
      text: c.text,
    }));

    const translatedText =
      targetFormat === "vtt"
        ? exportToVtt(subtitleCues)
        : exportToSrt(subtitleCues);

    // Resolve output path with disambiguated language suffix
    const outputDir = resolveJobOutputDirectory(job);
    const baseStem = `${getFileStem(job.sourceFileName)}_${targetLang}`;
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
        await writeFile(subResolution.resolvedPath, translatedText);
      }
      outputArtifactPaths.push(subResolution.resolvedPath);
    }

    onProgress?.(100, "Hoàn tất dịch thuật phụ đề!");

    return {
      task: "translation",
      status: "completed",
      progressPct: 100,
      outputArtifactPaths,
      stageMessage: `Đã dịch ${translatedCues.length} câu sang [${targetLang}]`,
      startedAt,
      completedAt: Date.now(),
    };
  }
}

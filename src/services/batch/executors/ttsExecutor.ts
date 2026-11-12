/**
 * TTS Step Executor (TASK-07 / AC-03, AC-04, AC-19)
 *
 * Implements single-voice Text-to-Speech step execution:
 * 1. Loads text script.
 * 2. Normalizes text via normalizer engine.
 * 3. Chunks script into smart segments with pause tokens.
 * 4. Synthesizes chunk audio with chunk-level cancellation support.
 * 5. Assembles master audio (WAV / MP3).
 * 6. Generates synchronized subtitles directly from TTS audio duration (Text Subtitle Timing invariant).
 * 7. Resolves output paths with External Modification Protection and registers artifacts.
 */

import { BatchJob, BatchStepResult, BatchTtsSnapshot, BatchQcChunkItem } from "../../../types/batch";
import { ChunkItem } from "../../../types/ui";
import { normalizeText, getDefaultEnabledGroupIds } from "../../normalizer/engine";
import { splitScriptWithPauses, TTS_SMART_CHUNK_OPTIONS } from "../../pause/chunker";
import { computeChunkPausesMs } from "../../audio/masterExport";
import { generateSubtitlesFromChunks } from "../../subtitle/pipeline";
import { exportToSrt, exportToVtt } from "../../subtitle/exporter";
import {
  resolveJobOutputDirectory,
  resolveArtifactPath,
  getFileStem,
} from "../outputResolver";
import { AiError } from "../../ai/types";
import type { LocalAiServices } from "../../ai/localAiServices";
import { concatPcmWavsFast } from "../batchRuntime";
import { getEngineAdvancedSettings } from "../../ai/ttsAdvancedSettings";
import { edgeTtsProvider } from "../../providers/edgeProvider";
import { googleTranslateTtsProvider } from "../../providers/googleProvider";
import { resolveBatchVoiceTarget } from "../batchModelResolver";
import { getEffectiveRules } from "../../pronunciation";
import {
  validateChunkAudioQuality,
  countChunkQualityIssues,
} from "../../audio/qualityValidator";

export interface TtsExecutorOptions {
  textContent?: string;
  onProgress?: (progressPct: number, stageMessage?: string) => void;
  isCancelled?: () => boolean;
  waitIfPaused?: () => Promise<void>;
  writeFile?: (path: string, content: Uint8Array | string) => Promise<void>;
  checkPathExists?: (path: string) => boolean;
  /** Local AI runtime (sidecar). Required: there is no simulated synthesis. */
  ai?: LocalAiServices;
}

export class TtsExecutor {
  /**
   * Executes the TTS step for a given BatchJob.
   */
  static async execute(
    job: BatchJob,
    options: TtsExecutorOptions = {}
  ): Promise<BatchStepResult> {
    const { onProgress, isCancelled, waitIfPaused, writeFile, checkPathExists = () => false, ai } = options;
    const startedAt = Date.now();

    onProgress?.(5, "Đang nạp và chuẩn hóa văn bản...");

    // 1. Load text content
    const rawText = options.textContent || job.sourceFileName || "";
    if (!rawText.trim()) {
      return {
        task: "tts",
        status: "failed",
        progressPct: 0,
        outputArtifactPaths: [],
        error: "Nội dung văn bản trống, không thể thực hiện TTS.",
        startedAt,
        completedAt: Date.now(),
      };
    }

    if (isCancelled?.()) {
      return {
        task: "tts",
        status: "cancelled",
        progressPct: 5,
        outputArtifactPaths: [],
        startedAt,
        completedAt: Date.now(),
      };
    }

    // 2. Normalization (safe text cleanup; preserve explicit \n\n paragraph boundaries for Smart Chunking)
    const enabledGroupIds = getDefaultEnabledGroupIds();
    const normalizedText = rawText
      .split(/\r?\n\s*\r?\n/)
      .map((para) => normalizeText(para, enabledGroupIds).normalizedText.trim())
      .filter((para) => para.length > 0)
      .join("\n\n");
    const effectiveRules = getEffectiveRules();

    // 3. Smart Chunking with pauses
    const chunks: ChunkItem[] = splitScriptWithPauses(normalizedText, TTS_SMART_CHUNK_OPTIONS);
    if (chunks.length === 0) {
      return {
        task: "tts",
        status: "failed",
        progressPct: 10,
        outputArtifactPaths: [],
        error: "Không thể phân đoạn văn bản thành các câu đọc hợp lệ.",
        startedAt,
        completedAt: Date.now(),
      };
    }

    // 4. Synthesize Chunks with the configured local engine (TtsEngineAdapter via sidecar)
    const ttsSnapshot: BatchTtsSnapshot | undefined =
      job.effectiveConfigSnapshot?.tasks.tts || job.configOverrides.tts;
    const fail = (progressPct: number, error: string): BatchStepResult => ({
      task: "tts",
      status: "failed",
      progressPct,
      outputArtifactPaths: [],
      error,
      startedAt,
      completedAt: Date.now(),
    });
    const cancelled = (progressPct: number): BatchStepResult => ({
      task: "tts",
      status: "cancelled",
      progressPct,
      outputArtifactPaths: [],
      startedAt,
      completedAt: Date.now(),
    });

    if (!ai) {
      return fail(10, "Local AI runtime chưa sẵn sàng (sidecar không khả dụng) — không thể tạo giọng đọc thật.");
    }
    const {
      voiceId,
      model,
      isGoogleVoice,
      isEdgeVoice,
      isOnlineVoice,
      audioExt,
    } = resolveBatchVoiceTarget(ttsSnapshot?.voiceId, ttsSnapshot?.model);
    const speed = ttsSnapshot?.speed && ttsSnapshot.speed !== 1 ? ttsSnapshot.speed : undefined;
    if (!isOnlineVoice) {
      try {
        ai.resolveEngine(model, voiceId, normalizedText, undefined, speed);
      } catch (e) {
        return fail(10, AiError.from(e).message);
      }
    }

    // Freeze advanced settings snapshot for the entire batch task (Invariant D)
    const jobAdvancedSettings = !isOnlineVoice ? getEngineAdvancedSettings(model) : undefined;

    const scratchScope = `tts-${job.id}`.replace(/[^\w-]/g, "_");
    const sortedChunks = [...chunks].sort((a, b) => a.index - b.index);
    const totalChunks = sortedChunks.length;
    for (let i = 0; i < totalChunks; i++) {
      if (isCancelled?.()) return cancelled(Math.floor(10 + (i / totalChunks) * 60));
      const chunk = sortedChunks[i];
      try {
        const outputPath = await ai.scratchPath(
          scratchScope,
          `chunk_${String(i + 1).padStart(4, "0")}.${audioExt}`
        );
        let r: {
          durationSec: number;
          outputPath: string;
          leadingSilenceMs?: number;
          trailingSilenceMs?: number;
          majorPunctuationSplit?: boolean;
        };
        if (isGoogleVoice) {
          r = await googleTranslateTtsProvider.synthesize({
            voiceId,
            text: chunk.text,
            outputPath,
            speed,
          });
        } else if (isEdgeVoice) {
          r = await edgeTtsProvider.synthesize({
            voiceId,
            text: chunk.text,
            outputPath,
            speed,
          });
        } else {
          r = await ai.synthesize({
            model,
            voiceId,
            text: chunk.text,
            outputPath,
            speed,
            advancedSettings: jobAdvancedSettings,
            pronunciationRules: effectiveRules,
            punctuationPauses: ttsSnapshot?.pauses,
          });
        }
        chunk.durationSec = r.durationSec; // real audio duration → synthesized_timing subtitles
        chunk.audioUrl = r.outputPath;
        chunk.audioFilePath = r.outputPath;
        if (typeof r.leadingSilenceMs === "number") chunk.leadingSilenceMs = r.leadingSilenceMs;
        if (typeof r.trailingSilenceMs === "number") chunk.trailingSilenceMs = r.trailingSilenceMs;
        (chunk as ChunkItem & { _majorPunctuationSplit?: boolean })._majorPunctuationSplit = Boolean(
          r.majorPunctuationSplit
        );
        chunk.status = "ready";
      } catch (e) {
        const err = AiError.from(e);
        if (err.code === "CANCELLED" || isCancelled?.()) return cancelled(Math.floor(10 + (i / totalChunks) * 55));
        return fail(Math.floor(10 + (i / totalChunks) * 55), `Lỗi tạo giọng đoạn ${i + 1}/${totalChunks}: ${err.message}`);
      }
      const pct = Math.floor(10 + ((i + 1) / totalChunks) * 55);
      onProgress?.(pct, `Đang tạo giọng đọc: đoạn ${i + 1}/${totalChunks}...`);
      if (i + 1 < totalChunks) {
        await waitIfPaused?.();
        if (isCancelled?.()) return cancelled(pct);
      }
    }

    // 4b. Dedicated post-TTS Whisper quality validation pass (avoids TTS <-> ASR GPU model thrashing)
    let retriesUsed = 0;
    if (typeof ai.validateAudioQuality === "function" && sortedChunks.length > 0) {
      if (sortedChunks.length > 1) {
        await waitIfPaused?.();
        if (isCancelled?.()) return cancelled(65);
      }
      onProgress?.(68, "Đang hậu kiểm chất lượng giọng đọc bằng Whisper...");
      const maybeShapeChunkPauses = async (chunk: ChunkItem) => {
        if (
          !ttsSnapshot?.pauses ||
          !chunk.audioFilePath ||
          typeof ai.enforcePunctuationPauses !== "function"
        ) {
          return;
        }
        const majorSplit = Boolean(
          (chunk as ChunkItem & { _majorPunctuationSplit?: boolean })._majorPunctuationSplit
        );
        const inner = chunk.text.trim().slice(0, -1);
        const needsShape = majorSplit
          ? /[,，、:;：；]/.test(inner)
          : /[,.;:!?…，、。；：！？]/.test(inner);
        if (!needsShape) return;
        try {
          const shaped = await ai.enforcePunctuationPauses({
            audioPath: chunk.audioFilePath,
            text: chunk.text,
            punctuationPauses: ttsSnapshot.pauses,
            speed,
            majorAlreadySplit: majorSplit,
          });
          if (shaped && typeof shaped.durationSec === "number" && shaped.durationSec > 0) {
            chunk.durationSec = shaped.durationSec;
            if (typeof shaped.leadingSilenceMs === "number") {
              chunk.leadingSilenceMs = shaped.leadingSilenceMs;
            }
            if (typeof shaped.trailingSilenceMs === "number") {
              chunk.trailingSilenceMs = shaped.trailingSilenceMs;
            }
          }
        } catch {
          // Non-blocking: pause shaping failure must not abort batch synthesis
        }
      };

      for (let i = 0; i < sortedChunks.length; i++) {
        if (isCancelled?.()) return cancelled(68);
        const chunk = sortedChunks[i];
        await maybeShapeChunkPauses(chunk);
        try {
          chunk.qualityReview = await validateChunkAudioQuality(
            chunk,
            undefined,
            ai,
            speed,
            undefined,
            "current"
          );
        } catch {
          // Non-blocking: quality check failure must not abort batch synthesis
        }
        if (i + 1 < sortedChunks.length) {
          await waitIfPaused?.();
          if (isCancelled?.()) return cancelled(68);
        }
      }

      // 4c. Auto-retry flagged chunks up to maxAutoRetries (default 5) when enabled
      const autoRetryEnabled = Boolean(
        job.effectiveConfigSnapshot?.output?.autoRetryFailedChunks ??
          job.outputSnapshot?.autoRetryFailedChunks
      );
      const maxAutoRetries =
        job.effectiveConfigSnapshot?.output?.maxAutoRetries ??
        job.outputSnapshot?.maxAutoRetries ??
        5;

      if (autoRetryEnabled && maxAutoRetries > 0) {
        for (let attempt = 1; attempt <= maxAutoRetries; attempt++) {
          const flaggedChunks = sortedChunks.filter(
            (c) =>
              c.qualityReview?.status === "error" ||
              c.qualityReview?.status === "warning"
          );
          if (flaggedChunks.length === 0) {
            break;
          }
          retriesUsed = attempt;
          if (isCancelled?.()) return cancelled(70);
          onProgress?.(
            70,
            `Đang tự động tạo lại ${flaggedChunks.length} đoạn lỗi/cảnh báo (Lần ${attempt}/${maxAutoRetries})...`
          );

          // Sub-pass A: Batch synthesize all flagged chunks in this round
          for (const chunk of flaggedChunks) {
            if (isCancelled?.()) return cancelled(70);
            try {
              const retryOutputPath = await ai.scratchPath(
                scratchScope,
                `chunk_${String(chunk.index).padStart(4, "0")}_retry${attempt}.${audioExt}`
              );
              let r: {
                durationSec: number;
                outputPath: string;
                leadingSilenceMs?: number;
                trailingSilenceMs?: number;
                majorPunctuationSplit?: boolean;
              };
              if (isGoogleVoice) {
                r = await googleTranslateTtsProvider.synthesize({
                  voiceId,
                  text: chunk.text,
                  outputPath: retryOutputPath,
                  speed,
                });
              } else if (isEdgeVoice) {
                r = await edgeTtsProvider.synthesize({
                  voiceId,
                  text: chunk.text,
                  outputPath: retryOutputPath,
                  speed,
                });
              } else {
                r = await ai.synthesize({
                  model,
                  voiceId,
                  text: chunk.text,
                  outputPath: retryOutputPath,
                  speed,
                  advancedSettings: jobAdvancedSettings,
                  pronunciationRules: effectiveRules,
                  punctuationPauses: ttsSnapshot?.pauses,
                });
              }
              chunk.durationSec = r.durationSec;
              chunk.audioUrl = r.outputPath;
              chunk.audioFilePath = r.outputPath;
              if (typeof r.leadingSilenceMs === "number") chunk.leadingSilenceMs = r.leadingSilenceMs;
              if (typeof r.trailingSilenceMs === "number") chunk.trailingSilenceMs = r.trailingSilenceMs;
              (chunk as ChunkItem & { _majorPunctuationSplit?: boolean })._majorPunctuationSplit = Boolean(
                r.majorPunctuationSplit
              );
              chunk.status = "ready";
            } catch (e) {
              const err = AiError.from(e);
              if (err.code === "CANCELLED" || isCancelled?.()) return cancelled(70);
              // Non-blocking on retry: preserve previous chunk audio if retry synthesis fails
            }
          }

          // Sub-pass B: Batch validate all flagged chunks in this round via Whisper
          onProgress?.(
            72,
            `Đang hậu kiểm lại ${flaggedChunks.length} đoạn (Lần ${attempt}/${maxAutoRetries})...`
          );
          for (const chunk of flaggedChunks) {
            if (isCancelled?.()) return cancelled(72);
            await maybeShapeChunkPauses(chunk);
            try {
              chunk.qualityReview = await validateChunkAudioQuality(
                chunk,
                undefined,
                ai,
                speed,
                undefined,
                "current"
              );
            } catch {
              // Non-blocking
            }
          }
        }
      }
    }

    // 5. Resolve Output Paths
    const targetAudioFormat = job.outputSnapshot?.outputAudioFormat || "wav";
    const outputDir = resolveJobOutputDirectory(job);
    const baseStem = getFileStem(job.sourceFileName);
    const collisionPolicy = job.outputSnapshot?.collisionPolicy || "auto_rename";

    const audioResolution = resolveArtifactPath({
      outputDir,
      baseName: baseStem,
      extension: targetAudioFormat,
      collisionPolicy,
      checkPathExists,
    });

    const outputArtifactPaths: string[] = [];

    // 6. Assemble master from the real chunk audio (fast native Rust WAV concat or sidecar MP3 LAME encode)
    let fastWavSegments: Array<{ durationSec: number }> | undefined;
    if (audioResolution.action !== "skip") {
      onProgress?.(75, "Đang ghép nối tệp âm thanh Master...");
      const pauses = computeChunkPausesMs(sortedChunks, ttsSnapshot?.pauses);
      const concatInputs = sortedChunks.map((c, i) => ({
        path: c.audioUrl as string,
        gapAfterMs: pauses[i],
      }));
      try {
        const fastWav =
          targetAudioFormat === "wav"
            ? await concatPcmWavsFast(concatInputs, audioResolution.resolvedPath)
            : null;
        if (fastWav) {
          fastWavSegments = fastWav.segments;
        } else {
          await ai.assemble({
            inputs: concatInputs,
            outputPath: audioResolution.resolvedPath,
            format: targetAudioFormat,
            punctuationPauses: ttsSnapshot?.pauses,
          });
        }
      } catch (e) {
        const err = AiError.from(e);
        if (err.code === "CANCELLED") return cancelled(75);
        return fail(75, `Lỗi ghép Master audio: ${err.message}`);
      }
      outputArtifactPaths.push(audioResolution.resolvedPath);
    }

    // 7. Instant synchronized subtitle generation directly from synthesized chunk durations
    const needsSubtitle =
      job.selectedTasks.includes("transcription") ||
      Boolean(ttsSnapshot?.exportSrt) ||
      (job.effectiveConfigSnapshot?.tasks.tts?.sentencePauseMs !== undefined);

    if (needsSubtitle) {
      onProgress?.(88, "Đang xuất phụ đề đồng bộ...");
      const transSnapshot =
        job.effectiveConfigSnapshot?.tasks.transcription || job.configOverrides.transcription;
      const subFormat = job.outputSnapshot?.outputSubtitleFormat || "srt";
      const timedChunks = fastWavSegments
        ? sortedChunks.map((c, idx) => ({
            ...c,
            durationSec: fastWavSegments?.[idx]?.durationSec ?? c.durationSec,
          }))
        : sortedChunks;
      const subtitleCues = generateSubtitlesFromChunks(timedChunks, {
        punctuationPauses: ttsSnapshot?.pauses,
        ...(transSnapshot?.aspectRatio ? { aspectRatio: transSnapshot.aspectRatio } : {}),
        ...(transSnapshot?.maxLines ? { maxLines: transSnapshot.maxLines } : {}),
      });
      const subContent =
        subFormat === "vtt" ? exportToVtt(subtitleCues) : exportToSrt(subtitleCues);

      const subResolution = resolveArtifactPath({
        outputDir,
        baseName: baseStem,
        extension: subFormat,
        collisionPolicy,
        checkPathExists,
      });

      if (subResolution.action !== "skip") {
        if (writeFile) {
          await writeFile(subResolution.resolvedPath, subContent);
        }
        outputArtifactPaths.push(subResolution.resolvedPath);
      }
    }

    onProgress?.(100, "Hoàn tất tạo giọng đọc TTS!");

    const qcStats = countChunkQualityIssues(sortedChunks);
    const qcWarning =
      qcStats.errorCount > 0 || qcStats.warningCount > 0
        ? retriesUsed > 0
          ? `Hậu kiểm chất lượng TTS (đã tự động tạo lại ${retriesUsed} lần): ${qcStats.errorCount} đoạn lỗi, ${qcStats.warningCount} đoạn cảnh báo.`
          : `Hậu kiểm chất lượng TTS: ${qcStats.errorCount} đoạn lỗi, ${qcStats.warningCount} đoạn cảnh báo.`
        : undefined;

    const qcChunks: BatchQcChunkItem[] = sortedChunks.map((c) => ({
      id: c.id,
      index: c.index,
      text: c.text,
      originalText: c.originalText,
      voiceId,
      durationSec: c.durationSec ?? 0,
      audioFilePath: c.audioFilePath || c.audioUrl || "",
      ...(c.qualityReview ? { qualityReview: c.qualityReview } : {}),
    }));

    return {
      task: "tts",
      status: qcWarning ? "completed_with_warning" : "completed",
      progressPct: 100,
      outputArtifactPaths,
      qcChunks,
      qcStats: {
        totalChunks: sortedChunks.length,
        passCount: qcStats.passCount,
        warningCount: qcStats.warningCount,
        errorCount: qcStats.errorCount,
        unverifiedCount: qcStats.unverifiedCount,
      },
      ...(qcWarning ? { warning: qcWarning } : {}),
      startedAt,
      completedAt: Date.now(),
    };
  }
}

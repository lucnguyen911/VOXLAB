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

import { BatchJob, BatchStepResult, BatchTtsSnapshot } from "../../../types/batch";
import { ChunkItem } from "../../../types/ui";
import { normalizeText, getDefaultEnabledGroupIds } from "../../normalizer/engine";
import { splitScriptWithPauses } from "../../pause/chunker";
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
import { edgeTtsProvider } from "../../providers/edgeProvider";

export interface TtsExecutorOptions {
  textContent?: string;
  onProgress?: (progressPct: number, stageMessage?: string) => void;
  isCancelled?: () => boolean;
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
    const { onProgress, isCancelled, writeFile, checkPathExists = () => false, ai } = options;
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

    // 2. Normalization
    const normResult = normalizeText(rawText, getDefaultEnabledGroupIds());
    const normalizedText = normResult.normalizedText;

    // 3. Smart Chunking with pauses
    const chunks: ChunkItem[] = splitScriptWithPauses(normalizedText);
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
    const model = ttsSnapshot?.model || "";
    const voiceId = ttsSnapshot?.voiceId || "";
    const speed = ttsSnapshot?.speed && ttsSnapshot.speed !== 1 ? ttsSnapshot.speed : undefined;
    const isOnlineVoice =
      typeof voiceId === "string" &&
      (voiceId.includes("Neural") || voiceId.startsWith("edge_") || voiceId.startsWith("google_"));
    if (!isOnlineVoice) {
      try {
        ai.resolveEngine(model, voiceId, normalizedText, undefined, speed);
      } catch (e) {
        return fail(10, AiError.from(e).message);
      }
    }

    const scratchScope = `tts-${job.id}`.replace(/[^\w-]/g, "_");
    const sortedChunks = [...chunks].sort((a, b) => a.index - b.index);
    const totalChunks = sortedChunks.length;
    for (let i = 0; i < totalChunks; i++) {
      if (isCancelled?.()) return cancelled(Math.floor(10 + (i / totalChunks) * 60));
      const chunk = sortedChunks[i];
      try {
        const outputPath = await ai.scratchPath(
          scratchScope,
          `chunk_${String(i + 1).padStart(4, "0")}.${isOnlineVoice ? "mp3" : "wav"}`
        );
        let r: { durationSec: number; outputPath: string };
        if (isOnlineVoice) {
          r = await edgeTtsProvider.synthesize({
            voiceId,
            text: chunk.text,
            outputPath,
            speed,
          });
        } else {
          r = await ai.synthesize({ model, voiceId, text: chunk.text, outputPath, speed });
        }
        chunk.durationSec = r.durationSec; // real audio duration → synthesized_timing subtitles
        chunk.audioUrl = r.outputPath;
        chunk.status = "ready";
      } catch (e) {
        const err = AiError.from(e);
        if (err.code === "CANCELLED" || isCancelled?.()) return cancelled(Math.floor(10 + (i / totalChunks) * 60));
        return fail(Math.floor(10 + (i / totalChunks) * 60), `Lỗi tạo giọng đoạn ${i + 1}/${totalChunks}: ${err.message}`);
      }
      const pct = Math.floor(10 + ((i + 1) / totalChunks) * 60);
      onProgress?.(pct, `Đang tạo giọng đọc: đoạn ${i + 1}/${totalChunks}...`);
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

    // 6. Assemble master from the real chunk audio (sidecar writes atomically; MP3 = real LAME encode)
    if (audioResolution.action !== "skip") {
      onProgress?.(75, "Đang ghép nối tệp âm thanh Master...");
      const pauses = computeChunkPausesMs(sortedChunks);
      try {
        await ai.assemble({
          inputs: sortedChunks.map((c, i) => ({ path: c.audioUrl as string, gapAfterMs: pauses[i] })),
          outputPath: audioResolution.resolvedPath,
          format: targetAudioFormat,
        });
      } catch (e) {
        const err = AiError.from(e);
        if (err.code === "CANCELLED") return cancelled(75);
        return fail(75, `Lỗi ghép Master audio: ${err.message}`);
      }
      outputArtifactPaths.push(audioResolution.resolvedPath);
    }

    // 7. Text Subtitle Timing Invariant: Subtitle generated directly from chunk timing!
    const needsSubtitle =
      job.selectedTasks.includes("transcription") ||
      (job.effectiveConfigSnapshot?.tasks.tts?.sentencePauseMs !== undefined);

    if (needsSubtitle) {
      onProgress?.(90, "Đang tạo phụ đề đồng bộ từ thời lượng giọng đọc...");
      const subtitleCues = generateSubtitlesFromChunks(chunks);
      const subFormat = job.outputSnapshot?.outputSubtitleFormat || "srt";
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

    return {
      task: "tts",
      status: "completed",
      progressPct: 100,
      outputArtifactPaths,
      startedAt,
      completedAt: Date.now(),
    };
  }
}

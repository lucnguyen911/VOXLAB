/**
 * Dubbing Step Executor (TASK-09 / AC-11, AC-18)
 *
 * Implements Dubbing TTS & Master Assembly step execution:
 * 1. Loads translated subtitle cues.
 * 2. Synthesizes audio segments for each cue within WSOLA 1.20x ceiling.
 * 3. Runs Timing Collision Analysis:
 *    - If collision_danger: blocks Master WAV generation, preserves committed subtitle, returns completed_with_warning.
 *    - On technical failure: preserves committed subtitle, returns failed_with_artifact.
 * 4. Merges and exports Master Audio (WAV / MP3).
 * 5. Registers artifacts in BatchStepResult.
 */

import { BatchJob, BatchStepResult, BatchDubbingSnapshot } from "../../../types/batch";
import {
  OriginalCue,
  DubAudioSegment,
  TimingOverflowMetadata,
} from "../../../types/dubbing";
import { parseSubtitle } from "../../subtitle/parser";
import { analyzeTimingCollision, canExportMasterWav } from "../../dubbing/collisionDetector";
import {
  resolveJobOutputDirectory,
  resolveArtifactPath,
  getFileStem,
} from "../outputResolver";
import { AiError } from "../../ai/types";
import type { LocalAiServices } from "../../ai/localAiServices";

export interface DubbingExecutorOptions {
  subtitleContent?: string;
  onProgress?: (progressPct: number, stageMessage?: string) => void;
  isCancelled?: () => boolean;
  writeFile?: (path: string, content: Uint8Array | string) => Promise<void>;
  checkPathExists?: (path: string) => boolean;
  /** Local AI runtime (shared TtsEngineAdapter via sidecar). */
  ai?: LocalAiServices;
  forceCollisionDangerForTest?: boolean;
  forceTechnicalErrorForTest?: boolean;
}

export class DubbingExecutor {
  /**
   * Executes the Dubbing step for a given BatchJob.
   */
  static async execute(
    job: BatchJob,
    options: DubbingExecutorOptions = {}
  ): Promise<BatchStepResult> {
    const {
      onProgress,
      isCancelled,
      checkPathExists = () => false,
      ai,
      forceCollisionDangerForTest,
      forceTechnicalErrorForTest,
    } = options;
    const startedAt = Date.now();

    onProgress?.(5, "Đang nạp phụ đề để chuẩn bị lồng tiếng...");

    if (isCancelled?.()) {
      return {
        task: "dubbing",
        status: "cancelled",
        progressPct: 5,
        outputArtifactPaths: [],
        startedAt,
        completedAt: Date.now(),
      };
    }

    // 1. Resolve translated subtitle
    const rawSubtitle = options.subtitleContent || "";
    if (!rawSubtitle.trim()) {
      return {
        task: "dubbing",
        status: "failed",
        progressPct: 0,
        outputArtifactPaths: [],
        error: "Không tìm thấy phụ đề đầu vào để thực hiện lồng tiếng.",
        startedAt,
        completedAt: Date.now(),
      };
    }

    let cues: OriginalCue[];
    try {
      cues = parseSubtitle(rawSubtitle);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        task: "dubbing",
        status: "failed",
        progressPct: 10,
        outputArtifactPaths: [],
        error: `Lỗi bóc tách phụ đề: ${msg}`,
        startedAt,
        completedAt: Date.now(),
      };
    }

    if (cues.length === 0) {
      return {
        task: "dubbing",
        status: "failed",
        progressPct: 10,
        outputArtifactPaths: [],
        error: "Kịch bản phụ đề không có câu nào.",
        startedAt,
        completedAt: Date.now(),
      };
    }

    onProgress?.(20, `Đang tạo audio lồng tiếng cho ${cues.length} câu...`);

    const dubSnapshot: BatchDubbingSnapshot | undefined =
      job.effectiveConfigSnapshot?.tasks.dubbing || job.configOverrides.dubbing;
    const fail = (progressPct: number, error: string): BatchStepResult => ({
      task: "dubbing",
      status: "failed",
      progressPct,
      outputArtifactPaths: [],
      error,
      startedAt,
      completedAt: Date.now(),
    });
    const cancelled = (progressPct: number): BatchStepResult => ({
      task: "dubbing",
      status: "cancelled",
      progressPct,
      outputArtifactPaths: [],
      startedAt,
      completedAt: Date.now(),
    });
    if (!ai) {
      return fail(20, "Local AI runtime chưa sẵn sàng (sidecar không khả dụng) — không thể lồng tiếng thật.");
    }

    // Shared TtsEngineAdapter: whichever local engine the job selected (never hard-coded).
    const model = dubSnapshot?.ttsModel || "";
    const voiceId = dubSnapshot?.voiceId || "";
    let engineSupportsSpeed = false;
    try {
      engineSupportsSpeed = ai.resolveEngine(model, voiceId, cues.map((c) => c.text).join(" ")).caps.supportsSpeed;
    } catch (e) {
      return fail(20, AiError.from(e).message);
    }
    const speedCeiling = Math.min(1.2, dubSnapshot?.speedMultiplier || 1.2);

    // 2. Synthesize audio segment for each cue (fit with the engine's native speed, ceiling 1.20x)
    const audioSegments: Record<number, DubAudioSegment> = {};
    const segmentPaths: Record<number, string> = {};
    const scratchScope = `dub-${job.id}`.replace(/[^\w-]/g, "_");
    const total = cues.length;

    for (let i = 0; i < total; i++) {
      if (isCancelled?.()) return cancelled(Math.floor(20 + (i / total) * 50));

      const cue = cues[i];
      const cueDuration = cue.endSec - cue.startSec;
      try {
        const outputPath = await ai.scratchPath(scratchScope, `cue_${String(i + 1).padStart(4, "0")}.wav`);
        const raw = await ai.synthesize({ model, voiceId, text: cue.text, outputPath });
        let fitted = raw;
        let speedFactor = 1.0;
        if (raw.durationSec > cueDuration && engineSupportsSpeed && cueDuration > 0) {
          speedFactor = Math.min(speedCeiling, raw.durationSec / cueDuration);
          if (speedFactor > 1.0001) {
            fitted = await ai.synthesize({ model, voiceId, text: cue.text, outputPath, speed: speedFactor });
          }
        }
        const audioStartSec = cue.startSec;
        audioSegments[cue.index] = {
          cueIndex: cue.index,
          status: "ready",
          targetDurationSec: cueDuration,
          rawDurationSec: raw.durationSec,
          speedFactor,
          fittedDurationSec: fitted.durationSec,
          audioStartSec,
          audioEndSec: Number((audioStartSec + fitted.durationSec).toFixed(3)),
        };
        segmentPaths[cue.index] = fitted.outputPath;
      } catch (e) {
        const err = AiError.from(e);
        if (err.code === "CANCELLED" || isCancelled?.()) return cancelled(Math.floor(20 + (i / total) * 50));
        return fail(Math.floor(20 + (i / total) * 50), `Lỗi tạo giọng câu ${i + 1}/${total}: ${err.message}`);
      }

      const pct = Math.floor(20 + ((i + 1) / total) * 50);
      onProgress?.(pct, `Đang tạo giọng đọc câu ${i + 1}/${total}...`);
    }

    // 3. Technical Error Simulation Check (AC-11: failed_with_artifact)
    if (forceTechnicalErrorForTest) {
      return {
        task: "dubbing",
        status: "failed", // Will map to failed_with_artifact at job level
        progressPct: 70,
        outputArtifactPaths: [],
        error: "Sự cố kỹ thuật trong quá trình ghép audio Dubbing (OOM / worker crash).",
        startedAt,
        completedAt: Date.now(),
      };
    }

    onProgress?.(75, "Đang kiểm tra an toàn va chạm âm thanh giữa các câu...");

    // 4. Timing Collision Analysis (AC-11) on REAL durations
    if (forceCollisionDangerForTest && cues.length >= 2) {
      audioSegments[cues[0].index].fittedDurationSec = (cues[1].startSec - cues[0].startSec) + 2.0;
    }
    const overflowAnalysis: Record<number, TimingOverflowMetadata> = analyzeTimingCollision(cues, audioSegments);
    const collisionCheck = canExportMasterWav(overflowAnalysis);

    // If collision danger detected: BLOCK Master WAV export, preserve committed subtitle
    if (!collisionCheck.allowed) {
      onProgress?.(100, "Phát hiện nguy cơ đè tiếng: chặn xuất Master WAV, giữ nguyên phụ đề.");
      return {
        task: "dubbing",
        status: "completed_with_warning",
        progressPct: 100,
        outputArtifactPaths: [],
        warning: `Phát hiện nguy cơ đè tiếng (collision_danger): ${collisionCheck.reason}. Đã chặn tạo tệp Master audio, giữ nguyên phụ đề đã dịch.`,
        startedAt,
        completedAt: Date.now(),
      };
    }

    const targetAudioFormat = job.outputSnapshot?.outputAudioFormat || "wav";

    // 6. Resolve Output Paths
    const outputDir = resolveJobOutputDirectory(job);
    const baseStem = `${getFileStem(job.sourceFileName)}_dubbed`;
    const collisionPolicy = job.outputSnapshot?.collisionPolicy || "auto_rename";

    const audioResolution = resolveArtifactPath({
      outputDir,
      baseName: baseStem,
      extension: targetAudioFormat,
      collisionPolicy,
      checkPathExists,
    });

    const outputArtifactPaths: string[] = [];

    if (audioResolution.action !== "skip") {
      onProgress?.(85, "Đang ghép nối và xuất tệp Master Audio...");
      try {
        await ai.assemble({
          mode: "timeline",
          inputs: cues.map((c) => ({ path: segmentPaths[c.index], startSec: audioSegments[c.index].audioStartSec })),
          totalDurationSec: Math.max(...cues.map((c) => c.endSec)),
          outputPath: audioResolution.resolvedPath,
          format: targetAudioFormat,
        });
      } catch (e) {
        const err = AiError.from(e);
        if (err.code === "CANCELLED") return cancelled(85);
        return fail(85, `Lỗi ghép Master audio lồng tiếng: ${err.message}`);
      }
      outputArtifactPaths.push(audioResolution.resolvedPath);
    }

    onProgress?.(100, "Hoàn tất lồng tiếng Master Audio!");

    return {
      task: "dubbing",
      status: "completed",
      progressPct: 100,
      outputArtifactPaths,
      startedAt,
      completedAt: Date.now(),
    };
  }
}

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
  DubbingMode,
} from "../../../types/dubbing";
import { parseSubtitle } from "../../subtitle/parser";
import { analyzeTimingCollision, canExportMasterWav } from "../../dubbing/collisionDetector";
import {
  MAX_DUB_SPEEDUP,
  DEFAULT_SAFETY_GAP_SEC,
  calculateTimingFit,
  applyWsolaTimeStretchToWavFile,
} from "../../dubbing/timingFit";
import {
  planDubbingSpeechGroups,
  normalizeCueTextForSpeech,
  expandGroupSegmentToCueSegments,
} from "../../dubbing/speechPlanner";
import {
  resolveJobOutputDirectory,
  resolveArtifactPath,
  getFileStem,
} from "../outputResolver";
import { AiError } from "../../ai/types";
import type { LocalAiServices } from "../../ai/localAiServices";
import { getEngineAdvancedSettings } from "../../ai/ttsAdvancedSettings";
import { getEffectiveRules } from "../../pronunciation";
import {
  validateChunkAudioQuality,
  countChunkQualityIssues,
} from "../../audio/qualityValidator";

export interface DubbingExecutorOptions {
  subtitleContent?: string;
  dubbingMode?: DubbingMode;
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

    const dubSnapshot: BatchDubbingSnapshot | undefined =
      job.effectiveConfigSnapshot?.tasks.dubbing || job.configOverrides.dubbing;
    const dubbingMode: DubbingMode =
      options.dubbingMode || (dubSnapshot as any)?.dubbingMode || "sentence_group";

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

    const model = dubSnapshot?.ttsModel || "";
    const voiceId = dubSnapshot?.voiceId || "";
    const effectiveRules = getEffectiveRules("dubbing");
    try {
      ai.resolveEngine(model, voiceId, cues.map((c) => normalizeCueTextForSpeech(c.text)).join(" "));
    } catch (e) {
      return fail(20, AiError.from(e).message);
    }
    const speedCeiling = Math.min(
      MAX_DUB_SPEEDUP,
      Math.max(1.0, dubSnapshot?.speedMultiplier || MAX_DUB_SPEEDUP)
    );

    const jobAdvancedSettings = getEngineAdvancedSettings(model);

    const audioSegments: Record<number, DubAudioSegment> = {};
    const primarySegmentsForQc: DubAudioSegment[] = [];
    const scratchScope = `dub-${job.id}`.replace(/[^\w-]/g, "_");

    const isGroupMode =
      dubbingMode === "source_sync" ||
      dubbingMode === "free_narration" ||
      (dubbingMode as any) === "sentence_group";

    if (isGroupMode) {
      const groups = planDubbingSpeechGroups(cues);
      const totalGroups = groups.length;
      onProgress?.(20, `Đang tạo audio thuyết minh liền mạch cho ${totalGroups} nhóm câu (${cues.length} cue)...`);

      for (let gIdx = 0; gIdx < totalGroups; gIdx++) {
        if (isCancelled?.()) return cancelled(Math.floor(20 + (gIdx / totalGroups) * 50));

        const group = groups[gIdx];
        const primaryCueIndex = group.sourceCueIds[0];
        const cleanText = normalizeCueTextForSpeech(group.speechText || group.sourceText);
        const groupSpanSec = Math.max(0.2, Number((group.endSec - group.startSec).toFixed(3)));
        const availableSec = Math.max(groupSpanSec, group.availableDurationSec);

        try {
          const outputPath = await ai.scratchPath(
            scratchScope,
            `${group.groupId}.wav`
          );
          const raw = await ai.synthesize({
            model,
            voiceId,
            text: cleanText,
            outputPath,
            advancedSettings: jobAdvancedSettings,
            pronunciationRules: effectiveRules,
            projectId: "dubbing",
          });

          const fit = calculateTimingFit(raw.durationSec, availableSec, speedCeiling);
          let fittedDurationSec = fit.fittedDurationSec;
          let speedFactor = fit.speedFactor;

          if (fit.isStretched && fit.speedFactor > 1.001) {
            const stretched = await applyWsolaTimeStretchToWavFile(raw.outputPath, fit.speedFactor);
            if (stretched && stretched.isStretched) {
              fittedDurationSec = stretched.fittedDurationSec;
              speedFactor = stretched.appliedSpeedFactor;
            }
          }

          const primarySegment: DubAudioSegment = {
            cueIndex: primaryCueIndex,
            text: cleanText,
            status: "ready",
            targetDurationSec: groupSpanSec,
            rawDurationSec: raw.durationSec,
            speedFactor,
            fittedDurationSec,
            audioStartSec: group.startSec,
            audioEndSec: Number((group.startSec + fittedDurationSec).toFixed(3)),
            audioFilePath: raw.outputPath,
            groupId: group.groupId,
            groupCueIndices: [...group.sourceCueIds],
            isGroupPrimary: true,
            primaryCueIndex,
          };

          const expanded = expandGroupSegmentToCueSegments(group, primarySegment, cues);
          Object.assign(audioSegments, expanded);
          primarySegmentsForQc.push(audioSegments[primaryCueIndex]);
        } catch (e) {
          const err = AiError.from(e);
          if (err.code === "CANCELLED" || isCancelled?.()) {
            return cancelled(Math.floor(20 + (gIdx / totalGroups) * 50));
          }
          return fail(
            Math.floor(20 + (gIdx / totalGroups) * 50),
            `Lỗi tạo giọng nhóm câu ${gIdx + 1}/${totalGroups}: ${err.message}`
          );
        }

        const pct = Math.floor(20 + ((gIdx + 1) / totalGroups) * 45);
        onProgress?.(pct, `Đang tạo giọng nhóm câu ${gIdx + 1}/${totalGroups}...`);
      }
    } else {
      // Mode 1: cue_strict (1:1 per-cue synthesis)
      const total = cues.length;
      onProgress?.(20, `Đang tạo audio lồng tiếng cho ${total} câu...`);

      for (let i = 0; i < total; i++) {
        if (isCancelled?.()) return cancelled(Math.floor(20 + (i / total) * 50));

        const cue = cues[i];
        const nextCue = cues[i + 1];
        const cleanText = normalizeCueTextForSpeech(cue.text);
        const cueDuration = Math.max(0.2, Number((cue.endSec - cue.startSec).toFixed(3)));
        const availableSec = nextCue
          ? Math.max(cueDuration, Number((nextCue.startSec - cue.startSec - DEFAULT_SAFETY_GAP_SEC).toFixed(3)))
          : cueDuration;

        try {
          const outputPath = await ai.scratchPath(
            scratchScope,
            `cue_${String(i + 1).padStart(4, "0")}.wav`
          );
          const raw = await ai.synthesize({
            model,
            voiceId,
            text: cleanText,
            outputPath,
            advancedSettings: jobAdvancedSettings,
            pronunciationRules: effectiveRules,
            projectId: "dubbing",
          });

          const fit = calculateTimingFit(raw.durationSec, availableSec, speedCeiling);
          let fittedDurationSec = fit.fittedDurationSec;
          let speedFactor = fit.speedFactor;

          if (fit.isStretched && fit.speedFactor > 1.001) {
            const stretched = await applyWsolaTimeStretchToWavFile(raw.outputPath, fit.speedFactor);
            if (stretched && stretched.isStretched) {
              fittedDurationSec = stretched.fittedDurationSec;
              speedFactor = stretched.appliedSpeedFactor;
            }
          }

          const segment: DubAudioSegment = {
            cueIndex: cue.index,
            text: cleanText,
            status: "ready",
            targetDurationSec: cueDuration,
            rawDurationSec: raw.durationSec,
            speedFactor,
            fittedDurationSec,
            audioStartSec: cue.startSec,
            audioEndSec: Number((cue.startSec + fittedDurationSec).toFixed(3)),
            audioFilePath: raw.outputPath,
            isGroupPrimary: true,
            primaryCueIndex: cue.index,
          };

          audioSegments[cue.index] = segment;
          primarySegmentsForQc.push(segment);
        } catch (e) {
          const err = AiError.from(e);
          if (err.code === "CANCELLED" || isCancelled?.()) return cancelled(Math.floor(20 + (i / total) * 50));
          return fail(Math.floor(20 + (i / total) * 50), `Lỗi tạo giọng câu ${i + 1}/${total}: ${err.message}`);
        }

        const pct = Math.floor(20 + ((i + 1) / total) * 45);
        onProgress?.(pct, `Đang tạo giọng đọc câu ${i + 1}/${total}...`);
      }
    }

    // Deferred post-TTS Whisper ASR quality verification pass (prevents TTS<->ASR GPU model thrashing)
    if (typeof ai.validateAudioQuality === "function" && primarySegmentsForQc.length > 0) {
      onProgress?.(68, "Đang hậu kiểm chất lượng giọng đọc bằng Whisper...");
      for (const seg of primarySegmentsForQc) {
        if (isCancelled?.()) return cancelled(68);
        try {
          const review = await validateChunkAudioQuality(
            seg,
            undefined,
            ai,
            seg.speedFactor || 1.0,
            undefined,
            "dubbing"
          );
          seg.qualityReview = review;
          if (seg.groupCueIndices && seg.groupCueIndices.length > 1) {
            for (const memberIdx of seg.groupCueIndices) {
              if (audioSegments[memberIdx]) {
                audioSegments[memberIdx].qualityReview = review;
              }
            }
          }
        } catch {
          // Non-blocking: quality check failure must not abort batch synthesis
        }
      }
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
      const firstSeg = audioSegments[cues[0].index];
      const lastCuePos =
        firstSeg.groupCueIndices && firstSeg.groupCueIndices.length > 0
          ? cues.findIndex((c) => c.index === firstSeg.groupCueIndices![firstSeg.groupCueIndices!.length - 1])
          : 0;
      const nextCue = cues[Math.min(cues.length - 1, Math.max(1, lastCuePos + 1))];
      firstSeg.fittedDurationSec = (nextCue.startSec - cues[0].startSec) + 2.0;
    }
    const overflowAnalysis: Record<number, TimingOverflowMetadata> = analyzeTimingCollision(cues, audioSegments, dubbingMode);
    const collisionCheck = canExportMasterWav(overflowAnalysis, dubbingMode);

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
        let runningNarrationSec = 0;
        const pauseGapSec = 0.45;

        const primarySegs = cues
          .map((c) => audioSegments[c.index])
          .filter((seg): seg is DubAudioSegment => Boolean(seg && seg.isGroupPrimary !== false && seg.audioFilePath));

        const timelineInputs = primarySegs.map((seg, idx) => {
          const dur = seg.fittedDurationSec || seg.rawDurationSec || 1.0;
          const startSec = dubbingMode === "free_narration" ? runningNarrationSec : seg.audioStartSec;
          if (dubbingMode === "free_narration") {
            runningNarrationSec = Number((runningNarrationSec + dur).toFixed(3));
            if (idx < primarySegs.length - 1) {
              runningNarrationSec = Number((runningNarrationSec + pauseGapSec).toFixed(3));
            }
          }
          return {
            path: seg.audioFilePath!,
            startSec,
          };
        });

        const totalDurationSec =
          dubbingMode === "free_narration"
            ? runningNarrationSec
            : Math.max(
                ...cues.map((c) => c.endSec),
                ...primarySegmentsForQc.map((s) => s.audioEndSec)
              );

        await ai.assemble({
          mode: "timeline",
          inputs: timelineInputs,
          totalDurationSec,
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

    const qcStats = countChunkQualityIssues(primarySegmentsForQc);
    const qcWarning =
      qcStats.errorCount > 0 || qcStats.warningCount > 0
        ? `Hậu kiểm chất lượng Lồng tiếng: ${qcStats.errorCount} câu lỗi, ${qcStats.warningCount} câu cảnh báo.`
        : undefined;

    return {
      task: "dubbing",
      status: "completed",
      progressPct: 100,
      outputArtifactPaths,
      ...(qcWarning ? { warning: qcWarning } : {}),
      startedAt,
      completedAt: Date.now(),
    };
  }
}

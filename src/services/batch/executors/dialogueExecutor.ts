/**
 * Dialogue Step Executor (TASK-07 / AC-03, AC-04, AC-19)
 *
 * Implements multi-character Dialogue step execution:
 * 1. Parses dialogue script via dialogue/parser.ts.
 * 2. Applies 3-Tier Precedence for character voice assignments:
 *    Character Custom Voice > Dialogue Default Voice > Fallback Voice.
 * 3. Synthesizes individual character segment audio with chunk-level cancellation.
 * 4. Assembles master audio buffer via dialogue/masterAssembly.ts.
 * 5. Exports synchronized speaker-labeled subtitles (.srt / .vtt) via dialogue/srtExporter.ts.
 * 6. Resolves output paths with External Modification Protection and registers artifacts.
 */

import { BatchJob, BatchStepResult, BatchDialogueSnapshot } from "../../../types/batch";
import {
  DialogueGlobalSettings,
  DialogueSegment,
  DEFAULT_DIALOGUE_SETTINGS,
} from "../../../types/dialogue";
import { parseDialogueScript } from "../../dialogue/parser";
import { calculateDialogueTimeline } from "../../dialogue/masterAssembly";
import { generateDialogueSrt } from "../../dialogue/srtExporter";
import {
  resolveJobOutputDirectory,
  resolveArtifactPath,
  getFileStem,
  convertSubtitleFormat,
} from "../outputResolver";
import { AiError } from "../../ai/types";
import type { LocalAiServices } from "../../ai/localAiServices";
import { edgeTtsProvider } from "../../providers/edgeProvider";

export interface DialogueExecutorOptions {
  scriptContent?: string;
  onProgress?: (progressPct: number, stageMessage?: string) => void;
  isCancelled?: () => boolean;
  writeFile?: (path: string, content: Uint8Array | string) => Promise<void>;
  checkPathExists?: (path: string) => boolean;
  /** Local AI runtime (sidecar). Required: there is no simulated synthesis. */
  ai?: LocalAiServices;
}

export class DialogueExecutor {
  /**
   * Executes the Dialogue step for a given BatchJob.
   */
  static async execute(
    job: BatchJob,
    options: DialogueExecutorOptions = {}
  ): Promise<BatchStepResult> {
    const { onProgress, isCancelled, writeFile, checkPathExists = () => false, ai } = options;
    const startedAt = Date.now();

    onProgress?.(5, "Đang phân tích cấu trúc phân vai kịch bản hội thoại...");

    // 1. Load script text
    const rawText = options.scriptContent || job.sourceFileName || "";
    if (!rawText.trim()) {
      return {
        task: "dialogue",
        status: "failed",
        progressPct: 0,
        outputArtifactPaths: [],
        error: "Nội dung kịch bản hội thoại trống.",
        startedAt,
        completedAt: Date.now(),
      };
    }

    if (isCancelled?.()) {
      return {
        task: "dialogue",
        status: "cancelled",
        progressPct: 5,
        outputArtifactPaths: [],
        startedAt,
        completedAt: Date.now(),
      };
    }

    // 2. Parse dialogue script
    const parseResult = parseDialogueScript(rawText);
    if (!parseResult.segments || parseResult.segments.length === 0) {
      return {
        task: "dialogue",
        status: "failed",
        progressPct: 10,
        outputArtifactPaths: [],
        error: "Kịch bản không chứa lượt thoại phân vai hợp lệ theo định dạng [Tên nhân vật]: Lời thoại.",
        startedAt,
        completedAt: Date.now(),
      };
    }

    // 3. Resolve Voice Precedence (3-Tier Precedence)
    const dialogueSnapshot: BatchDialogueSnapshot | undefined =
      job.effectiveConfigSnapshot?.tasks.dialogue || job.configOverrides.dialogue;

    const characterVoices = dialogueSnapshot?.characterVoices || {};
    const defaultVoice = dialogueSnapshot?.defaultVoiceId || "vi-VN-HoaiMyNeural";
    const model = dialogueSnapshot?.model || "";
    const fail = (progressPct: number, error: string): BatchStepResult => ({
      task: "dialogue",
      status: "failed",
      progressPct,
      outputArtifactPaths: [],
      error,
      startedAt,
      completedAt: Date.now(),
    });
    const cancelled = (progressPct: number): BatchStepResult => ({
      task: "dialogue",
      status: "cancelled",
      progressPct,
      outputArtifactPaths: [],
      startedAt,
      completedAt: Date.now(),
    });
    if (!ai) {
      return fail(15, "Local AI runtime chưa sẵn sàng (sidecar không khả dụng) — không thể tạo giọng thoại thật.");
    }

    // 4. Synthesize character audio segments (validate every voice first: no silent fallback)
    const segments: DialogueSegment[] = parseResult.segments;
    const totalSegments = segments.length;
    for (const seg of segments) {
      seg.voiceId = characterVoices[seg.characterName] || defaultVoice;
      const vId = String(seg.voiceId);
      const isOnlineVoice = vId.includes("Neural") || vId.startsWith("edge_") || vId.startsWith("google_");
      if (!isOnlineVoice) {
        try {
          ai.resolveEngine(model, seg.voiceId, seg.cleanText);
        } catch (e) {
          return fail(15, `Nhân vật "${seg.characterName}": ${AiError.from(e).message}`);
        }
      }
    }

    const scratchScope = `dlg-${job.id}`.replace(/[^\w-]/g, "_");
    const segmentPaths: string[] = [];
    for (let i = 0; i < totalSegments; i++) {
      if (isCancelled?.()) return cancelled(Math.floor(15 + (i / totalSegments) * 55));
      const seg = segments[i];
      try {
        const vId = String(seg.voiceId || defaultVoice);
        const isOnline = vId.includes("Neural") || vId.startsWith("edge_");
        const outputPath = await ai.scratchPath(
          scratchScope,
          `turn_${String(i + 1).padStart(4, "0")}.${isOnline ? "mp3" : "wav"}`
        );
        let r: { durationSec: number; outputPath: string };
        if (isOnline) {
          r = await edgeTtsProvider.synthesize({
            voiceId: vId,
            text: seg.cleanText,
            outputPath,
          });
        } else {
          r = await ai.synthesize({ model, voiceId: vId, text: seg.cleanText, outputPath });
        }
        seg.durationSec = r.durationSec; // real duration → speaker timeline + subtitles
        segmentPaths.push(r.outputPath);
      } catch (e) {
        const err = AiError.from(e);
        if (err.code === "CANCELLED" || isCancelled?.()) return cancelled(Math.floor(15 + (i / totalSegments) * 55));
        return fail(Math.floor(15 + (i / totalSegments) * 55),
          `Lỗi tạo giọng (${seg.characterName}) lượt ${i + 1}/${totalSegments}: ${err.message}`);
      }

      const pct = Math.floor(15 + ((i + 1) / totalSegments) * 55);
      onProgress?.(
        pct,
        `Đang tạo giọng thoại (${seg.characterName}): lượt ${i + 1}/${totalSegments}...`
      );
    }

    // 5. Timeline from real durations + turn-taking pauses
    const globalSettings: DialogueGlobalSettings = {
      ...DEFAULT_DIALOGUE_SETTINGS,
      model: model || DEFAULT_DIALOGUE_SETTINGS.model,
      masterVolume: 1.0,
      turnPauseSec: dialogueSnapshot?.turnPauseSec ?? 0.8,
      sameSpeakerPauseSec: dialogueSnapshot?.sameSpeakerPauseSec ?? 0.4,
      exportSrt: dialogueSnapshot?.exportSrt ?? true,
    };
    const assembly = calculateDialogueTimeline(segments, globalSettings);

    // 6. Resolve Output Paths
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

    if (audioResolution.action !== "skip") {
      onProgress?.(75, "Đang ghép nối âm thanh hội thoại đa nhân vật...");
      try {
        await ai.assemble({
          inputs: assembly.timeline.map((entry, i) => ({
            path: segmentPaths[i],
            gapAfterMs: Math.round(entry.pauseAfterSec * 1000),
          })),
          outputPath: audioResolution.resolvedPath,
          format: targetAudioFormat,
        });
      } catch (e) {
        const err = AiError.from(e);
        if (err.code === "CANCELLED") return cancelled(75);
        return fail(75, `Lỗi ghép Master audio hội thoại: ${err.message}`);
      }
      outputArtifactPaths.push(audioResolution.resolvedPath);
    }

    // 7. Generate Speaker-labeled Subtitle (.srt / .vtt)
    if (globalSettings.exportSrt) {
      onProgress?.(90, "Đang tạo phụ đề phân vai có nhãn nhân vật...");
      const srtContent = generateDialogueSrt(assembly.timeline);
      const subFormat = job.outputSnapshot?.outputSubtitleFormat || "srt";
      const finalSubContent =
        subFormat === "vtt"
          ? convertSubtitleFormat(srtContent, "srt", "vtt")
          : srtContent;

      const subResolution = resolveArtifactPath({
        outputDir,
        baseName: baseStem,
        extension: subFormat,
        collisionPolicy,
        checkPathExists,
      });

      if (subResolution.action !== "skip") {
        if (writeFile) {
          await writeFile(subResolution.resolvedPath, finalSubContent);
        }
        outputArtifactPaths.push(subResolution.resolvedPath);
      }
    }

    onProgress?.(100, "Hoàn tất tạo âm thanh và phụ đề phân vai!");

    return {
      task: "dialogue",
      status: "completed",
      progressPct: 100,
      outputArtifactPaths,
      startedAt,
      completedAt: Date.now(),
    };
  }
}

import {
  OriginalCue,
  TranslatedCue,
  DubAudioSegment,
  DubbingSpeechGroup,
  DubbingMode,
} from "../../types/dubbing";
import { EffectiveVoiceSnapshot } from "../../types/ui";
import {
  calculateTimingFit,
  MAX_DUB_SPEEDUP,
  DEFAULT_SAFETY_GAP_SEC,
  applyWsolaTimeStretchToWavFile,
} from "./timingFit";
import { normalizeCueTextForSpeech } from "./speechPlanner";
import { synthesizeSpeechCore } from "../providers/unifiedSynthesis";
import {
  QUALITY_VALIDATOR_VERSION,
  validateChunkAudioQuality,
} from "../audio/qualityValidator";

export interface DubbingSynthesisJob {
  originalCue: OriginalCue;
  translatedCue: TranslatedCue;
  voiceId: string;
  nextCue?: OriginalCue;
  speechGroup?: DubbingSpeechGroup;
  autoFit?: boolean;
  dubbingMode?: DubbingMode;
  voiceSettings?: {
    speed?: number;
    pitch?: number;
    volume?: number;
  };
  voiceSnapshot?: EffectiveVoiceSnapshot;
  advancedSettings?: Record<string, unknown>;
  asrModelId?: string;
  /** If true (default for batch), Whisper QC is deferred until all TTS jobs complete to prevent GPU model thrashing */
  deferQualityCheck?: boolean;
  synthesizer?: (
    text: string,
    cueIndex: number,
    speed?: number
  ) => Promise<{ durationSec: number; outputPath: string; blobUrl: string }>;
}

export type QueueState = "idle" | "running" | "paused" | "cancelled" | "completed";

export interface SynthesisQueueCallbacks {
  onJobStarted?: (cueIndex: number, group?: DubbingSpeechGroup) => void;
  onJobChecking?: (cueIndex: number, segment: DubAudioSegment, group?: DubbingSpeechGroup) => void;
  onJobCompleted?: (cueIndex: number, segment: DubAudioSegment, group?: DubbingSpeechGroup) => void;
  onJobQualityUpdated?: (cueIndex: number, segment: DubAudioSegment, group?: DubbingSpeechGroup) => void;
  onJobFailed?: (cueIndex: number, error: string, group?: DubbingSpeechGroup) => void;
  onProgress?: (completed: number, total: number) => void;
  onQueueFinished?: () => void;
}

/**
 * Shared canonical synthesis + WSOLA timing-fit execution for both batch queue and single-segment regeneration.
 * Guarantees:
 * - Strips subtitle display line breaks (\n) before TTS synthesis.
 * - Enforces MAX_DUB_SPEEDUP = 1.20x ceiling strictly (no 1.45x).
 * - Applies pitch-preserving WSOLA time-stretching directly onto the WAV file when rawDuration > availableWindow,
 *   without re-calling TTS inference or fake-clamping fittedDurationSec.
 */
export async function synthesizeAndFitDubbingUnit(
  job: DubbingSynthesisJob,
  options?: {
    isCancelled?: () => boolean;
    simulatedDelayMs?: number;
  }
): Promise<DubAudioSegment | null> {
  const { originalCue, translatedCue, speechGroup } = job;
  if (options?.isCancelled?.()) return null;

  const speedMultiplier =
    job.voiceSettings?.speed && job.voiceSettings.speed > 0
      ? job.voiceSettings.speed
      : job.voiceSnapshot?.speed && job.voiceSnapshot.speed > 0
      ? job.voiceSnapshot.speed
      : 1.0;

  const rawTextToSpeak = speechGroup
    ? speechGroup.speechText || translatedCue.text
    : translatedCue.speechFragmentText || translatedCue.text;
  const cleanTextToSpeak = normalizeCueTextForSpeech(rawTextToSpeak);

  const unitStartSec = speechGroup ? speechGroup.startSec : originalCue.startSec;
  const unitEndSec = speechGroup ? speechGroup.endSec : originalCue.endSec;
  const cueSpanSec = Math.max(0.2, Number((unitEndSec - unitStartSec).toFixed(3)));
  const isFreeNarration = job.dubbingMode === "free_narration";
  const isAutoFit = !isFreeNarration && job.autoFit !== false;

  let realResult: { durationSec: number; outputPath: string; blobUrl: string } | null = null;
  const synthId = speechGroup
    ? speechGroup.groupId
    : `cue_${originalCue.index}`;

  if (job.synthesizer) {
    realResult = await job.synthesizer(cleanTextToSpeak, originalCue.index, speedMultiplier);
  } else if (job.voiceSnapshot) {
    realResult = await synthesizeSpeechCore(cleanTextToSpeak, job.voiceSnapshot, {
      scope: "dubbing",
      id: synthId,
      advancedSettings: job.advancedSettings,
    });
  }

  if (options?.isCancelled?.()) return null;

  let rawDurationSec: number;
  let finalAudioUrl: string | undefined;
  let finalFilePath: string | undefined;

  if (realResult) {
    rawDurationSec = realResult.durationSec;
    finalAudioUrl = realResult.blobUrl;
    finalFilePath = realResult.outputPath;
  } else {
    if (typeof window !== "undefined" && (options?.simulatedDelayMs ?? 0) > 0) {
      await new Promise((resolve) => setTimeout(resolve, options!.simulatedDelayMs));
    }
    if (options?.isCancelled?.()) return null;

    const charCount = cleanTextToSpeak.length;
    rawDurationSec = Math.max(
      0.8,
      Number((charCount / 14.5 / speedMultiplier).toFixed(3))
    );
  }

  // Determine available window before the next cue or next speech group starts
  let availableWindowSec = cueSpanSec;
  if (isAutoFit) {
    if (speechGroup) {
      availableWindowSec = Math.max(cueSpanSec, speechGroup.availableDurationSec);
    } else if (job.nextCue) {
      availableWindowSec = Math.max(
        cueSpanSec,
        Number((job.nextCue.startSec - unitStartSec - DEFAULT_SAFETY_GAP_SEC).toFixed(3))
      );
    }
  }

  // Strictly enforce MAX_DUB_SPEEDUP (1.20x) ceiling per SPEC.md v2.5.3 Section 16.2 / AC-22
  const fit = calculateTimingFit(
    rawDurationSec,
    availableWindowSec,
    isAutoFit ? MAX_DUB_SPEEDUP : 1.0
  );
  let fittedSec = fit.fittedDurationSec;
  let appliedSpeedFactor = fit.speedFactor;

  // Apply pitch-preserving WSOLA time-stretching directly to the WAV file if speedup is required
  if (isAutoFit && fit.isStretched && fit.speedFactor > 1.001 && finalFilePath) {
    const stretchVerification = await applyWsolaTimeStretchToWavFile(
      finalFilePath,
      fit.speedFactor
    );
    if (stretchVerification && stretchVerification.isStretched) {
      fittedSec = stretchVerification.fittedDurationSec;
      appliedSpeedFactor = stretchVerification.appliedSpeedFactor;
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        try {
          const stretchedBlob = new Blob([stretchVerification.wavBuffer], {
            type: "audio/wav",
          });
          finalAudioUrl = URL.createObjectURL(stretchedBlob);
        } catch {
          // Keep existing blob URL if createObjectURL is unavailable in headless env
        }
      }
    }
  }

  const audioSig = `${finalAudioUrl || finalFilePath || ""}::${fittedSec}`;
  const segment: DubAudioSegment = {
    cueIndex: originalCue.index,
    text: cleanTextToSpeak,
    audioUrl: finalAudioUrl,
    audioFilePath: finalFilePath,
    fittedAudioUrl: finalAudioUrl,
    rawDurationSec: fit.rawDurationSec,
    targetDurationSec: cueSpanSec,
    fittedDurationSec: fittedSec,
    speedFactor: appliedSpeedFactor,
    audioStartSec: unitStartSec,
    audioEndSec: Number((unitStartSec + fittedSec).toFixed(3)),
    status: "ready",
    effectiveVoiceSnapshot: job.voiceSnapshot,
    acknowledgedAt: undefined,
    acknowledgedAudioSignature: undefined,
    groupId: speechGroup?.groupId,
    groupCueIndices: speechGroup ? [...speechGroup.sourceCueIds] : undefined,
    isGroupPrimary: true,
    primaryCueIndex: originalCue.index,
    qualityReview:
      job.voiceSnapshot && (finalFilePath || finalAudioUrl)
        ? {
            status: "checking",
            summary: "Đang chờ hậu kiểm Whisper...",
            issues: [],
            checkedAt: Date.now(),
            audioPath: finalFilePath,
            text: cleanTextToSpeak,
            validatorVersion: QUALITY_VALIDATOR_VERSION,
            asrModelId: job.asrModelId,
            audioSignature: audioSig,
          }
        : undefined,
  };

  return segment;
}

/**
 * Runs Whisper ASR quality check on a synthesized DubAudioSegment.
 */
export async function verifyDubbingSegmentQuality(
  segment: DubAudioSegment,
  job: DubbingSynthesisJob
): Promise<DubAudioSegment> {
  if (!job.voiceSnapshot || (!segment.audioFilePath && !segment.audioUrl)) {
    return segment;
  }

  const speedMultiplier =
    job.voiceSettings?.speed && job.voiceSettings.speed > 0
      ? job.voiceSettings.speed
      : job.voiceSnapshot.speed || 1.0;
  const effectiveSpeed = Number((speedMultiplier * (segment.speedFactor || 1.0)).toFixed(2));
  const audioSig = `${segment.audioUrl || segment.audioFilePath || ""}::${segment.fittedDurationSec}`;
  const cleanText = segment.text || normalizeCueTextForSpeech(job.translatedCue.text);

  try {
    const review = await validateChunkAudioQuality(
      segment,
      job.voiceSnapshot.language,
      undefined,
      effectiveSpeed,
      job.asrModelId,
      "dubbing"
    );
    return { ...segment, qualityReview: review };
  } catch (qErr: any) {
    return {
      ...segment,
      qualityReview: {
        status: "unverified",
        summary: `Chưa kiểm chứng (${qErr?.message || "lỗi hậu kiểm"})`,
        issues: [],
        checkedAt: Date.now(),
        audioPath: segment.audioFilePath,
        text: cleanText,
        validatorVersion: QUALITY_VALIDATOR_VERSION,
        asrModelId: job.asrModelId,
        audioSignature: audioSig,
      },
    };
  }
}

interface PendingQcEntry {
  job: DubbingSynthesisJob;
  segment: DubAudioSegment;
}

export class DubbingSynthesisQueue {
  private jobs: DubbingSynthesisJob[] = [];
  private state: QueueState = "idle";
  private completedCount = 0;
  private currentJobIndex = 0;
  private callbacks: SynthesisQueueCallbacks = {};
  private concurrency: number = 1;
  private activeRunning = 0;
  private pendingQcQueue: PendingQcEntry[] = [];
  private isRunningQc = false;

  constructor(callbacks?: SynthesisQueueCallbacks, concurrency: number = 1) {
    if (callbacks) {
      this.callbacks = callbacks;
    }
    this.concurrency = Math.max(1, concurrency);
  }

  setJobs(jobs: DubbingSynthesisJob[]) {
    this.jobs = [...jobs];
    this.completedCount = 0;
    this.currentJobIndex = 0;
    this.pendingQcQueue = [];
    this.isRunningQc = false;
    this.state = "idle";
  }

  getState(): QueueState {
    return this.state;
  }

  start() {
    if (this.state === "running") return;
    this.state = "running";
    this.processNext();
  }

  pause() {
    if (this.state === "running") {
      this.state = "paused";
    }
  }

  resume() {
    if (this.state === "paused") {
      this.state = "running";
      this.processNext();
    }
  }

  cancel() {
    this.state = "cancelled";
    this.pendingQcQueue = [];
  }

  private async processNext() {
    if (this.state !== "running") return;

    if (this.currentJobIndex >= this.jobs.length && this.activeRunning === 0) {
      if (this.pendingQcQueue.length > 0 && !this.isRunningQc) {
        this.isRunningQc = true;
        await this.drainDeferredQualityChecks();
        this.isRunningQc = false;
      }
      if (this.state === "running") {
        this.state = "completed";
        this.callbacks.onQueueFinished?.();
      }
      return;
    }

    while (this.activeRunning < this.concurrency && this.currentJobIndex < this.jobs.length) {
      const job = this.jobs[this.currentJobIndex++];
      this.activeRunning++;
      this.executeJob(job).finally(() => {
        this.activeRunning--;
        if (this.state === "running") {
          this.processNext();
        }
      });
    }
  }

  private isCancelled(): boolean {
    return this.state === "cancelled";
  }

  /**
   * Executes deferred Whisper ASR quality checks AFTER all TTS synthesis jobs finish,
   * preventing TTS<->ASR GPU model thrashing and keeping TTS synthesis unblocked.
   */
  private async drainDeferredQualityChecks(): Promise<void> {
    while (this.pendingQcQueue.length > 0 && !this.isCancelled()) {
      while ((this.state as QueueState) === "paused" && !this.isCancelled()) {
        await new Promise((r) => setTimeout(r, 150));
      }
      if (this.isCancelled()) break;

      const entry = this.pendingQcQueue.shift();
      if (!entry) break;

      const { job, segment } = entry;
      this.callbacks.onJobChecking?.(job.originalCue.index, segment, job.speechGroup);

      const verifiedSegment = await verifyDubbingSegmentQuality(segment, job);
      if (this.isCancelled()) break;

      if (this.callbacks.onJobQualityUpdated) {
        this.callbacks.onJobQualityUpdated(job.originalCue.index, verifiedSegment, job.speechGroup);
      } else {
        this.callbacks.onJobCompleted?.(job.originalCue.index, verifiedSegment, job.speechGroup);
      }
    }
  }

  private async executeJob(job: DubbingSynthesisJob): Promise<void> {
    const { originalCue, speechGroup } = job;
    this.callbacks.onJobStarted?.(originalCue.index, speechGroup);

    try {
      if (this.isCancelled()) return;

      const simulatedDelayMs = Math.max(40, Math.floor(120 / this.concurrency));
      let segment = await synthesizeAndFitDubbingUnit(job, {
        isCancelled: () => this.isCancelled(),
        simulatedDelayMs,
      });

      if (!segment || this.isCancelled()) return;

      const shouldDeferQc = job.deferQualityCheck !== false;

      if (job.voiceSnapshot && (segment.audioFilePath || segment.audioUrl)) {
        if (shouldDeferQc) {
          // Emit ready audio segment immediately (with qualityReview.status = "checking")
          // and enqueue Whisper QC for the post-TTS batch pass!
          this.pendingQcQueue.push({ job, segment });
        } else {
          this.callbacks.onJobChecking?.(originalCue.index, segment, speechGroup);
          segment = await verifyDubbingSegmentQuality(segment, job);
        }
      }

      if (this.isCancelled()) return;

      this.completedCount++;
      this.callbacks.onJobCompleted?.(originalCue.index, segment, speechGroup);
      this.callbacks.onProgress?.(this.completedCount, this.jobs.length);
    } catch (err: any) {
      this.callbacks.onJobFailed?.(
        originalCue.index,
        err?.message || "Synthesis error",
        speechGroup
      );
    }
  }
}

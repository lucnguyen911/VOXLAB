import {
  OriginalCue,
  TranslatedCue,
  DubAudioSegment,
} from "../../types/dubbing";
import { EffectiveVoiceSnapshot } from "../../types/ui";
import { calculateTimingFit } from "./timingFit";
import { synthesizeSpeechCore } from "../providers/unifiedSynthesis";

export interface DubbingSynthesisJob {
  originalCue: OriginalCue;
  translatedCue: TranslatedCue;
  voiceId: string;
  nextCue?: OriginalCue;
  autoFit?: boolean;
  voiceSettings?: {
    speed?: number;
    pitch?: number;
    volume?: number;
  };
  voiceSnapshot?: EffectiveVoiceSnapshot;
  advancedSettings?: Record<string, unknown>;
  synthesizer?: (
    text: string,
    cueIndex: number,
    speed?: number
  ) => Promise<{ durationSec: number; outputPath: string; blobUrl: string }>;
}

export type QueueState = "idle" | "running" | "paused" | "cancelled" | "completed";

export interface SynthesisQueueCallbacks {
  onJobStarted?: (cueIndex: number) => void;
  onJobCompleted?: (cueIndex: number, segment: DubAudioSegment) => void;
  onJobFailed?: (cueIndex: number, error: string) => void;
  onProgress?: (completed: number, total: number) => void;
  onQueueFinished?: () => void;
}

export class DubbingSynthesisQueue {
  private jobs: DubbingSynthesisJob[] = [];
  private state: QueueState = "idle";
  private completedCount = 0;
  private currentJobIndex = 0;
  private callbacks: SynthesisQueueCallbacks = {};
  private concurrency: number = 1;
  private activeRunning = 0;

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
  }

  private async processNext() {
    if (this.state !== "running") return;

    if (this.currentJobIndex >= this.jobs.length && this.activeRunning === 0) {
      this.state = "completed";
      this.callbacks.onQueueFinished?.();
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

  private async executeJob(job: DubbingSynthesisJob): Promise<void> {
    const { originalCue, translatedCue } = job;
    this.callbacks.onJobStarted?.(originalCue.index);

    try {
      if (this.isCancelled()) return;

      const speedMultiplier =
        job.voiceSettings?.speed && job.voiceSettings.speed > 0
          ? job.voiceSettings.speed
          : 1.0;

      let realResult: { durationSec: number; outputPath: string; blobUrl: string } | null = null;

      // 1. Synthesize real audio if backend is available
      if (job.synthesizer) {
        realResult = await job.synthesizer(translatedCue.text, originalCue.index, speedMultiplier);
      } else if (job.voiceSnapshot) {
        realResult = await synthesizeSpeechCore(translatedCue.text, job.voiceSnapshot, {
          scope: "dubbing",
          id: `cue_${originalCue.index}`,
          advancedSettings: job.advancedSettings,
        });
      }

      if (this.isCancelled()) return;

      const cueSpanSec = Number(
        (originalCue.endSec - originalCue.startSec).toFixed(3)
      );
      const isAutoFit = job.autoFit !== false;

      let rawDurationSec: number;
      let finalAudioUrl: string | undefined;
      let finalFilePath: string | undefined;

      if (realResult) {
        rawDurationSec = realResult.durationSec;
        finalAudioUrl = realResult.blobUrl;
        finalFilePath = realResult.outputPath;
      } else {
        // Fallback simulation for tests or headless environments without provider
        if (typeof window !== "undefined") {
          const simulatedDelay = Math.max(80, Math.floor(220 / this.concurrency));
          await new Promise((resolve) => setTimeout(resolve, simulatedDelay));
        }
        if (this.isCancelled()) return;

        const charCount = translatedCue.text.trim().length;
        rawDurationSec = Math.max(
          0.8,
          Number((charCount / 14 / speedMultiplier).toFixed(3))
        );
      }

      // When autoFit is enabled and nextCue exists, effective limit extends into the silence gap before next cue
      const effectiveLimitSec =
        isAutoFit && job.nextCue
          ? Math.max(
              cueSpanSec,
              Number((job.nextCue.startSec - originalCue.startSec - 0.02).toFixed(3))
            )
          : cueSpanSec;

      const maxSpeedup = isAutoFit ? 1.45 : undefined;

      // Apply WSOLA Timing Fit Semantics (TASK-14)
      const fit = calculateTimingFit(rawDurationSec, effectiveLimitSec, maxSpeedup);
      let fittedSec = fit.fittedDurationSec;

      // If auto-fit needs speedup (>1.02x) and we have real synthesis available:
      if (isAutoFit && fit.speedFactor > 1.02 && (job.voiceSnapshot || job.synthesizer)) {
        const speedAdjusted = Number((speedMultiplier * fit.speedFactor).toFixed(2));
        try {
          let reSynth: { durationSec: number; outputPath: string; blobUrl: string } | null = null;
          if (job.synthesizer) {
            reSynth = await job.synthesizer(translatedCue.text, originalCue.index, speedAdjusted);
          } else if (job.voiceSnapshot) {
            const speedSnapshot = { ...job.voiceSnapshot, speed: speedAdjusted };
            reSynth = await synthesizeSpeechCore(translatedCue.text, speedSnapshot, {
              scope: "dubbing",
              id: `cue_${originalCue.index}_fitted`,
              advancedSettings: job.advancedSettings,
            });
          }
          if (reSynth) {
            finalAudioUrl = reSynth.blobUrl;
            finalFilePath = reSynth.outputPath;
            fittedSec = reSynth.durationSec;
          }
        } catch (fitErr) {
          console.warn(`[DubbingQueue] Speed fit re-synthesis failed for cue ${originalCue.index}:`, fitErr);
        }
      }

      // Safety check: ensure speech never extends past subsequent cue's startSec
      if (
        isAutoFit &&
        job.nextCue &&
        originalCue.startSec + fittedSec > job.nextCue.startSec
      ) {
        fittedSec = Math.max(
          0.1,
          Number((job.nextCue.startSec - originalCue.startSec - 0.005).toFixed(3))
        );
      }

      const segment: DubAudioSegment = {
        cueIndex: originalCue.index,
        audioUrl: finalAudioUrl,
        audioFilePath: finalFilePath,
        fittedAudioUrl: finalAudioUrl,
        rawDurationSec: fit.rawDurationSec,
        targetDurationSec: cueSpanSec,
        fittedDurationSec: fittedSec,
        speedFactor: fit.speedFactor,
        audioStartSec: originalCue.startSec,
        audioEndSec: Number((originalCue.startSec + fittedSec).toFixed(3)),
        status: "ready",
      };

      this.completedCount++;
      this.callbacks.onJobCompleted?.(originalCue.index, segment);
      this.callbacks.onProgress?.(this.completedCount, this.jobs.length);
    } catch (err: any) {
      this.callbacks.onJobFailed?.(originalCue.index, err?.message || "Synthesis error");
    }
  }
}

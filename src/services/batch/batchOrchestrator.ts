/**
 * Composite Batch Orchestrator Core (TASK-10, TASK-11 / AC-09..AC-14, AC-20, AC-24..AC-27, AC-30)
 *
 * Implements Batch Execution Orchestration:
 * 1. Concurrency = 1 Baseline (strictly 1 active job and 1 active step at any time).
 * 2. Dynamic Priority Arrow Reorder:
 *    - Waiting jobs are sorted by integer queueOrder.
 *    - Processing job is always pinned at the top.
 *    - Reordering waiting jobs while running dynamically controls next dispatched job.
 * 3. Lazy Snapshot Freeze:
 *    - Only resolves and freezes effectiveConfigSnapshot right before waiting -> processing.
 * 4. Step Loop & Artifact Handoff:
 *    - Executes executionSequence passing upstream artifacts down the pipeline.
 * 5. Step Error Isolation & Emergency Block (ENOSPC / EACCES).
 * 6. Natural Queue Completion:
 *    - Automatically transitions running -> idle when all queued jobs are done.
 * 7. Safe Boundary Pause:
 *    - Transitions running -> pausing -> paused at clean step/job boundary.
 * 8. 3-Way Dynamic CTA Dispatch:
 *    - retry: reuses frozen snapshot, resumes from failed step.
 *    - regenerate: computes diff, calculates earliestInvalidatedStep, resets downstream, freezes new snapshot.
 *    - reexport: 0 AI calls, transcodes/exports existing artifacts to new directory/format.
 * 9. Input Mutation Safety:
 *    - Checks size & mtime on disk before execution; if changed, marks warning and restarts pipeline.
 * 10. History Integration:
 *    - Automatically records terminal jobs to history.json (Job-Centric Grouping).
 */

import {
  BatchJob,
  BatchQueueStatus,
  BatchTaskType,
  BatchStepResult,
  BatchTaskConfigMap,
} from "../../types/batch";
import {
  resolveJobOwnedEffectiveConfig,
  getDefaultTaskConfigMap,
  getJobWorkingConfig,
} from "./configSnapshotResolver";
import { computeJobConfigDiff } from "./configDiffResolver";
import {
  checkInputFileMutation,
  applyInputMutationToJob,
} from "./invalidationGraph";
import { saveBatchQueueState } from "./batchStorage";
import { syncBatchJobToHistory } from "../history/historyManager";
import { OutputResolver } from "./outputResolver";
import { exportSubtitleFile } from "../subtitle/exporter";
import { parseSubtitle } from "../subtitle/parser";
import { TtsExecutor } from "./executors/ttsExecutor";
import { DialogueExecutor } from "./executors/dialogueExecutor";
import { TranscriptionExecutor } from "./executors/transcriptionExecutor";
import { TranslationExecutor } from "./executors/translationExecutor";
import { DubbingExecutor } from "./executors/dubbingExecutor";
import type { LocalAiServices } from "../ai/localAiServices";

export type OrchestratorListener = (jobs: BatchJob[], queueStatus: BatchQueueStatus) => void;

/** Returns the user-facing queue-block message for disk-full / permission errors, else null (AC-13). */
export function classifyDiskBlockError(message: string | undefined): string | null {
  if (!message) return null;
  const lower = message.toLowerCase();
  if (message.includes("ENOSPC") || lower.includes("no space left") || lower.includes("errno 28")) {
    return "Không đủ dung lượng lưu trữ.";
  }
  if (message.includes("EACCES") || lower.includes("permission denied") || lower.includes("errno 13")) {
    return "Không có quyền ghi vào thư mục đích.";
  }
  return null;
}

export interface BatchOrchestratorConfig {
  globalDefaults?: BatchTaskConfigMap;
  fileReader?: (path: string) => Promise<string>;
  fileWriter?: (path: string, content: Uint8Array | string) => Promise<void>;
  pathExists?: (path: string) => boolean;
  fileStatsReader?: (path: string) => Promise<{ size: number; mtime: number } | null>;
}

export class BatchOrchestrator {
  private static instance: BatchOrchestrator;

  private jobs: BatchJob[] = [];
  private queueStatus: BatchQueueStatus = "idle";
  private activeJobId: string | null = null;
  private cancelRequested = false;
  private pauseRequested = false;
  private listeners = new Set<OrchestratorListener>();
  private globalDefaults: BatchTaskConfigMap = getDefaultTaskConfigMap();

  // Injectable file I/O for tests and runtime
  public fileReader?: (path: string) => Promise<string>;
  public fileWriter?: (path: string, content: Uint8Array | string) => Promise<void>;
  public pathExists?: (path: string) => boolean;
  public fileStatsReader?: (path: string) => Promise<{ size: number; mtime: number } | null>;
  /** Real local AI runtime (Python sidecar via Tauri IPC). Executors fail explicitly without it. */
  public ai?: LocalAiServices;
  /** Optional hook run before every step (e.g. refresh output-folder existence snapshot). */
  public beforeStep?: (job: BatchJob) => Promise<void>;

  private constructor() {}

  static getInstance(): BatchOrchestrator {
    if (!BatchOrchestrator.instance) {
      BatchOrchestrator.instance = new BatchOrchestrator();
    }
    return BatchOrchestrator.instance;
  }

  /**
   * Subscribes to orchestrator state changes.
   */
  subscribe(listener: OrchestratorListener): () => void {
    this.listeners.add(listener);
    listener([...this.jobs], this.queueStatus);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const jobsCopy = this.jobs.map((j) => ({ ...j }));
    for (const listener of this.listeners) {
      try {
        listener(jobsCopy, this.queueStatus);
      } catch (err) {
        console.error("Orchestrator listener error:", err);
      }
    }
  }

  /**
   * Gets current jobs copy.
   */
  getJobs(): BatchJob[] {
    return [...this.jobs];
  }

  /**
   * Gets current queue status.
   */
  getQueueStatus(): BatchQueueStatus {
    return this.queueStatus;
  }

  /**
   * Initializes or replaces the jobs list.
   */
  setJobs(jobs: BatchJob[]): void {
    this.jobs = [...jobs];
    this.notify();
  }

  /**
   * Updates global defaults template.
   */
  setGlobalDefaults(defaults: BatchTaskConfigMap): void {
    this.globalDefaults = { ...defaults };
  }

  /**
   * Gets current global defaults template.
   */
  getGlobalDefaults(): BatchTaskConfigMap {
    return { ...this.globalDefaults };
  }

  /**
   * Reorders a waiting job within the queue (AC-24: Arrow Reorder).
   * Processing job stays pinned at top; only waiting jobs are reordered.
   */
  moveWaitingJob(jobId: string, direction: "up" | "down"): boolean {
    const queuedWaitingJobs = this.jobs
      .filter((j) => j.stage === "queued" && j.status === "waiting")
      .sort((a, b) => a.queueOrder - b.queueOrder);

    const targetIdx = queuedWaitingJobs.findIndex((j) => j.id === jobId);
    if (targetIdx === -1) return false;

    if (direction === "up" && targetIdx > 0) {
      const prevJob = queuedWaitingJobs[targetIdx - 1];
      const currJob = queuedWaitingJobs[targetIdx];
      const tempOrder = prevJob.queueOrder;
      prevJob.queueOrder = currJob.queueOrder;
      currJob.queueOrder = tempOrder;
      this.notify();
      return true;
    }

    if (direction === "down" && targetIdx < queuedWaitingJobs.length - 1) {
      const nextJob = queuedWaitingJobs[targetIdx + 1];
      const currJob = queuedWaitingJobs[targetIdx];
      const tempOrder = nextJob.queueOrder;
      nextJob.queueOrder = currJob.queueOrder;
      currJob.queueOrder = tempOrder;
      this.notify();
      return true;
    }

    return false;
  }

  /**
   * Starts processing the queue (Natural Queue Loop).
   */
  async startQueue(): Promise<void> {
    if (this.queueStatus === "running" || this.queueStatus === "blocked") {
      return;
    }

    this.queueStatus = "running";
    this.cancelRequested = false;
    this.pauseRequested = false;
    this.notify();

    while (this.queueStatus === "running" || this.queueStatus === "pausing") {
      if (this.pauseRequested) {
        this.queueStatus = "paused";
        this.pauseRequested = false;
        this.notify();
        break;
      }

      if (this.cancelRequested) {
        this.queueStatus = "idle";
        this.cancelRequested = false;
        this.notify();
        break;
      }

      // Next job: lowest queueOrder among queued waiting jobs
      const nextJob = this.getNextWaitingJob();
      if (!nextJob) {
        // Natural Queue Completion (AC-24)
        this.queueStatus = "idle";
        this.notify();
        break;
      }

      await this.processJob(nextJob);
      await this.persistState();
    }
  }

  /**
   * Resumes the paused queue.
   */
  resumeQueue(): void {
    if (this.queueStatus === "paused") {
      this.startQueue();
    }
  }

  /**
   * Finds the next waiting job in the queue respecting queueOrder.
   */
  private getNextWaitingJob(): BatchJob | undefined {
    const waitingJobs = this.jobs
      .filter((j) => j.stage === "queued" && j.status === "waiting")
      .sort((a, b) => a.queueOrder - b.queueOrder);

    return waitingJobs[0];
  }

  /**
   * Requests safe boundary pause.
   */
  requestPause(): void {
    if (this.queueStatus === "running") {
      this.queueStatus = "pausing";
      this.pauseRequested = true;
      this.notify();
    }
  }

  /**
   * Requests cancel for active job and queue.
   */
  requestCancel(): void {
    this.cancelRequested = true;
    if (this.activeJobId) {
      const activeJob = this.jobs.find((j) => j.id === this.activeJobId);
      if (activeJob) {
        activeJob.isCancelling = true;
      }
      // Abort in-flight local inference so cancel does not wait for a long synth/ASR call.
      this.ai?.cancelActive().catch((err) => {
        console.warn("Không thể hủy tác vụ AI đang chạy:", err);
      });
    }
    this.notify();
  }

  /**
   * Processes a single job sequentially through its executionSequence.
   */
  async processJob(job: BatchJob): Promise<void> {
    this.activeJobId = job.id;

    // Check Input Mutation Safety before execution (AC-30)
    if (this.fileStatsReader && job.sourceFilePath) {
      try {
        const stats = await this.fileStatsReader(job.sourceFilePath);
        if (stats) {
          const mutation = checkInputFileMutation(job, stats.size, stats.mtime);
          if (mutation.mutated) {
            applyInputMutationToJob(job, stats.size, stats.mtime);
          }
        }
      } catch (statErr) {
        console.warn("Could not read file stats for mutation check:", statErr);
      }
    }

    // 1. Lazy Snapshot Freeze (AC-14)
    // Snapshot is resolved and frozen ONLY right before processing
    if (!job.effectiveConfigSnapshot) {
      job.effectiveConfigSnapshot = resolveJobOwnedEffectiveConfig(job);
    }

    job.status = "processing";
    job.startedAt = Date.now();
    job.progressPct = 0;
    this.notify();

    let hasAnyWarning = false;
    let failedStepTask: BatchTaskType | null = null;
    let stepErrorMsg = "";

    // In-memory artifact handoff between steps
    let lastSubtitleContent = "";
    const accumulatedArtifactPaths: string[] = [];

    // Determine start step if resuming from partial retry
    const startIndex = job.retryFromStep
      ? Math.max(0, job.executionSequence.indexOf(job.retryFromStep))
      : 0;

    // Retain previous completed artifacts up to startIndex
    for (let i = 0; i < startIndex; i++) {
      const priorTask = job.executionSequence[i];
      const priorStep = job.stepResults[priorTask];
      if (priorStep && priorStep.outputArtifactPaths) {
        accumulatedArtifactPaths.push(...priorStep.outputArtifactPaths);
        const sub = priorStep.outputArtifactPaths.find(
          (p) => p.endsWith(".srt") || p.endsWith(".vtt")
        );
        if (sub && this.fileReader) {
          try {
            lastSubtitleContent = await this.fileReader(sub);
          } catch {
            // ignore
          }
        }
      }
    }

    // Step Execution Loop
    for (let sIdx = startIndex; sIdx < job.executionSequence.length; sIdx++) {
      if (this.cancelRequested) {
        job.status = "cancelled";
        job.isCancelling = false;
        job.progressPct = 0;
        this.activeJobId = null;
        this.notify();
        return;
      }

      const task = job.executionSequence[sIdx];
      job.currentStepIndex = sIdx;
      job.stepResults[task] = {
        task,
        status: "processing",
        progressPct: 0,
        outputArtifactPaths: [],
        startedAt: Date.now(),
      };
      this.notify();

      let stepResult: BatchStepResult;

      try {
        stepResult = await this.dispatchStep(job, task, {
          lastSubtitleContent,
          onProgress: (pct, msg) => {
            const currentStep = job.stepResults[task];
            if (currentStep) {
              currentStep.progressPct = pct;
              currentStep.stageMessage = msg;
            }
            const overallPct = Math.floor(
              (sIdx / job.executionSequence.length) * 100 +
                pct / job.executionSequence.length
            );
            job.progressPct = Math.min(99, overallPct);
            this.notify();
          },
          isCancelled: () => this.cancelRequested,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        stepResult = {
          task,
          status: "failed",
          progressPct: 0,
          outputArtifactPaths: [],
          error: msg,
          completedAt: Date.now(),
        };
      }

      // Emergency Disk Block detection (ENOSPC / EACCES - AC-13).
      // Applies to thrown errors and to failed results (the sidecar reports
      // OS write errors such as "[Errno 28] No space left on device").
      const diskBlockMessage =
        stepResult.status === "failed" ? classifyDiskBlockError(stepResult.error) : null;
      if (diskBlockMessage) {
        job.stepResults[task] = stepResult;
        this.queueStatus = "blocked";
        job.status = "failed";
        job.errorMessage = diskBlockMessage;
        job.completedAt = Date.now();
        this.activeJobId = null;
        this.notify();
        return;
      }

      // Record step result
      job.stepResults[task] = stepResult;

      if (stepResult.outputArtifactPaths && stepResult.outputArtifactPaths.length > 0) {
        accumulatedArtifactPaths.push(...stepResult.outputArtifactPaths);
      }

      // Capture subtitle for next step if produced
      if (stepResult.outputArtifactPaths) {
        const subPath = stepResult.outputArtifactPaths.find(
          (p) => p.endsWith(".srt") || p.endsWith(".vtt")
        );
        if (subPath && this.fileReader) {
          try {
            lastSubtitleContent = await this.fileReader(subPath);
          } catch {
            // Ignore subtitle reading error
          }
        }
      }

      // Warnings
      if (stepResult.status === "completed_with_warning") {
        hasAnyWarning = true;
        if (stepResult.warning) {
          job.warningMessage = stepResult.warning;
        }
      }

      if (stepResult.status === "failed") {
        failedStepTask = task;
        stepErrorMsg = stepResult.error || "Lỗi thực thi bước.";
        break; // Stop further steps for this job
      }
    }

    job.completedAt = Date.now();
    job.artifacts.ownedArtifactPaths = Array.from(new Set(accumulatedArtifactPaths));

    // Terminal Status Assignment (AC-11, AC-12, AC-25)
    if (failedStepTask) {
      job.errorMessage = stepErrorMsg;
      if (accumulatedArtifactPaths.length > 0) {
        // Step failed after prior steps successfully committed artifacts
        job.status = "failed_with_artifact";
        job.retryFromStep = failedStepTask;
      } else {
        job.status = "failed";
      }
      job.progressPct = Math.floor((job.currentStepIndex / job.executionSequence.length) * 100);
    } else if (hasAnyWarning) {
      job.status = "completed_with_warning";
      job.progressPct = 100;
    } else {
      job.status = "completed";
      job.progressPct = 100;
    }

    // Record to history if terminal state reached (AC-11, AC-27)
    if (
      job.status === "completed" ||
      job.status === "completed_with_warning" ||
      job.status === "failed_with_artifact"
    ) {
      try {
        syncBatchJobToHistory(job);
      } catch (histErr) {
        console.warn("Could not sync job to history:", histErr);
      }
    }

    this.activeJobId = null;
    this.notify();
  }

  /**
   * 3-Way CTA: Retry (AC-26)
   * Reuses the previous frozen snapshot, resumes execution strictly from retryFromStep.
   */
  retryJob(jobId: string): boolean {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return false;

    job.status = "waiting";
    job.stage = "queued";
    job.progressPct = 0;
    job.errorMessage = undefined;

    // Reset failed step to waiting while preserving earlier completed steps
    if (job.retryFromStep && job.stepResults[job.retryFromStep]) {
      job.stepResults[job.retryFromStep]!.status = "waiting";
      job.stepResults[job.retryFromStep]!.progressPct = 0;
      job.stepResults[job.retryFromStep]!.error = undefined;
    }

    // Assign next queueOrder
    const maxOrder = Math.max(
      0,
      ...this.jobs.filter((j) => j.stage === "queued").map((j) => j.queueOrder)
    );
    job.queueOrder = maxOrder + 1;

    this.notify();
    return true;
  }

  /**
   * 3-Way CTA: Regenerate (AC-26)
   * Computes config diff, determines earliestInvalidatedStep, resets downstream steps,
   * freezes fresh effective snapshot, re-enqueues job.
   */
  regenerateJob(jobId: string): boolean {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return false;

    const workingConfig = getJobWorkingConfig(job);
    const diff = computeJobConfigDiff(job, workingConfig);
    const earliest = diff.invalidatedFromStep || job.executionSequence[0];

    // Freeze fresh snapshot
    job.effectiveConfigSnapshot = workingConfig;
    job.retryFromStep = earliest;
    job.status = "waiting";
    job.stage = "queued";
    job.progressPct = 0;
    job.errorMessage = undefined;

    // Reset steps from earliest onwards
    const earliestIdx = job.executionSequence.indexOf(earliest);
    for (let i = 0; i < job.executionSequence.length; i++) {
      const task = job.executionSequence[i];
      if (i >= earliestIdx) {
        job.stepResults[task] = {
          task,
          status: "waiting",
          progressPct: 0,
          outputArtifactPaths: [],
        };
      }
    }

    const maxOrder = Math.max(
      0,
      ...this.jobs.filter((j) => j.stage === "queued").map((j) => j.queueOrder)
    );
    job.queueOrder = maxOrder + 1;

    this.notify();
    return true;
  }

  /**
   * 3-Way CTA: Re-export (AC-26)
   * When only output config changed:
   * 0 AI calls: Transcodes audio and/or copies subtitle to new output path/format.
   */
  async reexportJob(jobId: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return false;

    const outputFormat = job.outputSnapshot.outputAudioFormat || "wav";
    const subFormat = job.outputSnapshot.outputSubtitleFormat || "srt";
    const newArtifactPaths: string[] = [];

    for (const artPath of job.artifacts.ownedArtifactPaths) {
      if (artPath.endsWith(".wav") || artPath.endsWith(".mp3")) {
        const destAudio = OutputResolver.resolveOutputPath(
          job.sourceFilePath,
          job.outputSnapshot,
          outputFormat,
          (p) => (this.pathExists ? this.pathExists(p) : false)
        );
        if (!this.ai) {
          throw new Error("Không có local audio runtime: không thể chuyển mã âm thanh khi xuất lại.");
        }
        await this.ai.assemble({
          inputs: [{ path: artPath }],
          outputPath: destAudio,
          format: outputFormat === "mp3" ? "mp3" : "wav",
          mode: "sequential",
        });
        newArtifactPaths.push(destAudio);
        job.artifacts.primaryPath = destAudio;
      } else if (artPath.endsWith(".srt") || artPath.endsWith(".vtt")) {
        const destSub = OutputResolver.resolveOutputPath(
          job.sourceFilePath,
          job.outputSnapshot,
          subFormat,
          (p) => (this.pathExists ? this.pathExists(p) : false)
        );
        let content = "";
        if (this.fileReader) {
          content = await this.fileReader(artPath);
        }
        if (content) {
          const cues = parseSubtitle(content);
          await exportSubtitleFile(cues, destSub, subFormat, {
            fileWriter: this.fileWriter,
          });
          newArtifactPaths.push(destSub);
          job.artifacts.secondaryPath = destSub;
        }
      }
    }

    job.artifacts.ownedArtifactPaths = Array.from(
      new Set([...job.artifacts.ownedArtifactPaths, ...newArtifactPaths])
    );
    job.status = "completed";
    syncBatchJobToHistory(job);
    this.notify();
    return true;
  }

  /**
   * Dispatches execution to the corresponding Step Executor.
   */
  private async dispatchStep(
    job: BatchJob,
    task: BatchTaskType,
    context: {
      lastSubtitleContent: string;
      onProgress: (pct: number, msg?: string) => void;
      isCancelled: () => boolean;
    }
  ): Promise<BatchStepResult> {
    const { lastSubtitleContent, onProgress, isCancelled } = context;
    const ai = this.ai;

    // Refresh the existence snapshot of the output folder so collision
    // policy decisions see files created by earlier steps / other apps.
    if (this.beforeStep) {
      await this.beforeStep(job);
    }

    const readSource = async (): Promise<string> => {
      if (!this.fileReader) {
        throw new Error("Không có bộ đọc tệp: không thể đọc tệp nguồn của tác vụ.");
      }
      const content = await this.fileReader(job.sourceFilePath);
      if (!content || !content.trim()) {
        throw new Error(`Tệp nguồn rỗng hoặc không đọc được: ${job.sourceFileName}`);
      }
      return content;
    };

    // Subtitle input: upstream artifact first, otherwise an imported .srt/.vtt source.
    const resolveSubtitleInput = async (): Promise<string> => {
      if (lastSubtitleContent.trim()) return lastSubtitleContent;
      if (/\.(srt|vtt)$/i.test(job.sourceFilePath)) return await readSource();
      return "";
    };

    switch (task) {
      case "tts": {
        return await TtsExecutor.execute(job, {
          textContent: await readSource(),
          onProgress,
          isCancelled,
          writeFile: this.fileWriter,
          checkPathExists: this.pathExists,
          ai,
        });
      }

      case "dialogue": {
        return await DialogueExecutor.execute(job, {
          scriptContent: await readSource(),
          onProgress,
          isCancelled,
          writeFile: this.fileWriter,
          checkPathExists: this.pathExists,
          ai,
        });
      }

      case "transcription": {
        return await TranscriptionExecutor.execute(job, {
          audioFilePath: job.sourceFilePath,
          onProgress,
          isCancelled,
          writeFile: this.fileWriter,
          checkPathExists: this.pathExists,
          ai,
        });
      }

      case "translation": {
        return await TranslationExecutor.execute(job, {
          subtitleContent: await resolveSubtitleInput(),
          onProgress,
          isCancelled,
          writeFile: this.fileWriter,
          checkPathExists: this.pathExists,
        });
      }

      case "dubbing": {
        return await DubbingExecutor.execute(job, {
          subtitleContent: await resolveSubtitleInput(),
          onProgress,
          isCancelled,
          writeFile: this.fileWriter,
          checkPathExists: this.pathExists,
          ai,
        });
      }

      default:
        throw new Error(`Tác vụ không xác định: ${task}`);
    }
  }

  /**
   * Persists queue state using BatchStorage.
   */
  private async persistState(): Promise<void> {
    try {
      await saveBatchQueueState(this.jobs, this.queueStatus);
    } catch (err) {
      console.warn("Lỗi lưu trạng thái hàng đợi vào bộ nhớ bền vững:", err);
    }
  }

  /**
   * Reset helper for automated testing.
   */
  _resetForTest(): void {
    this.jobs = [];
    this.queueStatus = "idle";
    this.activeJobId = null;
    this.cancelRequested = false;
    this.pauseRequested = false;
    this.listeners.clear();
    this.ai = undefined;
    this.beforeStep = undefined;
  }
}

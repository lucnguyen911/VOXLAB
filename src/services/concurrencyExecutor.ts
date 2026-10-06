/**
 * VOXLAB CONCURRENCY EXECUTOR
 * Controls batch rendering concurrency:
 * 1x -> concurrency = 1 (Sequential)
 * 2x -> concurrency = 2 (Fast)
 * 3x -> concurrency = 3 (High performance)
 * 4x -> concurrency = 4 (Maximum)
 *
 * Fully supports Pause, Resume, Cancel, and Error Retry/Skip without data loss.
 */

export interface ConcurrencyRunTelemetry {
  concurrencyLevel: number;
  maxObservedActive: number;
  activeHistory: number[];
  itemCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount?: number;
  cancelledCount: number;
  startTime: number;
  endTime?: number;
}

export interface RunBatchOptions<T> {
  concurrency: number;
  processItem: (item: T, index: number) => Promise<void>;
  onWorkerChange?: (activeCount: number, pendingCount?: number) => void;
  onItemCompleted?: (item: T, index: number, completedCount: number, totalCount: number) => void;
  onItemFailed?: (item: T, index: number, error: any) => Promise<"retry" | "skip" | "cancel"> | "retry" | "skip" | "cancel" | void;
  onStateChange?: (state: "running" | "paused" | "completed" | "cancelled" | "error") => void;
}

export class BatchConcurrencyQueue {
  private activeWorkers = 0;
  private maxObserved = 0;
  private pendingCount = 0;
  private activeHistory: number[] = [];
  private isCancelled = false;
  private isPaused = false;
  private pauseResolvers: Array<() => void> = [];
  private status: "idle" | "running" | "paused" | "completed" | "cancelled" | "error" = "idle";

  getStatus(): "idle" | "running" | "paused" | "completed" | "cancelled" | "error" {
    return this.status;
  }

  getPendingCount(): number {
    return this.pendingCount;
  }

  isQueuePaused(): boolean {
    return this.isPaused;
  }

  isQueueCancelled(): boolean {
    return this.isCancelled;
  }

  pause(): void {
    if (this.status !== "running") return;
    this.isPaused = true;
    this.status = "paused";
  }

  resume(): void {
    if (!this.isPaused || this.isCancelled) return;
    this.isPaused = false;
    this.status = "running";
    while (this.pauseResolvers.length > 0) {
      const resolve = this.pauseResolvers.shift();
      resolve?.();
    }
  }

  cancel(): void {
    this.isCancelled = true;
    this.isPaused = false;
    this.status = "cancelled";
    while (this.pauseResolvers.length > 0) {
      const resolve = this.pauseResolvers.shift();
      resolve?.();
    }
  }

  reset(): void {
    this.activeWorkers = 0;
    this.maxObserved = 0;
    this.pendingCount = 0;
    this.activeHistory = [];
    this.isCancelled = false;
    this.isPaused = false;
    this.pauseResolvers = [];
    this.status = "idle";
  }

  private async waitIfPaused(): Promise<void> {
    if (!this.isPaused || this.isCancelled) return;
    await new Promise<void>((resolve) => {
      this.pauseResolvers.push(resolve);
    });
  }

  /**
   * Runs batch processing with concurrency control, pause/resume, and cancellation.
   */
  async runBatch<T>(
    items: T[],
    concurrencyOrOptions: number | RunBatchOptions<T>,
    processItemLegacy?: (item: T, index: number) => Promise<void>,
    onWorkerChangeLegacy?: (activeCount: number) => void
  ): Promise<ConcurrencyRunTelemetry> {
    let concurrency: number;
    let processItem: (item: T, index: number) => Promise<void>;
    let onWorkerChange: ((activeCount: number, pendingCount?: number) => void) | undefined;
    let onItemCompleted: ((item: T, index: number, completedCount: number, totalCount: number) => void) | undefined;
    let onItemFailed: ((item: T, index: number, error: any) => Promise<"retry" | "skip" | "cancel"> | "retry" | "skip" | "cancel" | void) | undefined;
    let onStateChange: ((state: "running" | "paused" | "completed" | "cancelled" | "error") => void) | undefined;

    if (typeof concurrencyOrOptions === "number") {
      concurrency = concurrencyOrOptions;
      processItem = processItemLegacy!;
      onWorkerChange = onWorkerChangeLegacy;
    } else {
      concurrency = concurrencyOrOptions.concurrency;
      processItem = concurrencyOrOptions.processItem;
      onWorkerChange = concurrencyOrOptions.onWorkerChange;
      onItemCompleted = concurrencyOrOptions.onItemCompleted;
      onItemFailed = concurrencyOrOptions.onItemFailed;
      onStateChange = concurrencyOrOptions.onStateChange;
    }

    const safeConcurrency = Math.max(1, Math.min(4, Math.floor(concurrency)));
    this.activeWorkers = 0;
    this.maxObserved = 0;
    this.pendingCount = items.length;
    this.activeHistory = [];
    this.isCancelled = false;
    this.isPaused = false;
    this.pauseResolvers = [];
    this.status = "running";
    onStateChange?.("running");

    const completedIndices = new Set<number>();
    const failedIndices = new Set<number>();
    const skippedIndices = new Set<number>();
    const startTime = Date.now();

    const queue = items.map((item, index) => ({ item, index }));

    const worker = async () => {
      while (queue.length > 0 && !this.isCancelled) {
        // If paused, wait before popping the next item from the queue
        while (this.isPaused && !this.isCancelled) {
          await this.waitIfPaused();
        }
        if (this.isCancelled) break;

        const next = queue.shift();
        if (!next) break;

        this.pendingCount = queue.length;
        this.activeWorkers++;
        if (this.activeWorkers > this.maxObserved) {
          this.maxObserved = this.activeWorkers;
        }
        this.activeHistory.push(this.activeWorkers);
        onWorkerChange?.(this.activeWorkers, this.pendingCount);

        let success = false;
        let attempts = 0;
        const maxAttempts = 3;

        while (!success && attempts < maxAttempts && !this.isCancelled) {
          attempts++;
          try {
            await processItem(next.item, next.index);
            success = true;
            if (!this.isCancelled) {
              completedIndices.add(next.index);
              const curCompleted = Math.min(items.length, completedIndices.size);
              onItemCompleted?.(next.item, next.index, curCompleted, items.length);
            }
          } catch (err) {
            console.error(`Queue item ${next.index} error:`, err);
            if (this.isCancelled) break;
            if (onItemFailed) {
              const action = await onItemFailed(next.item, next.index, err);
              if (action === "retry") {
                continue; // retry this same item
              } else if (action === "cancel") {
                this.cancel();
                failedIndices.add(next.index);
                break;
              } else {
                // "skip" or void
                skippedIndices.add(next.index);
                break;
              }
            } else {
              failedIndices.add(next.index);
              break;
            }
          }
        }

        this.activeWorkers--;
        this.activeHistory.push(this.activeWorkers);
        onWorkerChange?.(this.activeWorkers, this.pendingCount);
      }
    };

    const workerCount = Math.min(safeConcurrency, items.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
    this.pendingCount = 0;

    const completedCount = completedIndices.size;
    const failedCount = failedIndices.size;
    const skippedCount = skippedIndices.size;

    if (this.isCancelled) {
      this.status = "cancelled";
      onStateChange?.("cancelled");
    } else if (failedCount > 0 && completedCount + failedCount + skippedCount >= items.length) {
      this.status = "error";
      onStateChange?.("error");
    } else {
      this.status = "completed";
      onStateChange?.("completed");
    }

    const telemetry: ConcurrencyRunTelemetry = {
      concurrencyLevel: safeConcurrency,
      maxObservedActive: this.maxObserved,
      activeHistory: this.activeHistory,
      itemCount: items.length,
      completedCount,
      failedCount,
      skippedCount,
      cancelledCount: Math.max(0, items.length - completedCount - failedCount - skippedCount),
      startTime,
      endTime: Date.now(),
    };

    if (typeof window !== "undefined") {
      (window as any).__VOXLAB_LAST_CONCURRENCY_TELEMETRY__ = telemetry;
    }

    return telemetry;
  }

  getActiveWorkers() {
    return this.activeWorkers;
  }

  getMaxObserved() {
    return this.maxObserved;
  }
}

export const batchQueueExecutor = new BatchConcurrencyQueue();

// Expose on window for runtime verification
if (typeof window !== "undefined") {
  (window as any).__VOXLAB_CONCURRENCY_EXECUTOR__ = batchQueueExecutor;
}

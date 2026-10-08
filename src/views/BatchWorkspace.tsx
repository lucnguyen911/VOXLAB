import React, { useState, useEffect, useMemo, useRef } from "react";
import { Eye, CheckCircle2 } from "lucide-react";
import {
  BatchJob,
  BatchWorkspaceView,
  BatchQueueStatus,
  BatchTaskType,
  ConfigDiffResult,
} from "../types/batch";
import { BatchOrchestrator } from "../services/batch/batchOrchestrator";
import { loadBatchState } from "../services/batch/batchStorage";
import { getFileCompatibilityReport, checkTaskCompatibility } from "../services/batch/compatibilityDetector";
import { validateDialogueScript } from "../services/batch/dialogueValidator";
import { computeExecutionSequence } from "../services/batch/dependencyResolver";
import { computeJobConfigDiff } from "../services/batch/configDiffResolver";
import { getJobWorkingConfig, getDefaultOutputSnapshot } from "../services/batch/configSnapshotResolver";
import { BatchTopBar } from "./batch/BatchTopBar";
import { BatchSubToolbar } from "./batch/BatchSubToolbar";
import { FileTaskMatrixTable } from "./batch/FileTaskMatrixTable";
import { QueueReorderTable } from "./batch/QueueReorderTable";
import { FailedJobsTable } from "./batch/FailedJobsTable";
import { PerFileConfigDrawer } from "./batch/PerFileConfigDrawer";
import { GlobalDefaultsModal } from "./batch/GlobalDefaultsModal";
import { BatchArtifactPreviewModal } from "./batch/BatchArtifactPreviewModal";
import { BatchFooter } from "../components/batch/BatchFooter";
import { initBatchRuntime, tauriAiFs, getDefaultBatchOutputDir } from "../services/batch/batchRuntime";
import { isTauriRuntime } from "../services/ai/tauriBackend";

/** A file to stage. In the desktop runtime `path` is absolute; in browser preview it is only the name. */
interface IncomingFile {
  path: string;
  name: string;
  size: number;
  mtime: number;
  /** Text content (text files only) so dialogue detection inspects the script, not the file name. */
  textContent?: string;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

export const BatchWorkspace: React.FC = () => {
  const orchestrator = useMemo(() => BatchOrchestrator.getInstance(), []);

  // Orchestrator State
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [queueStatus, setQueueStatus] = useState<BatchQueueStatus>("idle");
  const [activeView, setActiveView] = useState<BatchWorkspaceView>("list");

  // Selection & Search
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // Modals & Drawers
  const [isGlobalModalOpen, setIsGlobalModalOpen] = useState(false);
  const [drawerJob, setDrawerJob] = useState<BatchJob | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<{
    path: string;
    fileName: string;
    content?: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Subscribe to orchestrator
  useEffect(() => {
    // Wire the real desktop runtime first (Tauri fs + local AI sidecar), then restore the durable queue.
    initBatchRuntime()
      .catch((err) => console.error("Không thể khởi tạo local AI runtime:", err))
      .then(() => loadBatchState())
      .then((state) => {
        orchestrator.setJobs(state.jobs);
      });

    const unsubscribe = orchestrator.subscribe((updatedJobs, qStatus) => {
      setJobs(updatedJobs);
      setQueueStatus(qStatus);
    });

    return () => unsubscribe();
  }, [orchestrator]);

  // Filtered jobs for current view & search query
  const viewJobs = useMemo(() => {
    let list: BatchJob[] = [];
    switch (activeView) {
      case "list":
        list = jobs.filter((j) => j.stage === "staging");
        break;
      case "queued":
        list = jobs.filter((j) => j.stage === "queued" && (j.status === "waiting" || j.status === "processing" || j.status === "paused"));
        break;
      case "completed":
        list = jobs.filter((j) => j.status === "completed" || j.status === "completed_with_warning");
        break;
      case "failed":
        list = jobs.filter((j) => j.status === "failed" || j.status === "failed_with_artifact" || j.status === "cancelled" || j.status === "interrupted");
        break;
    }

    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((j) => j.sourceFileName.toLowerCase().includes(q));
  }, [jobs, activeView, searchQuery]);

  // View Counts
  const viewCounts = useMemo(() => {
    return {
      list: jobs.filter((j) => j.stage === "staging").length,
      queued: jobs.filter((j) => j.stage === "queued" && (j.status === "waiting" || j.status === "processing" || j.status === "paused")).length,
      completed: jobs.filter((j) => j.status === "completed" || j.status === "completed_with_warning").length,
      failed: jobs.filter((j) => j.status === "failed" || j.status === "failed_with_artifact" || j.status === "cancelled" || j.status === "interrupted").length,
      processing: jobs.filter((j) => j.status === "processing").length,
    };
  }, [jobs]);

  // Row selection helpers
  const handleToggleSelectRow = (jobId: string) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    const visibleIds = viewJobs.map((j) => j.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedJobIds.has(id));

    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const isAllSelected = viewJobs.length > 0 && viewJobs.every((j) => selectedJobIds.has(j.id));
  const isIndeterminate = viewJobs.some((j) => selectedJobIds.has(j.id)) && !isAllSelected;

  // Add files
  const handleAddFiles = (fileList: IncomingFile[]) => {
    const newJobs: BatchJob[] = [];

    fileList.forEach((file, index) => {
      const compat = getFileCompatibilityReport(file.name);
      const isDialogueValid =
        compat.fileKind === "text"
          ? validateDialogueScript(file.textContent ?? file.name).isDialogueScript
          : false;

      let defaultTasks: BatchTaskType[] = [];
      if (compat.fileKind === "text") {
        defaultTasks = isDialogueValid ? ["dialogue"] : ["tts"];
      } else if (compat.fileKind === "media") {
        defaultTasks = ["transcription"];
      } else if (compat.fileKind === "subtitle") {
        defaultTasks = ["translation"];
      }

      const seq = computeExecutionSequence(defaultTasks, compat.fileKind);

      const job: BatchJob = {
        id: `job-${Date.now()}-${index}`,
        sourceFilePath: file.path,
        sourceFileName: file.name,
        sourceFileSize: file.size,
        sourceFileMtime: file.mtime || Date.now(),
        fileKind: compat.fileKind,
        stage: "staging",
        queueOrder: jobs.length + index + 1,
        selectedTasks: defaultTasks,
        executionSequence: seq,
        currentStepIndex: 0,
        configOverrides: {},
        hasCustomConfig: false,
        stepResults: {},
        status: "waiting",
        progressPct: 0,
        outputSnapshot: {
          ...getDefaultOutputSnapshot(),
          // Desktop runtime needs an absolute folder; browser preview keeps the template value.
          resolvedOutputDirectory:
            getDefaultOutputSnapshot().resolvedOutputDirectory || getDefaultBatchOutputDir(),
        },
        artifacts: { ownedArtifactPaths: [] },
        createdAt: Date.now(),
      };

      newJobs.push(job);
    });

    const updated = [...jobs, ...newJobs];
    orchestrator.setJobs(updated);
  };

  // Desktop runtime: native picker gives absolute paths the sidecar can read.
  const handleUploadClick = async () => {
    if (!isTauriRuntime()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: true,
        filters: [
          { name: "VoxLab", extensions: ["txt", "srt", "vtt", "mp3", "wav", "m4a", "flac", "ogg", "mp4", "mkv", "mov", "webm"] },
        ],
      });
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
      const { invoke } = await import("@tauri-apps/api/core");
      const incoming = await Promise.all(
        paths.map(async (p): Promise<IncomingFile> => {
          const st = await invoke<{ size: number; mtimeMs: number } | null>("fs_stat", { path: p });
          const isText = /\.txt$/i.test(p);
          return {
            path: p,
            name: baseName(p),
            size: st?.size ?? 0,
            mtime: st?.mtimeMs ?? Date.now(),
            textContent: isText ? await tauriAiFs.readText(p).catch(() => undefined) : undefined,
          };
        })
      );
      if (incoming.length > 0) handleAddFiles(incoming);
    } catch (err) {
      console.error("Không thể mở hộp thoại chọn tệp:", err);
    }
  };

  // Toggle tasks
  const handleToggleJobTask = (jobId: string, task: BatchTaskType) => {
    const updated = jobs.map((job) => {
      if (job.id !== jobId) return job;

      const hasTask = job.selectedTasks.includes(task);
      let nextTasks: BatchTaskType[];

      if (hasTask) {
        nextTasks = job.selectedTasks.filter((t) => t !== task);
      } else {
        // Enforce mutually exclusive TTS vs Dialogue
        if (task === "tts") {
          nextTasks = [...job.selectedTasks.filter((t) => t !== "dialogue"), "tts"];
        } else if (task === "dialogue") {
          nextTasks = [...job.selectedTasks.filter((t) => t !== "tts"), "dialogue"];
        } else {
          nextTasks = [...job.selectedTasks, task];
        }
      }

      const seq = computeExecutionSequence(nextTasks, job.fileKind);
      return {
        ...job,
        selectedTasks: nextTasks,
        executionSequence: seq,
      };
    });

    orchestrator.setJobs(updated);
  };

  const handleToggleAllColumnTask = (task: BatchTaskType) => {
    const compatibleJobs = viewJobs.filter(
      (j) => checkTaskCompatibility(j.fileKind, task).isCompatible
    );
    const allEnabled = compatibleJobs.length > 0 && compatibleJobs.every((j) => j.selectedTasks.includes(task));

    const updated = jobs.map((job) => {
      const isCompat = checkTaskCompatibility(job.fileKind, task).isCompatible;
      if (!isCompat) return job;

      let nextTasks: BatchTaskType[];
      if (allEnabled) {
        nextTasks = job.selectedTasks.filter((t) => t !== task);
      } else {
        if (task === "tts") {
          nextTasks = [...job.selectedTasks.filter((t) => t !== "dialogue"), "tts"];
        } else if (task === "dialogue") {
          nextTasks = [...job.selectedTasks.filter((t) => t !== "tts"), "dialogue"];
        } else {
          nextTasks = Array.from(new Set([...job.selectedTasks, task]));
        }
      }

      const seq = computeExecutionSequence(nextTasks, job.fileKind);
      return {
        ...job,
        selectedTasks: nextTasks,
        executionSequence: seq,
      };
    });

    orchestrator.setJobs(updated);
  };

  const isTaskAllEnabled = (task: BatchTaskType) => {
    const compats = viewJobs.filter(
      (j) => checkTaskCompatibility(j.fileKind, task).isCompatible
    );
    return compats.length > 0 && compats.every((j) => j.selectedTasks.includes(task));
  };

  const isTaskSomeEnabled = (task: BatchTaskType) => {
    const compats = viewJobs.filter(
      (j) => checkTaskCompatibility(j.fileKind, task).isCompatible
    );
    return compats.some((j) => j.selectedTasks.includes(task));
  };

  // Stage to Queue
  const handleStageToQueue = () => {
    const updated = jobs.map((job) => {
      if (selectedJobIds.has(job.id) && job.stage === "staging" && job.selectedTasks.length > 0) {
        return {
          ...job,
          stage: "queued" as const,
          status: "waiting" as const,
        };
      }
      return job;
    });

    orchestrator.setJobs(updated);
    setSelectedJobIds(new Set());
    setActiveView("queued");
  };

  // 3-Way CTA
  const getJobDiff = (job: BatchJob): ConfigDiffResult => {
    const working = getJobWorkingConfig(job);
    return computeJobConfigDiff(job, working);
  };

  const handleRetry = (jobId: string) => {
    orchestrator.retryJob(jobId);
    setActiveView("queued");
  };

  const handleRegenerate = (jobId: string) => {
    orchestrator.regenerateJob(jobId);
    setActiveView("queued");
  };

  const handleReexport = (jobId: string) => {
    orchestrator.reexportJob(jobId);
  };

  const handleRetryAll = () => {
    const failed = jobs.filter((j) => j.status === "failed" || j.status === "failed_with_artifact");
    failed.forEach((j) => orchestrator.retryJob(j.id));
    setActiveView("queued");
  };

  // Stage to Queue and directly start processing
  const handleStartFromList = () => {
    handleStageToQueue();
    orchestrator.startQueue();
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background select-none">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            Promise.all(
              files.map(async (f): Promise<IncomingFile> => ({
                path: f.name,
                name: f.name,
                size: f.size,
                mtime: f.lastModified,
                textContent: /\.txt$/i.test(f.name) ? await f.text() : undefined,
              }))
            ).then(handleAddFiles);
            e.target.value = "";
          }
        }}
        multiple
        className="hidden"
      />

      {/* 1. TOP BAR */}
      <BatchTopBar
        activeView={activeView}
        onViewChange={setActiveView}
        viewCounts={viewCounts}
        queueStatus={queueStatus}
        totalJobCount={jobs.length}
        selectedJobCount={selectedJobIds.size}
        onStageToQueue={handleStageToQueue}
        onStartQueue={() => orchestrator.startQueue()}
        onPauseQueue={() => orchestrator.requestPause()}
        onGlobalConfigClick={() => setIsGlobalModalOpen(true)}
        onStartFromList={handleStartFromList}
      />

      {/* 2. CENTER WORKSPACE */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-4 py-3 space-y-2.5">
        {/* Sub-toolbar (Only in List tab) */}
        {activeView === "list" && (
          <BatchSubToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onUploadClick={handleUploadClick}
            onGlobalConfigClick={() => setIsGlobalModalOpen(true)}
          />
        )}

        {/* View Tables */}
        <div className="flex-1 min-h-0 bg-surface1 rounded-xl border border-borderDefault flex flex-col overflow-hidden shadow-xs relative">
          {activeView === "list" && (
            <FileTaskMatrixTable
              jobs={viewJobs}
              selectedJobIds={selectedJobIds}
              onToggleSelectRow={handleToggleSelectRow}
              onToggleSelectAll={handleToggleSelectAll}
              isAllSelected={isAllSelected}
              isIndeterminate={isIndeterminate}
              onToggleJobTask={handleToggleJobTask}
              onToggleAllColumnTask={handleToggleAllColumnTask}
              isTaskAllEnabled={isTaskAllEnabled}
              isTaskSomeEnabled={isTaskSomeEnabled}
              getTaskCompatibility={(job, task) => checkTaskCompatibility(job.fileKind, task)}
              onOpenDrawer={setDrawerJob}
              onDeleteJob={(id) => orchestrator.setJobs(jobs.filter((j) => j.id !== id))}
              onClearAllJobs={() => orchestrator.setJobs([])}
            />
          )}

          {activeView === "queued" && (
            <QueueReorderTable
              jobs={viewJobs}
              onMoveJob={(id, dir) => orchestrator.moveWaitingJob(id, dir)}
              onCancelJob={(id) => {
                const updated = jobs.map((j) => (j.id === id ? { ...j, status: "cancelled" as const } : j));
                orchestrator.setJobs(updated);
              }}
            />
          )}

          {activeView === "completed" && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-auto p-4 space-y-2">
                {viewJobs.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-textMuted">
                    <CheckCircle2 className="w-10 h-10 mb-2 opacity-40 text-emerald-400" />
                    <p className="text-xs">Chưa có tệp nào hoàn tất xử lý.</p>
                  </div>
                ) : (
                  viewJobs.map((job) => (
                    <div
                      key={job.id}
                      className="p-3 bg-surface2/40 border border-borderDefault rounded-lg flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-bold text-textPrimary">{job.sourceFileName}</div>
                        <div className="text-[11px] text-textMuted font-mono">
                          {job.artifacts.ownedArtifactPaths.length} kết quả xuất
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {job.artifacts.ownedArtifactPaths.map((path, pIdx) => (
                          <button
                            key={pIdx}
                            type="button"
                            onClick={() =>
                              setPreviewArtifact({
                                path,
                                fileName: path.split("/").pop() || "artifact",
                              })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface3 hover:bg-surface2 text-textPrimary border border-borderDefault cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>{path.endsWith(".wav") ? "Audio" : "Phụ đề"}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <BatchFooter totalCount={viewJobs.length} />
            </div>
          )}

          {activeView === "failed" && (
            <FailedJobsTable
              jobs={viewJobs}
              getJobDiff={getJobDiff}
              onRetry={handleRetry}
              onRegenerate={handleRegenerate}
              onReexport={handleReexport}
              onRetryAll={handleRetryAll}
              onOpenDrawer={setDrawerJob}
            />
          )}
        </div>
      </div>

      {/* 3. MODALS & DRAWERS */}
      <GlobalDefaultsModal
        isOpen={isGlobalModalOpen}
        onClose={() => setIsGlobalModalOpen(false)}
        globalDefaults={orchestrator.getGlobalDefaults()}
        onSaveDefaults={(defs) => orchestrator.setGlobalDefaults(defs)}
        selectedJobCount={selectedJobIds.size}
        onApplyToSelected={(defs) => {
          const updated = jobs.map((job) => {
            if (selectedJobIds.has(job.id)) {
              return {
                ...job,
                configOverrides: {
                  ...job.configOverrides,
                  ...defs,
                },
                hasCustomConfig: true,
              };
            }
            return job;
          });
          orchestrator.setJobs(updated);
        }}
      />

      {drawerJob && (
        <PerFileConfigDrawer
          job={drawerJob}
          isOpen={Boolean(drawerJob)}
          onClose={() => setDrawerJob(null)}
          onSaveOverrides={(id, overrides, outSnap) => {
            const updated = jobs.map((j) =>
              j.id === id
                ? {
                    ...j,
                    configOverrides: overrides,
                    outputSnapshot: outSnap,
                    hasCustomConfig: true,
                  }
                : j
            );
            orchestrator.setJobs(updated);
          }}
          onRestoreSnapshot={(id) => {
            const updated = jobs.map((j) =>
              j.id === id ? { ...j, configOverrides: {}, hasCustomConfig: false } : j
            );
            orchestrator.setJobs(updated);
          }}
        />
      )}

      {previewArtifact && (
        <BatchArtifactPreviewModal
          isOpen={Boolean(previewArtifact)}
          onClose={() => setPreviewArtifact(null)}
          artifactPath={previewArtifact.path}
          fileName={previewArtifact.fileName}
        />
      )}
    </div>
  );
};
export default BatchWorkspace;

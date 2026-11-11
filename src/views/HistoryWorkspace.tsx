import React, { useState, useEffect, useMemo } from "react";
import {
  History,
  FolderOpen,
  RotateCcw,
  Trash2,
  FileAudio,
  Mic,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Search,
  X,
  Eye,
  FileText,
  Video,
  FileCode,
} from "lucide-react";
import {
  UnifiedHistoryItem,
  HistoryArtifactItem,
  HistoryFilterType,
} from "../types/history";
import {
  loadHistoryItems,
  loadHistoryFromFileAsync,
  deleteHistoryItem,
  clearAllHistory,
  filterHistoryItems,
  openHistoryPathInFolder,
  formatHistoryCreatedAt,
  resolveHistoryStatusDisplay,
} from "../services/history/historyManager";
import { ResultPreviewDrawer } from "../components/preview/ResultPreviewDrawer";
import { BatchFooter } from "../components/batch/BatchFooter";

interface HistoryWorkspaceProps {
  onResumeSession?: (id: string) => void;
  onOpenOutput?: () => void;
}

const TASK_LABELS: Record<string, string> = {
  tts: "TTS",
  dialogue: "Hội thoại",
  transcription: "Phụ đề",
  translation: "Dịch",
  dubbing: "Lồng tiếng",
};

const CANONICAL_TASK_ORDER: Array<"tts" | "dialogue" | "transcription" | "translation" | "dubbing"> = [
  "tts",
  "dialogue",
  "transcription",
  "translation",
  "dubbing",
];

export const HistoryWorkspace: React.FC<HistoryWorkspaceProps> = ({
  onResumeSession: _onResumeSession,
  onOpenOutput,
}) => {
  // History State
  const [historyItems, setHistoryItems] = useState<UnifiedHistoryItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<HistoryFilterType>("all");

  // Slide-over Preview Drawer State
  const [previewDrawerOpen, setPreviewDrawerOpen] = useState<boolean>(false);
  const [activeParentJob, setActiveParentJob] = useState<UnifiedHistoryItem | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<HistoryArtifactItem | null>(null);

  // Clear All Confirmation Modal
  const [showClearAllModal, setShowClearAllModal] = useState<boolean>(false);

  const refreshHistoryFromBackend = async () => {
    setIsRefreshing(true);
    try {
      const hydrated = await loadHistoryFromFileAsync();
      setHistoryItems(hydrated);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Load history on mount & subscribe to live history updates
  useEffect(() => {
    const initial = loadHistoryItems();
    setHistoryItems(initial);
    void refreshHistoryFromBackend();

    const handleUpdated = () => {
      void refreshHistoryFromBackend();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("voxlab_history_updated", handleUpdated);
      return () => window.removeEventListener("voxlab_history_updated", handleUpdated);
    }
  }, []);

  // Filtered and searched records
  const filteredRecords = useMemo(() => {
    return filterHistoryItems(historyItems, activeFilter, searchQuery);
  }, [historyItems, activeFilter, searchQuery]);

  // Counts for filter pills
  const filterCounts = useMemo(() => {
    return {
      all: historyItems.length,
      tts: historyItems.filter((i) => i.tasks.includes("tts")).length,
      dialogue: historyItems.filter((i) => i.tasks.includes("dialogue")).length,
      transcription: historyItems.filter((i) => i.tasks.includes("transcription")).length,
      translation: historyItems.filter((i) => i.tasks.includes("translation")).length,
      dubbing: historyItems.filter((i) => i.tasks.includes("dubbing")).length,
      batch: historyItems.filter((i) => i.isBatch).length,
    };
  }, [historyItems]);

  // Open Preview Drawer
  const handleOpenPreview = (job: UnifiedHistoryItem, targetArtifact?: HistoryArtifactItem) => {
    if (job.artifacts.length === 0) return;
    setActiveParentJob(job);
    const chosen =
      targetArtifact || job.artifacts.find((a) => a.type === "audio") || job.artifacts[0] || null;
    setSelectedArtifact(chosen);
    setPreviewDrawerOpen(true);
  };

  const handleClosePreview = () => {
    setPreviewDrawerOpen(false);
  };

  // Open Output folder action via real Tauri FS backend
  const handleOpenFolder = async (dirPath: string, targetFilePath?: string) => {
    const opened = await openHistoryPathInFolder(targetFilePath, dirPath);
    if (!opened) {
      if (onOpenOutput) {
        onOpenOutput();
      } else {
        alert(`Thư mục kết quả:\n${dirPath}`);
      }
    }
  };

  // Single record immediate delete (no confirmation modal needed since disk files are untouched)
  const handleDeleteSingleItem = (jobId: string) => {
    const updated = deleteHistoryItem(jobId, historyItems);
    setHistoryItems(updated);
    if (activeParentJob?.id === jobId) {
      handleClosePreview();
    }
  };

  // Clear all delete
  const confirmClearAll = () => {
    clearAllHistory();
    setHistoryItems([]);
    setShowClearAllModal(false);
    handleClosePreview();
  };

  // Helper for source file icons
  const renderSourceIcon = (title: string, category: string) => {
    const ext = title.split(".").pop()?.toLowerCase();
    if (ext === "mp4" || ext === "mkv" || ext === "avi" || ext === "mov") {
      return <Video className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    }
    if (ext === "mp3" || ext === "wav" || ext === "flac" || ext === "m4a") {
      return <FileAudio className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    }
    if (ext === "docx" || ext === "doc" || ext === "txt" || ext === "md") {
      return <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    }
    if (category === "dialogue") {
      return <Mic className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
    }
    return <FileCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background select-none">
      {/* 1. Unified Compact Top Bar: Filter Tabs + Search + Refresh */}
      <div className="h-12 px-4 border-b border-borderDefault bg-panel flex items-center justify-between flex-shrink-0 z-10 shadow-xs gap-3">
        {/* Left: Filter Pills */}
        <div className="flex items-center gap-1 bg-surface1 p-1 rounded-xl border border-borderDefault overflow-x-auto scrollbar-none">
          {(
            [
              { key: "all", label: "Tất cả", count: filterCounts.all },
              { key: "tts", label: "TTS", count: filterCounts.tts },
              { key: "dialogue", label: "Hội thoại", count: filterCounts.dialogue },
              { key: "transcription", label: "Phụ đề", count: filterCounts.transcription },
              { key: "translation", label: "Dịch", count: filterCounts.translation },
              { key: "dubbing", label: "Lồng tiếng", count: filterCounts.dubbing },
            ] as const
          ).map((filter) => {
            const isActive = activeFilter === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setActiveFilter(filter.key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? "bg-surface3 text-textPrimary shadow-2xs"
                    : "text-textMuted hover:text-textPrimary hover:bg-surface2/60"
                }`}
              >
                <span>{filter.label}</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    isActive ? "bg-accent/20 text-accent font-bold" : "bg-surface2 text-textMuted"
                  }`}
                >
                  {filter.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right: Search Input + Refresh */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative w-56 lg:w-72">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-textMuted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm tên tệp hoặc công việc..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-surface2 border border-borderDefault rounded-lg text-textPrimary placeholder:text-textMuted focus:outline-none focus:border-accent transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-textMuted hover:text-textPrimary cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => void refreshHistoryFromBackend()}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-borderDefault bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            title="Kiểm tra lại trạng thái tệp trên ổ đĩa"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-accent" : ""}`} />
            <span className="hidden sm:inline">Làm mới</span>
          </button>
        </div>
      </div>

      {/* 2. Center Table Container */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-4 py-3">
        <div className="flex-1 min-h-0 bg-surface1 rounded-xl border border-borderDefault flex flex-col overflow-hidden shadow-xs">
          <div className="flex-1 overflow-auto">
            <table className="w-full min-w-[960px] text-left border-collapse table-fixed border-b border-borderDefault">
              <thead className="sticky top-0 bg-surface2 border-b border-borderDefault z-20 text-[13px] font-bold text-textSecondary">
                <tr>
                  {/* Column 1: # */}
                  <th className="py-2.5 px-3 w-[4%] text-center border-r border-borderDefault">
                    <div className="flex items-center justify-center min-h-[46px]">#</div>
                  </th>

                  {/* Column 2: Name */}
                  <th className="py-2.5 px-3.5 w-[37%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                    <div className="flex items-center justify-center min-h-[46px]">Tên</div>
                  </th>

                  {/* Column 3: Tasks */}
                  <th className="py-2.5 px-3 w-[16%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                    <div className="flex items-center justify-center min-h-[46px]">Tác vụ</div>
                  </th>

                  {/* Column 4: Status */}
                  <th className="py-2.5 px-3 w-[12%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                    <div className="flex items-center justify-center min-h-[46px]">Trạng thái</div>
                  </th>

                  {/* Column 5: Created Date & Time */}
                  <th className="py-2.5 px-3 w-[14%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                    <div className="flex items-center justify-center min-h-[46px]">Thời gian</div>
                  </th>

                  {/* Column 6: Actions */}
                  <th className="py-2.5 px-2 w-[17%] text-center text-sm font-bold text-textPrimary">
                    <div className="flex items-center justify-center min-h-[46px]">Thao tác</div>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-borderDefault text-xs">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-textMuted">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <History className="w-8 h-8 opacity-35" />
                        <p className="text-xs font-medium text-textSecondary">
                          {searchQuery || activeFilter !== "all"
                            ? "Không tìm thấy bản ghi lịch sử phù hợp với bộ lọc."
                            : "Chưa có bản ghi lịch sử nào."}
                        </p>
                        {(searchQuery || activeFilter !== "all") && (
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery("");
                              setActiveFilter("all");
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-surface2 hover:bg-surface3 text-accent border border-accent/30 rounded-lg transition-colors cursor-pointer mt-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Đặt lại bộ lọc</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((job, index) => {
                    const hasArtifacts = job.artifacts.length > 0;
                    const statusDisplay = resolveHistoryStatusDisplay(job);
                    const orderedTasks = CANONICAL_TASK_ORDER.filter((t) =>
                      job.tasks.includes(t)
                    );
                    const displayTasks = orderedTasks.length > 0 ? orderedTasks : job.tasks;
                    const exactDateTime =
                      (job.timestamp ? formatHistoryCreatedAt(job.timestamp) : "") ||
                      job.createdAt;

                    return (
                      <tr
                        key={job.id}
                        className={`transition-colors ${
                          statusDisplay.tone === "error"
                            ? "bg-danger/[0.03] hover:bg-danger/[0.07]"
                            : "hover:bg-surface2/50"
                        }`}
                      >
                        {/* Column 1: # */}
                        <td className="py-3 px-3 align-middle text-center text-textSecondary font-mono font-semibold border-r border-borderDefault">
                          {index + 1}
                        </td>

                        {/* Column 2: File Name */}
                        <td className="py-3 px-3.5 align-middle border-r border-borderDefault">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-surface2 border border-borderDefault flex items-center justify-center shrink-0">
                              {renderSourceIcon(job.title, job.category)}
                            </div>
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <span
                                className="font-semibold text-textPrimary truncate"
                                title={job.title}
                              >
                                {job.title}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Column 3: Tasks (left-aligned inside centered track) */}
                        <td className="py-3 px-3 align-middle border-r border-borderDefault">
                          <div className="w-[142px] max-w-full mx-auto flex flex-wrap items-center justify-start gap-1.5">
                            {displayTasks.map((taskKey) => (
                              <span
                                key={taskKey}
                                className="inline-flex items-center justify-center h-6 px-2.5 rounded-md text-[11px] font-semibold bg-surface2 border border-borderDefault text-textSecondary whitespace-nowrap"
                              >
                                {TASK_LABELS[taskKey] || taskKey}
                              </span>
                            ))}
                          </div>
                        </td>

                        {/* Column 4: Status */}
                        <td className="py-3 px-3 align-middle border-r border-borderDefault text-center">
                          <div className="flex items-center justify-center">
                            {statusDisplay.tone === "completed" && (
                              <span
                                className="inline-flex items-center justify-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 whitespace-nowrap"
                                title={statusDisplay.tooltip}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>{statusDisplay.label}</span>
                              </span>
                            )}
                            {statusDisplay.tone === "warning" && (
                              <span
                                className="inline-flex items-center justify-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 whitespace-nowrap"
                                title={statusDisplay.tooltip}
                              >
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                <span>{statusDisplay.label}</span>
                              </span>
                            )}
                            {statusDisplay.tone === "error" && (
                              <span
                                className="inline-flex items-center justify-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-semibold bg-danger/15 text-danger border border-danger/30 whitespace-nowrap"
                                title={statusDisplay.tooltip}
                              >
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>{statusDisplay.label}</span>
                              </span>
                            )}
                            {statusDisplay.tone === "missing" && (
                              <span
                                className="inline-flex items-center justify-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-medium bg-surface2 text-textSecondary border border-borderDefault whitespace-nowrap"
                                title={statusDisplay.tooltip}
                              >
                                <AlertTriangle className="w-3.5 h-3.5 text-textMuted shrink-0" />
                                <span>{statusDisplay.label}</span>
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Column 5: Created Date & Time */}
                        <td className="py-3 px-3 align-middle border-r border-borderDefault text-center">
                          <span className="font-mono font-semibold text-textPrimary text-xs whitespace-nowrap">
                            {exactDateTime}
                          </span>
                        </td>

                        {/* Column 6: Actions */}
                        <td className="py-3 px-2 align-middle text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenPreview(job)}
                              disabled={!hasArtifacts}
                              className={`inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                                hasArtifacts
                                  ? "bg-accent/15 hover:bg-accent/25 text-accent border-accent/35 cursor-pointer"
                                  : "bg-surface2 text-textMuted border-borderDefault opacity-45 cursor-not-allowed"
                              }`}
                              title={
                                hasArtifacts
                                  ? "Xem trước kết quả âm thanh và phụ đề"
                                  : "Bản ghi này không có tệp kết quả để xem"
                              }
                            >
                              <Eye className="w-3.5 h-3.5 shrink-0" />
                              <span>Xem</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                const existingArt = job.artifacts.find(
                                  (a) => a.existsOnDisk && a.filePath
                                );
                                void handleOpenFolder(job.outputDirectory, existingArt?.filePath);
                              }}
                              className="inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-lg text-xs font-medium bg-surface3 hover:bg-surface2 text-textPrimary border border-borderDefault transition-colors cursor-pointer whitespace-nowrap"
                              title="Mở thư mục chứa kết quả xuất trên ổ đĩa"
                            >
                              <FolderOpen className="w-3.5 h-3.5 text-accent shrink-0" />
                              <span>Mở thư mục</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteSingleItem(job.id)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-textMuted hover:text-danger hover:bg-danger/10 border border-transparent hover:border-danger/30 transition-colors cursor-pointer shrink-0"
                              title="Xóa bản ghi này khỏi lịch sử (không xóa tệp trên ổ đĩa)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Shared Footer Status Bar */}
          <BatchFooter
            totalCount={filteredRecords.length}
            actions={
              <button
                type="button"
                onClick={() => setShowClearAllModal(true)}
                disabled={historyItems.length === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-danger/80 hover:text-danger bg-danger/5 hover:bg-danger/10 border border-danger/20 hover:border-danger/30 transition-all cursor-pointer disabled:opacity-40"
                title="Dọn dẹp toàn bộ danh sách lịch sử (không xóa tệp trên ổ đĩa)"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Dọn dẹp</span>
              </button>
            }
          />
        </div>
      </div>

      {/* 3. Shared Slide-over Preview Drawer */}
      {previewDrawerOpen && activeParentJob && (
        <ResultPreviewDrawer
          isOpen={previewDrawerOpen}
          job={activeParentJob}
          initialArtifactId={selectedArtifact?.id}
          onClose={handleClosePreview}
          onOpenFile={(filePath) => alert(`Đang mở tệp bằng ứng dụng mặc định:\n${filePath}`)}
          onOpenFolder={handleOpenFolder}
        />
      )}

      {/* 4. Clear All Confirmation Modal */}
      {showClearAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-surface1 border border-borderDefault rounded-2xl p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-danger/10 border border-danger/30 flex items-center justify-center text-danger flex-shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-textPrimary">Xác nhận xóa toàn bộ lịch sử?</h3>
                <p className="text-xs text-textMuted">
                  Thao tác này sẽ dọn sạch danh sách hiển thị trong VoxLab.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-surface2 border border-borderDefault text-xs text-textSecondary leading-relaxed space-y-1.5">
              <p className="font-semibold text-textPrimary">Bảo đảm an toàn dữ liệu:</p>
              <p className="text-textMuted">
                Chỉ xóa các bản ghi lịch sử trong VoxLab. Tất cả tệp âm thanh WAV/MP3, phụ đề SRT/VTT và video gốc trên ổ đĩa của bạn vẫn được giữ nguyên vẹn 100%.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowClearAllModal(false)}
                className="px-3.5 py-1.5 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-xl text-xs font-medium transition-colors cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={confirmClearAll}
                className="px-3.5 py-1.5 bg-danger hover:bg-danger/90 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-sm"
              >
                Xác nhận xóa sạch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

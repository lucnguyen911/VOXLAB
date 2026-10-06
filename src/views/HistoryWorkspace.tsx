import React, { useState, useEffect, useMemo } from "react";
import {
  History,
  FolderOpen,
  RotateCcw,
  Trash2,
  FileAudio,
  Captions,
  Mic,
  CheckCircle2,
  AlertTriangle,
  Search,
  X,
  Play,
  Eye,
  ChevronDown,
  ChevronRight,
  Layers,
  FileText,
  Video,
  Clock,
  AlertCircle,
  FileCode,
} from "lucide-react";
import {
  UnifiedHistoryItem,
  HistoryArtifactItem,
  HistoryFilterType,
} from "../types/history";
import {
  loadHistoryItems,
  deleteHistoryItem,
  clearAllHistory,
  filterHistoryItems,
} from "../services/history/historyManager";
import { ResultPreviewDrawer } from "../components/preview/ResultPreviewDrawer";
import { useI18n } from "../i18n/context";

interface HistoryWorkspaceProps {
  onResumeSession?: (id: string) => void;
  onOpenOutput?: () => void;
}

export const HistoryWorkspace: React.FC<HistoryWorkspaceProps> = ({
  onResumeSession: _onResumeSession,
  onOpenOutput,
}) => {
  const { t } = useI18n();

  // History State
  const [historyItems, setHistoryItems] = useState<UnifiedHistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<HistoryFilterType>("all");
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set());

  // Slide-over Preview Drawer State
  const [previewDrawerOpen, setPreviewDrawerOpen] = useState<boolean>(false);
  const [activeParentJob, setActiveParentJob] = useState<UnifiedHistoryItem | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<HistoryArtifactItem | null>(null);

  // Delete Confirmation Modal
  const [showClearAllModal, setShowClearAllModal] = useState<boolean>(false);
  const [itemToDelete, setItemToDelete] = useState<UnifiedHistoryItem | null>(null);

  // Load history on mount
  useEffect(() => {
    const loaded = loadHistoryItems();
    setHistoryItems(loaded);
    // Expand the first batch job by default for immediate previewability
    if (loaded.length > 0) {
      setExpandedJobIds(new Set([loaded[0].id]));
    }
  }, []);

  // Expand / collapse card toggle
  const toggleExpand = (jobId: string) => {
    setExpandedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

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
    setActiveParentJob(job);
    const chosen = targetArtifact || job.artifacts.find((a) => a.type === "audio") || job.artifacts[0] || null;
    setSelectedArtifact(chosen);
    setPreviewDrawerOpen(true);
  };

  // Close Preview Drawer
  const handleClosePreview = () => {
    setPreviewDrawerOpen(false);
  };

  // Open Output folder action
  const handleOpenFolder = (dirPath: string) => {
    if (onOpenOutput) {
      onOpenOutput();
    } else {
      alert(`Đang mở thư mục kết quả:\n${dirPath}`);
    }
  };

  // Single record delete
  const confirmDeleteItem = () => {
    if (!itemToDelete) return;
    const updated = deleteHistoryItem(itemToDelete.id, historyItems);
    setHistoryItems(updated);
    setItemToDelete(null);
    if (activeParentJob?.id === itemToDelete.id) {
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
      return <Video className="w-4 h-4 text-sky-400" />;
    }
    if (ext === "mp3" || ext === "wav" || ext === "flac" || ext === "m4a") {
      return <FileAudio className="w-4 h-4 text-emerald-400" />;
    }
    if (ext === "docx" || ext === "doc") {
      return <FileText className="w-4 h-4 text-blue-400" />;
    }
    if (category === "dialogue") {
      return <Mic className="w-4 h-4 text-indigo-400" />;
    }
    return <FileCode className="w-4 h-4 text-amber-400" />;
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      {/* 1. Header with Stats & Actions */}
      <div className="p-4 border-b border-borderDefault bg-surface1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shadow-2xs">
            <History className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-textPrimary">{t.history.title}</h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface2 border border-borderDefault text-textMuted">
                {historyItems.length} công việc
              </span>
            </div>
            <p className="text-[11px] text-textMuted">
              Gom lịch sử theo từng công việc & tệp nguồn. Quản lý toàn bộ tệp âm thanh, phụ đề và bản dịch đã commit.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowClearAllModal(true)}
            disabled={historyItems.length === 0}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer ${
              historyItems.length === 0
                ? "opacity-40 cursor-not-allowed border-borderDefault text-textMuted"
                : "border-borderDefault text-textMuted hover:text-danger hover:bg-danger/10 hover:border-danger/30"
            }`}
            title="Xóa danh sách lịch sử (không xóa tệp trên đĩa)"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t.settings.clearHistory}</span>
          </button>
        </div>
      </div>

      {/* 2. Search Box and Filter Pills */}
      <div className="p-4 border-b border-borderDefault bg-surface1/60 flex flex-col md:flex-row md:items-center justify-between gap-3 flex-shrink-0">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên tệp nguồn, công việc hoặc tệp kết quả..."
            className="w-full pl-8.5 pr-8 py-1.5 text-xs bg-surface2 border border-borderDefault rounded-xl text-textPrimary placeholder:text-textMuted focus:outline-none focus:border-accent transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-textMuted hover:text-textPrimary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 7 Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {(
            [
              { key: "all", label: "Tất cả", count: filterCounts.all },
              { key: "tts", label: "TTS", count: filterCounts.tts },
              { key: "dialogue", label: "Hội thoại", count: filterCounts.dialogue },
              { key: "transcription", label: "Phụ đề", count: filterCounts.transcription },
              { key: "translation", label: "Dịch", count: filterCounts.translation },
              { key: "dubbing", label: "Lồng tiếng", count: filterCounts.dubbing },
              { key: "batch", label: "Hàng loạt", count: filterCounts.batch },
            ] as const
          ).map((filter) => {
            const isActive = activeFilter === filter.key;
            return (
              <button
                key={filter.key}
                onClick={() => setActiveFilter(filter.key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? "bg-accent/15 border-accent text-accent shadow-2xs font-semibold"
                    : "bg-surface2 border-borderDefault text-textMuted hover:text-textPrimary hover:bg-surface3"
                }`}
              >
                <span>{filter.label}</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    isActive ? "bg-accent text-slate-950 font-bold" : "bg-surface3 text-textMuted"
                  }`}
                >
                  {filter.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Main History List */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3.5">
        {filteredRecords.length === 0 ? (
          <div className="text-center py-20 text-textMuted space-y-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-surface2 border border-borderDefault flex items-center justify-center text-textMuted">
              <History className="w-6 h-6 opacity-40" />
            </div>
            <div>
              <p className="text-xs font-semibold text-textSecondary">Không tìm thấy bản ghi lịch sử phù hợp</p>
              <p className="text-[11px] text-textMuted mt-1">
                {searchQuery
                  ? "Thử thay đổi từ khóa tìm kiếm hoặc chọn bộ lọc tác vụ khác."
                  : "Chưa có công việc nào hoàn tất trong danh mục này."}
              </p>
            </div>
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setActiveFilter("all");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface2 hover:bg-surface3 text-accent border border-accent/30 rounded-lg transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Đặt lại bộ lọc</span>
              </button>
            )}
          </div>
        ) : (
          filteredRecords.map((job) => {
            const isExpanded = expandedJobIds.has(job.id);
            const audioArtifacts = job.artifacts.filter((a) => a.type === "audio");
            const subtitleArtifacts = job.artifacts.filter((a) => a.type === "subtitle");

            return (
              <div
                key={job.id}
                className="bg-surface1 hover:border-accent/40 border border-borderDefault rounded-2xl transition-all shadow-2xs overflow-hidden"
              >
                {/* Job Card Header */}
                <div className="p-3.5 md:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-start md:items-center gap-3">
                    {/* Expand/Collapse Chevron */}
                    <button
                      onClick={() => toggleExpand(job.id)}
                      className="p-1 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface2 transition-colors cursor-pointer mt-0.5 md:mt-0"
                      title={isExpanded ? "Thu gọn danh sách tệp" : "Mở rộng danh sách tệp kết quả"}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>

                    {/* Source Media Type Icon */}
                    <div className="w-9 h-9 rounded-xl bg-surface2 border border-borderDefault flex items-center justify-center flex-shrink-0">
                      {renderSourceIcon(job.title, job.category)}
                    </div>

                    {/* Job Title and Metadata */}
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-xs text-textPrimary cursor-pointer hover:text-accent transition-colors" onClick={() => toggleExpand(job.id)}>
                          {job.title}
                        </h3>

                        {/* Batch tag */}
                        {job.isBatch && (
                          <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-md bg-accent/10 border border-accent/30 text-accent font-semibold">
                            <Layers className="w-3 h-3" />
                            <span>Hàng loạt</span>
                          </span>
                        )}

                        {/* Task badges */}
                        {job.tasks.map((taskKey) => {
                          const tagLabels: Record<string, string> = {
                            tts: "TTS",
                            dialogue: "Hội thoại",
                            transcription: "Phụ đề",
                            translation: "Dịch",
                            dubbing: "Lồng tiếng",
                          };
                          return (
                            <span
                              key={taskKey}
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface2 border border-borderDefault text-textSecondary"
                            >
                              {tagLabels[taskKey] || taskKey}
                            </span>
                          );
                        })}

                        {/* Status badge */}
                        {job.status === "completed" && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800/50 font-mono font-medium">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            <span>Hoàn tất</span>
                          </span>
                        )}
                        {job.status === "completed_with_warning" && (
                          <span className="flex items-center gap-1 text-[10px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800/50 font-mono font-semibold">
                            <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                            <span>Cảnh báo</span>
                          </span>
                        )}
                        {job.status === "failed_with_artifact" && (
                          <span className="flex items-center gap-1 text-[10px] text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 rounded-full border border-rose-200 dark:border-rose-800/50 font-mono font-semibold">
                            <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                            <span>Lỗi (Bảo toàn artifact)</span>
                          </span>
                        )}
                      </div>

                      {/* Subtitle details: Time, Duration, Artifact summary */}
                      <div className="text-[11px] text-textMuted font-mono flex flex-wrap items-center gap-2">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{job.createdAt}</span>
                        </span>
                        <span>•</span>
                        {job.duration && (
                          <>
                            <span>{job.duration}</span>
                            <span>•</span>
                          </>
                        )}
                        {job.chunkCount && (
                          <>
                            <span>{job.chunkCount} đoạn</span>
                            <span>•</span>
                          </>
                        )}
                        <span className="text-textSecondary font-semibold">
                          {job.artifacts.length} kết quả
                        </span>
                        {audioArtifacts.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface2 text-emerald-700 dark:text-emerald-400 font-medium">
                            {audioArtifacts.length} Audio
                          </span>
                        )}
                        {subtitleArtifacts.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface2 text-amber-800 dark:text-amber-400 font-medium">
                            {subtitleArtifacts.length} Phụ đề
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Standardized Action Buttons */}
                  <div className="flex items-center gap-2 flex-shrink-0 ml-7 md:ml-0">
                    {/* [Xem kết quả] */}
                    <button
                      onClick={() => handleOpenPreview(job)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/40 rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                      title="Xem trước kết quả âm thanh và phụ đề"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Xem kết quả</span>
                    </button>

                    {/* [Mở thư mục] */}
                    <button
                      onClick={() => handleOpenFolder(job.outputDirectory)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary border border-borderDefault rounded-xl text-xs transition-colors cursor-pointer"
                      title="Mở thư mục chứa kết quả xuất trên đĩa"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Mở thư mục</span>
                    </button>

                    {/* [Xóa lịch sử] */}
                    <button
                      onClick={() => setItemToDelete(job)}
                      className="p-1.5 text-textMuted hover:text-danger hover:bg-danger/10 border border-transparent hover:border-danger/30 rounded-xl text-xs transition-colors cursor-pointer"
                      title="Xóa bản ghi lịch sử này (không xóa tệp trên đĩa)"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expandable Artifacts List */}
                {isExpanded && (
                  <div className="border-t border-borderDefault bg-surface2/30 p-3.5 md:p-4 space-y-3">
                    {/* Source and Output Path info */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-textMuted font-mono gap-1.5 pb-2 border-b border-borderDefault/50">
                      <div className="truncate max-w-xl">
                        <span className="text-textSecondary font-semibold">Tệp nguồn: </span>
                        {job.sourceFilePath || job.title}
                        {job.sourceFileSize && ` (${job.sourceFileSize})`}
                      </div>
                      <div className="truncate max-w-md text-right">
                        <span className="text-textSecondary font-semibold">Thư mục: </span>
                        {job.outputDirectory}
                      </div>
                    </div>

                    {/* Warning Callout if present */}
                    {job.statusWarning && (
                      <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                        <div>
                          <span className="font-semibold text-amber-900 dark:text-amber-100">Lưu ý xử lý: </span>
                          <span className="text-amber-800 dark:text-amber-200">{job.statusWarning}</span>
                        </div>
                      </div>
                    )}

                    {/* Artifacts Tree */}
                    <div className="space-y-1.5 font-mono text-xs">
                      {job.artifacts.map((art, idx) => {
                        const isLast = idx === job.artifacts.length - 1;
                        const prefix = isLast ? "└── " : "├── ";

                        return (
                          <div
                            key={art.id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-xl bg-surface1/70 hover:bg-surface2/80 border border-borderDefault/70 transition-colors"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span className="text-textMuted select-none font-bold">{prefix}</span>
                              {art.type === "audio" ? (
                                <FileAudio className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                              ) : art.type === "subtitle" ? (
                                <Captions className="w-4 h-4 text-amber-400 flex-shrink-0" />
                              ) : (
                                <FileText className="w-4 h-4 text-accent flex-shrink-0" />
                              )}
                              <span className="font-semibold text-textPrimary truncate">
                                {art.fileName}
                              </span>
                              {art.fileSize && (
                                <span className="text-[10px] text-textMuted">({art.fileSize})</span>
                              )}
                              {art.label && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface3 text-textSecondary font-sans">
                                  {art.label}
                                </span>
                              )}
                              {!art.existsOnDisk && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800/60 font-sans font-medium">
                                  Tệp không còn trên đĩa
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0 ml-6 sm:ml-0">
                              <button
                                onClick={() => handleOpenPreview(job, art)}
                                className="flex items-center gap-1 px-2.5 py-1 bg-surface2 hover:bg-surface3 text-textPrimary hover:text-accent border border-borderDefault rounded-lg text-[11px] transition-colors cursor-pointer"
                              >
                                {art.type === "audio" ? (
                                  <>
                                    <Play className="w-3 h-3 fill-current" />
                                    <span>Nghe thử</span>
                                  </>
                                ) : (
                                  <>
                                    <Eye className="w-3 h-3" />
                                    <span>Xem phụ đề</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 4. Shared Slide-over Preview Drawer */}
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

      {/* 5. Clear All Confirmation Modal */}
      {showClearAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-surface1 border border-borderDefault rounded-2xl p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-danger/10 border border-danger/30 flex items-center justify-center text-danger flex-shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-textPrimary">Xác nhận xóa toàn bộ lịch sử?</h3>
                <p className="text-xs text-textMuted">Thao tác này sẽ xóa sạch danh sách hiển thị trong VoxLab.</p>
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
                onClick={() => setShowClearAllModal(false)}
                className="px-3.5 py-1.5 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-xl text-xs font-medium transition-colors cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={confirmClearAll}
                className="px-3.5 py-1.5 bg-danger hover:bg-danger/90 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-sm"
              >
                Xác nhận xóa sạch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Single Item Delete Confirmation Modal */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-surface1 border border-borderDefault rounded-2xl p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-danger/10 border border-danger/30 flex items-center justify-center text-danger flex-shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="truncate">
                <h3 className="text-sm font-bold text-textPrimary">Xóa bản ghi công việc?</h3>
                <p className="text-xs text-textMuted font-mono truncate">{itemToDelete.title}</p>
              </div>
            </div>

            <p className="text-xs text-textMuted leading-relaxed">
              Bạn có chắc chắn muốn xóa bản ghi này khỏi danh sách Lịch sử? Các tệp artifact đã xuất trong thư mục đầu ra vẫn được giữ nguyên trên máy tính.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                onClick={() => setItemToDelete(null)}
                className="px-3.5 py-1.5 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-xl text-xs font-medium transition-colors cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={confirmDeleteItem}
                className="px-3.5 py-1.5 bg-danger hover:bg-danger/90 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-sm"
              >
                Xóa bản ghi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

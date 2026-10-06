import React, { useState, useRef } from "react";
import {
  Wand2,
  Sparkles,
  RotateCcw,
  Play,
  Pause,
  RefreshCw,
  FileAudio,
  AlertCircle,
  ArrowRight,
  Layers,
  Languages,
  Clock,
  UploadCloud,
} from "lucide-react";
import { ChunkItem } from "../types/ui";
import { INITIAL_SCRIPT, MOCK_CHUNKS } from "../mock/data";
import { useI18n } from "../i18n/context";
import { batchQueueExecutor } from "../services/concurrencyExecutor";
import { TextNormalizationModal } from "../components/modals/TextNormalizationModal";
import { PronunciationManagerModal } from "../components/modals/PronunciationManagerModal";
import { ManualPausePopover } from "../components/popovers/ManualPausePopover";
import { formatPauseToken, splitScriptWithPauses } from "../services/pause";
import {
  validateChunksForExport,
  mergeMasterAudio,
  downloadAudioBlob,
  generateSrtFromChunks,
  downloadTextBlob,
} from "../services/audio/masterExport";
import { loadStoredTtsSettings } from "../components/inspector/TtsInspector";
import { loadSubtitleSettings } from "../services/subtitle";
import { loadScriptFromFile } from "../services/document/scriptLoader";
import { extractFilesFromDropEvent } from "../services/fileDropHelper";

interface TtsWorkspaceProps {
  onOpenDiffModal?: (original: string, proposed: string) => void;
  selectedChunk: ChunkItem | null;
  onSelectChunk: (chunk: ChunkItem) => void;
  onTriggerJob: () => void;
  onOpenExportValidation: (invalidChunks: ChunkItem[]) => void;
  isGenerating?: boolean;
  isPaused?: boolean;
  onTogglePause?: () => void;
  onCancel?: () => void;
  concurrency?: number;
  onJobComplete?: () => void;
  onChunkProgress?: (current: number, total: number) => void;
  currentChunkIndex?: number;
  totalChunks?: number;
  activePlayingChunkId?: string | null;
  isPlayingAudio?: boolean;
  onPlayChunk?: (chunk: ChunkItem) => void;
  inspector?: React.ReactNode;
  bottomPlayer?: React.ReactNode;
  exportSrt?: boolean;
  incomingScript?: string | null;
  onConsumeIncomingScript?: () => void;
}

const AutoResizeTextarea: React.FC<{
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}> = ({ value, onChange, className, placeholder }) => {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const adjustHeight = React.useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, []);

  React.useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  React.useEffect(() => {
    window.addEventListener("resize", adjustHeight);
    return () => window.removeEventListener("resize", adjustHeight);
  }, [adjustHeight]);

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        adjustHeight();
      }}
      className={`cursor-text caret-accent ${className}`}
      placeholder={placeholder}
    />
  );
};

export const TtsWorkspace: React.FC<TtsWorkspaceProps> = ({
  selectedChunk,
  onSelectChunk,
  onTriggerJob,
  onOpenExportValidation,
  isGenerating = false,
  isPaused = false,
  onTogglePause,
  onCancel,
  concurrency = 1,
  onJobComplete,
  onChunkProgress,
  currentChunkIndex: _currentChunkIndex = 5,
  totalChunks = 7,
  activePlayingChunkId,
  isPlayingAudio = false,
  onPlayChunk,
  inspector,
  bottomPlayer,
  exportSrt = false,
  incomingScript,
  onConsumeIncomingScript,
}) => {
  const { t, lang } = useI18n();
  const [stage, setStage] = useState<"prep" | "studio">(() => {
    try {
      const saved = localStorage.getItem("voxlab_tts_stage");
      if (saved === "prep" || saved === "studio") return saved;
    } catch {}
    return "studio";
  });

  React.useEffect(() => {
    try {
      localStorage.setItem("voxlab_tts_stage", stage);
    } catch {}
  }, [stage]);
  const [workingText, setWorkingText] = useState(() => {
    try {
      const saved = localStorage.getItem("voxlab_script_working_text");
      if (saved !== null && saved.length > 0) return saved;
    } catch {
      // ignore
    }
    return INITIAL_SCRIPT;
  });

  React.useEffect(() => {
    if (incomingScript) {
      setWorkingText(incomingScript);
      setStage("prep");
      if (onConsumeIncomingScript) {
        onConsumeIncomingScript();
      }
    }
  }, [incomingScript, onConsumeIncomingScript]);
  const [originalText] = useState(INITIAL_SCRIPT);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [chunks, setChunks] = useState<ChunkItem[]>(MOCK_CHUNKS);
  const [playingChunkId, setPlayingChunkId] = useState<string | null>(null);

  const [isNormalizerOpen, setIsNormalizerOpen] = useState(false);
  const [isPronunciationModalOpen, setIsPronunciationModalOpen] = useState(false);
  const [isPausePopoverOpen, setIsPausePopoverOpen] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [_skippedCount, setSkippedCount] = useState(0);
  const [batchTotal, setBatchTotal] = useState<number>(0);
  const [_pendingItems, setPendingItems] = useState<number>(0);
  const [_isCompletedState, setIsCompletedState] = useState(false);
  const [generationError, setGenerationError] = useState<{
    chunkId: string;
    chunkIndex: number;
    error: any;
    resolveAction?: (action: "retry" | "skip" | "cancel") => void;
  } | null>(null);

  const effectiveTotal = batchTotal > 0 ? batchTotal : (totalChunks || chunks.length);

  const scriptFileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const handleProcessScriptFile = async (file: File) => {
    try {
      const result = await loadScriptFromFile(file);
      handleWorkingTextChange(result.text);
    } catch (err: any) {
      console.error("Script file load error:", err);
    } finally {
      if (scriptFileInputRef.current) {
        scriptFileInputRef.current.value = "";
      }
    }
  };

  const handleWorkingTextChange = (text: string) => {
    setWorkingText(text);
    try {
      localStorage.setItem("voxlab_script_working_text", text);
    } catch {
      // ignore
    }
  };

  // Deterministic normalization modal open
  const handleNormalize = () => {
    setIsNormalizerOpen(true);
  };

  const handleApplyNormalization = (normalizedText: string, _changeCount: number) => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
      const success = document.execCommand("insertText", false, normalizedText);
      if (!success) {
        handleWorkingTextChange(normalizedText);
      } else {
        try {
          localStorage.setItem("voxlab_script_working_text", textareaRef.current.value);
        } catch {
          // ignore
        }
      }
    } else {
      handleWorkingTextChange(normalizedText);
    }
  };

  const handleRestoreOriginal = () => {
    handleWorkingTextChange(originalText);
  };

  // Insert manual pause token at cursor position (1-step native Undo/Redo transaction)
  const handleInsertPause = (durationMs: number) => {
    const token = formatPauseToken(durationMs);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.focus();
      const success = document.execCommand("insertText", false, ` ${token} `);
      if (!success) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const next = workingText.slice(0, start) + ` ${token} ` + workingText.slice(end);
        handleWorkingTextChange(next);
      } else {
        try {
          localStorage.setItem("voxlab_script_working_text", textarea.value);
        } catch {
          // ignore
        }
      }
    } else {
      handleWorkingTextChange(`${workingText} ${token}`);
    }
  };

  // Split script into chunks respecting pause boundaries when entering Studio
  const handleSplitAndStudio = () => {
    if (isGenerating) {
      handleCancelGeneration();
    }
    const parsedChunks = splitScriptWithPauses(workingText);
    if (parsedChunks.length > 0) {
      setChunks(parsedChunks);
    }
    setStage("studio");
  };

  // Inline chunk text editing (triggers Modified / Stale status)
  const handleChunkTextChange = (id: string, newText: string) => {
    setChunks((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, text: newText, status: "modified" } : c
      )
    );
  };

  const handlePlayToggle = (id: string) => {
    setPlayingChunkId(playingChunkId === id ? null : id);
  };

  // Regenerate single chunk (Section 9: Only targets this chunk, new version becomes current)
  const handleRegenerateChunk = async (id: string) => {
    setChunks((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, status: "generating", errorMessage: undefined } : c
      )
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      setChunks((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: "ready", durationSec: 6.2, audioUrl: undefined } : c
        )
      );
    } catch (err: any) {
      setChunks((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: "failed", errorMessage: String(err?.message || err) } : c
        )
      );
    }
  };

  // Filter chunks that need regeneration / block master export
  const validation = validateChunksForExport(chunks);
  const invalidChunks = validation.invalidChunks;

  // Chunks requiring generation (Rule Section 8: Global button never regenerates Ready)
  const chunksNeedingGeneration = chunks.filter(
    (c) => c.status === "pending" || c.status === "modified" || c.status === "failed" || !c.durationSec || (c as any).isSkipped
  );

  const handleResolveError = (action: "retry" | "skip" | "cancel") => {
    if (generationError?.resolveAction) {
      const resolver = generationError.resolveAction;
      setGenerationError(null);
      if (action === "skip") {
        setSkippedCount((prev) => prev + 1);
      }
      resolver(action);
      if (action === "cancel") {
        handleCancelGeneration();
      }
    }
  };

  const handleCancelGeneration = () => {
    batchQueueExecutor.cancel();
    onCancel?.();
  };

  // Batch regenerate all invalid chunks using real concurrency executor
  const handleRegenerateInvalidChunks = async () => {
    if (invalidChunks.length === 0 || isGenerating) return;
    setCompletedCount(0);
    setSkippedCount(0);
    setIsCompletedState(false);
    setGenerationError(null);
    batchQueueExecutor.reset();
    onTriggerJob();

    const targetIds = invalidChunks.map((c) => c.id);
    setBatchTotal(targetIds.length);
    setPendingItems(targetIds.length);

    await batchQueueExecutor.runBatch(
      targetIds,
      {
        concurrency,
        onWorkerChange: (_active, pending) => {
          setPendingItems(pending ?? 0);
        },
        processItem: async (chunkId) => {
          setChunks((prev) =>
            prev.map((c) =>
              c.id === chunkId
                ? { ...c, status: "generating", errorMessage: undefined }
                : c
            )
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          setChunks((prev) =>
            prev.map((c) =>
              c.id === chunkId
                ? { ...c, status: "ready", durationSec: 5.8 }
                : c
            )
          );
        },
        onItemCompleted: (_item, _idx, completed, total) => {
          setCompletedCount(completed);
          onChunkProgress?.(completed, total);
        },
        onItemFailed: async (chunkId, index, err) => {
          setChunks((prev) =>
            prev.map((c) =>
              c.id === chunkId
                ? { ...c, status: "failed", errorMessage: String(err?.message || err) }
                : c
            )
          );
          return new Promise<"retry" | "skip" | "cancel">((resolve) => {
            setGenerationError({
              chunkId,
              chunkIndex: index,
              error: err,
              resolveAction: resolve,
            });
          });
        },
      }
    );

    if (!batchQueueExecutor.isQueueCancelled() && !batchQueueExecutor.isQueuePaused()) {
      setIsCompletedState(true);
      setTimeout(() => {
        setIsCompletedState(false);
        onJobComplete?.();
      }, 2500);
    } else {
      onJobComplete?.();
    }
  };

  // Nút tạo audio: chức năng tạo toàn bộ hoặc tạo lại toàn bộ các đoạn trong kịch bản (ghi đè kết quả cũ)
  const handleGenerateAllAudio = async () => {
    if (isGenerating || chunks.length === 0) return;

    // Luôn xử lý toàn bộ các đoạn trong kịch bản
    const targetChunks = chunks;

    setCompletedCount(0);
    setSkippedCount(0);
    setIsCompletedState(false);
    setGenerationError(null);
    batchQueueExecutor.reset();
    onTriggerJob();

    const targetIds = targetChunks.map((c) => c.id);
    setBatchTotal(targetIds.length);
    setPendingItems(targetIds.length);

    await batchQueueExecutor.runBatch(
      targetIds,
      {
        concurrency,
        onWorkerChange: (_active, pending) => {
          setPendingItems(pending ?? 0);
        },
        processItem: async (chunkId) => {
          setChunks((prev) =>
            prev.map((c) =>
              c.id === chunkId
                ? { ...c, status: "generating", errorMessage: undefined }
                : c
            )
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          setChunks((prev) =>
            prev.map((c) =>
              c.id === chunkId
                ? { ...c, status: "ready", durationSec: 5.8 }
                : c
            )
          );
        },
        onItemCompleted: (_item, _idx, completed, total) => {
          setCompletedCount(completed);
          onChunkProgress?.(completed, total);
        },
        onItemFailed: async (chunkId, index, err) => {
          setChunks((prev) =>
            prev.map((c) =>
              c.id === chunkId
                ? { ...c, status: "failed", errorMessage: String(err?.message || err) }
                : c
            )
          );
          return new Promise<"retry" | "skip" | "cancel">((resolve) => {
            setGenerationError({
              chunkId,
              chunkIndex: index,
              error: err,
              resolveAction: resolve,
            });
          });
        },
      }
    );

    if (!batchQueueExecutor.isQueueCancelled() && !batchQueueExecutor.isQueuePaused()) {
      setIsCompletedState(true);
      setTimeout(() => {
        setIsCompletedState(false);
        onJobComplete?.();
      }, 2500);
    } else {
      onJobComplete?.();
    }
  };

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__VOXLAB_REGENERATE_INVALID__ = handleRegenerateInvalidChunks;
      (window as any).__VOXLAB_GENERATE_ALL__ = handleGenerateAllAudio;
      (window as any).__VOXLAB_EXPORT_AUDIO__ = handleExportAudio;
      (window as any).__VOXLAB_MERGE_MASTER__ = () =>
        mergeMasterAudio(chunks, {
          projectTitle: "Podcast_Ep12",
          punctuationPauses: loadStoredTtsSettings().pauses,
        });
      (window as any).__VOXLAB_GENERATE_SRT__ = () => {
        const subtitleSettings = loadSubtitleSettings();
        return generateSrtFromChunks(chunks, {
          punctuationPauses: loadStoredTtsSettings().pauses,
          aspectRatio: subtitleSettings.aspectRatio,
          maxLines: subtitleSettings.maxLines,
          optimize: true,
        });
      };
    }
  });

  // Master audio export execution with validation check
  const handleExportAudio = () => {
    const val = validateChunksForExport(chunks);
    if (!val.canExport) {
      onOpenExportValidation(val.invalidChunks);
      return;
    }

    try {
      const ttsSettings = loadStoredTtsSettings();
      const result = mergeMasterAudio(chunks, {
        projectTitle: "Podcast_Ep12",
        punctuationPauses: ttsSettings.pauses,
      });
      downloadAudioBlob(result.blob, result.filename);

      if (exportSrt) {
        try {
          const subtitleSettings = loadSubtitleSettings();
          const srtContent = generateSrtFromChunks(chunks, {
            punctuationPauses: ttsSettings.pauses,
            aspectRatio: subtitleSettings.aspectRatio,
            maxLines: subtitleSettings.maxLines,
            optimize: true,
          });
          const srtFilename = result.filename.replace(/\.wav$/i, ".srt");
          downloadTextBlob(srtContent, srtFilename);
        } catch (err: any) {
          console.error("SRT export error:", err);
        }
      }
    } catch (err: any) {
      console.error("Master export error:", err);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      {/* Workspace Subheader & Stage Switcher */}
      <div className="h-12 border-b border-borderDefault bg-panel px-3.5 flex items-center justify-between flex-shrink-0 overflow-x-auto gap-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="inline-flex bg-surface2 rounded-lg p-0.5 border border-borderDefault/60 text-xs flex-shrink-0">
            <button
              onClick={() => {
                if (isGenerating) {
                  handleCancelGeneration();
                }
                setStage("prep");
              }}
              className={`px-3 py-1 rounded-md font-medium transition-all whitespace-nowrap ${
                stage === "prep"
                  ? "bg-surface1 text-textPrimary font-semibold shadow-2xs"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              {t.tts.prepStage}
            </button>
            <button
              onClick={() => {
                if (chunks.length === 0 && workingText.trim().length > 0) {
                  const parsedChunks = splitScriptWithPauses(workingText);
                  if (parsedChunks.length > 0) {
                    setChunks(parsedChunks);
                  }
                }
                setStage("studio");
              }}
              className={`px-3 py-1 rounded-md font-medium transition-all whitespace-nowrap ${
                stage === "studio"
                  ? "bg-surface1 text-textPrimary font-semibold shadow-2xs"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              {t.tts.studioStage}
            </button>
          </div>
        </div>

        {/* Action button based on stage */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {stage === "prep" ? (
            workingText.trim().length > 0 && (
              <button
                type="button"
                onClick={handleSplitAndStudio}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accentHover text-white rounded-lg text-xs font-semibold shadow-xs transition-colors whitespace-nowrap cursor-pointer"
              >
                <span>{t.tts.splitAndStudio}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )
          ) : (
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Error banner if runtime generation error occurred */}
              {generationError && (
                <div className="flex items-center gap-2 px-2.5 py-1 bg-danger/15 rounded-md border border-danger/30 text-xs shadow-2xs">
                  <AlertCircle className="w-3.5 h-3.5 text-danger flex-shrink-0" />
                  <span className="font-medium text-danger whitespace-nowrap">
                    Lỗi khi tạo đoạn {generationError.chunkIndex + 1}/{effectiveTotal}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleResolveError("retry")}
                    className="px-2 py-0.5 bg-danger/20 hover:bg-danger/30 text-danger rounded font-medium transition-colors cursor-pointer"
                  >
                    Thử lại
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolveError("skip")}
                    className="px-2 py-0.5 bg-surface2 hover:bg-surface3 text-textSecondary rounded font-medium transition-colors cursor-pointer"
                  >
                    Bỏ qua
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolveError("cancel")}
                    className="px-2 py-0.5 bg-surface2 hover:bg-surface3 text-textMuted rounded font-medium transition-colors cursor-pointer"
                  >
                    Hủy
                  </button>
                </div>
              )}

              {/* PERMANENT TOP-RIGHT CTA: Ghép & xuất */}
              <button
                type="button"
                onClick={handleExportAudio}
                disabled={chunks.length === 0 || isGenerating}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors whitespace-nowrap cursor-pointer ${
                  chunks.length === 0 || isGenerating
                    ? "bg-surface2 text-textMuted cursor-not-allowed opacity-60 border border-borderDefault"
                    : "bg-surface2 hover:bg-surface3 text-textPrimary hover:text-accent border border-borderDefault hover:border-accent/40"
                }`}
                title={
                  isGenerating
                    ? "Đang tạo audio, vui lòng chờ hoàn tất để ghép & xuất"
                    : "Ghép tất cả các đoạn và xuất file audio master"
                }
              >
                <FileAudio className="w-3.5 h-3.5 text-accent" />
                <span>{t.tts.exportAudio}</span>
                {invalidChunks.length > 0 && !isGenerating && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-warning ml-0.5"
                    title="Có đoạn cần tạo lại trước khi xuất"
                  />
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Stage Content */}
      <div className="flex-1 overflow-hidden">
        {stage === "prep" ? (
          /* STAGE 1: TEXT PREPARATION VIEW */
          <div className="h-full flex flex-col p-4 space-y-3 overflow-y-auto w-full">
            {/* Hidden File Input for Script (.docx, .txt, .md, .srt, .vtt) */}
            <input
              type="file"
              ref={scriptFileInputRef}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleProcessScriptFile(file);
                }
              }}
              accept=".docx,.txt,.md,.srt,.vtt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
            />

            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-surface1 rounded-lg border border-borderDefault text-xs">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => scriptFileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-md border border-borderDefault transition-colors font-semibold text-xs cursor-pointer shadow-2xs"
                  title="Tải lên tệp hoặc thư mục kịch bản (.docx, .txt, .md, .srt, .vtt)"
                >
                  <UploadCloud className="w-3.5 h-3.5 text-accent" />
                  <span>Tải Lên</span>
                </button>

                <div className="h-4 w-px bg-borderDefault mx-0.5" />

                <button
                  onClick={handleNormalize}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-md border border-borderDefault transition-colors font-medium text-xs cursor-pointer"
                  title="Chuẩn hóa ký tự Unicode và khoảng trắng, giữ nguyên số và ký tự kỹ thuật"
                >
                  <Wand2 className="w-3.5 h-3.5 text-accent" />
                  <span>{t.tts.normalize}</span>
                </button>

                <button
                  onClick={() => setIsPronunciationModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-md border border-borderDefault transition-colors font-medium text-xs"
                  title="Quản lý cách đọc tùy chỉnh cho từ viết tắt, tên riêng và ký hiệu"
                >
                  <Languages className="w-3.5 h-3.5 text-accent" />
                  <span>Phát âm</span>
                </button>

                <div className="relative">
                  <button
                    onClick={() => setIsPausePopoverOpen(!isPausePopoverOpen)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors font-medium text-xs ${
                      isPausePopoverOpen
                        ? "bg-accent/15 border-accent text-accent"
                        : "bg-surface2 hover:bg-surface3 text-textPrimary border-borderDefault"
                    }`}
                    title="Chèn khoảng dừng ngắt nghỉ tại vị trí con trỏ"
                  >
                    <Clock className="w-3.5 h-3.5 text-accent" />
                    <span>Thêm khoảng dừng</span>
                  </button>
                  <ManualPausePopover
                    isOpen={isPausePopoverOpen}
                    onClose={() => setIsPausePopoverOpen(false)}
                    onInsertPause={handleInsertPause}
                  />
                </div>
              </div>

              <button
                onClick={handleRestoreOriginal}
                className="flex items-center gap-1.5 px-3 py-1.5 text-textMuted hover:text-textPrimary hover:bg-surface2 rounded-md transition-colors text-xs"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t.tts.restoreOriginal}</span>
              </button>
            </div>

            {/* Editor Box */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                const files = await extractFilesFromDropEvent(e);
                const validFile =
                  files.find((f) => {
                    const ext = f.name.toLowerCase().split(".").pop() || "";
                    return ["docx", "txt", "md", "srt", "vtt"].includes(ext);
                  }) || files[0];
                if (validFile) {
                  handleProcessScriptFile(validFile);
                }
              }}
              onClick={() => textareaRef.current?.focus()}
              className={`flex-1 flex flex-col min-h-[360px] border rounded-lg overflow-hidden bg-surface1 transition-all cursor-text relative ${
                isDraggingOver
                  ? "border-accent ring-2 ring-accent/30 bg-accent/5"
                  : "border-borderDefault"
              }`}
            >
              {/* Drag Overlay Feedback */}
              {isDraggingOver && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-surface1/90 backdrop-blur-xs pointer-events-none border-2 border-dashed border-accent rounded-lg">
                  <UploadCloud className="w-8 h-8 text-accent animate-bounce mb-2" />
                  <span className="text-sm font-semibold text-textPrimary">Thả file kịch bản vào đây để nạp</span>
                  <span className="text-xs text-textMuted mt-1">Hỗ trợ .docx, .txt, .md, .srt, .vtt</span>
                </div>
              )}

              <div className="px-4 py-2.5 bg-surface2/60 border-b border-borderDefault flex items-center justify-between text-xs text-textSecondary select-none">
                <span className="font-medium text-xs text-textSecondary">
                  {t.tts.prepStage}
                </span>
                <div className="flex items-center gap-3 font-mono text-xs text-textMuted">
                  <span>{workingText.trim() ? workingText.trim().split(/\s+/).length : 0} {t.tts.words}</span>
                  <span>{workingText.length} {t.tts.chars}</span>
                </div>
              </div>

              <textarea
                ref={textareaRef}
                value={workingText}
                onChange={(e) => handleWorkingTextChange(e.target.value)}
                className="flex-1 p-4 bg-transparent text-textPrimary font-sans text-sm leading-relaxed resize-none focus:outline-none cursor-text caret-accent placeholder:text-textMuted/50"
                placeholder="Nhập hoặc thả file kịch bản vào đây..."
              />
            </div>
          </div>
        ) : (
          /* STAGE 2: CHUNK STUDIO VIEW */
          <div className="h-full flex overflow-hidden min-h-0 min-w-0">
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Header info bar */}
            <div className="flex items-center justify-between text-xs text-textMuted px-4 pt-4 pb-2">
              <div className="flex items-center gap-2 font-mono text-xs">
                <Layers className="w-3.5 h-3.5 text-accent" />
                <span className="font-semibold text-textPrimary">
                  {t.tts.sentencesCount.replace("{count}", String(chunks.length))}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {chunks.filter((c) => c.status === "failed").length > 0 && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-danger/15 border border-danger/30 text-danger font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                    <span>{t.tts.errorsCount.replace("{count}", String(chunks.filter((c) => c.status === "failed").length))}</span>
                  </span>
                )}
                {chunks.filter((c) => c.status === "modified").length > 0 && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-warning/15 border border-warning/30 text-warning font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                    <span>{t.tts.needsRegenCount.replace("{count}", String(chunks.filter((c) => c.status === "modified").length))}</span>
                  </span>
                )}
                {/* Selective Regeneration Button directly beside status badges */}
                {invalidChunks.length > 0 && (
                  <button
                    type="button"
                    onClick={handleRegenerateInvalidChunks}
                    disabled={isGenerating}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-accent hover:bg-accentHover text-white shadow-xs rounded-md text-xs font-semibold transition-all whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ml-1 active:scale-95"
                    title="Chỉ tạo lại các đoạn đã chỉnh sửa hoặc bị lỗi"
                  >
                    <RefreshCw className="w-3 h-3 text-white" />
                    <span>{t.tts.regenInvalid.replace("{count}", String(invalidChunks.length))}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Chunk Cards List */}
            <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-2.5 pr-3">
              {chunks.map((chunk) => {
                const isSelected = selectedChunk?.id === chunk.id;
                const isPlaying = activePlayingChunkId
                  ? activePlayingChunkId === chunk.id && isPlayingAudio
                  : playingChunkId === chunk.id;

                return (
                  <div
                    key={chunk.id}
                    onClick={() => onSelectChunk(chunk)}
                    className={`p-3 rounded-xl border transition-[border-color,background-color,box-shadow] duration-150 cursor-pointer select-text space-y-2 min-h-[96px] ${
                      isSelected
                        ? "bg-accent/[0.04] border-accent/45 shadow-2xs"
                        : "bg-surface1 hover:bg-surface2/30 border-borderDefault hover:border-textMuted/40 shadow-2xs"
                    }`}
                  >
                    <div className="min-h-[28px] flex items-center justify-between gap-3">
                      {/* Left: Index & Duration & Pause & Non-normal Badges */}
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="font-mono text-xs font-bold text-accent px-1.5 py-0.5 rounded-md bg-surface3/80 shrink-0">
                          {String(chunk.index).padStart(2, "0")}
                        </span>

                        {chunk.durationSec && (
                          <span className="font-mono text-xs text-textMuted font-medium shrink-0">
                            {chunk.durationSec.toFixed(1)}s
                          </span>
                        )}

                        {typeof chunk.pauseAfterMs === "number" && chunk.pauseAfterMs > 0 && (
                          <span
                            className="font-mono text-xs font-semibold text-accent px-1.5 py-0.5 rounded-md bg-accent/10 border border-accent/25 shrink-0 flex items-center gap-1"
                            title={`Khoảng dừng nghỉ sau đoạn: ${chunk.pauseAfterMs}ms`}
                          >
                            <Clock className="w-3 h-3 text-accent" />
                            <span>{(chunk.pauseAfterMs / 1000).toFixed(1)}s pause</span>
                          </span>
                        )}

                        {/* Badges ONLY for non-normal states */}
                        {chunk.status === "generating" && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/30 animate-pulse flex items-center gap-1.5 shrink-0">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>{t.tts.generating}</span>
                          </span>
                        )}

                        {chunk.status === "modified" && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-warning/15 text-warning border border-warning/30 flex items-center gap-1 shrink-0">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>{t.tts.modified}</span>
                          </span>
                        )}

                        {chunk.status === "failed" && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-danger/15 text-danger border border-danger/30 flex items-center gap-1.5 shrink-0">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>{t.tts.failed}</span>
                            {chunk.errorMessage && (
                              <span className="font-normal opacity-90">· {chunk.errorMessage}</span>
                            )}
                          </span>
                        )}
                      </div>

                      {/* Right: Chunk Actions */}
                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {chunk.status === "ready" && (
                          <button
                            type="button"
                            onClick={() => {
                              if (onPlayChunk) {
                                onPlayChunk(chunk);
                              } else {
                                handlePlayToggle(chunk.id);
                              }
                            }}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                              isPlaying
                                ? "bg-accent text-white font-semibold shadow-2xs"
                                : "bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault/80"
                            }`}
                          >
                            {isPlaying ? (
                              <>
                                <Pause className="w-3.5 h-3.5 fill-current" />
                                <span>{t.jobbar?.pause || "Tạm dừng"}</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5 fill-accent" />
                                <span>{t.tts.preview}</span>
                              </>
                            )}
                          </button>
                        )}

                        {chunk.status === "modified" && (
                          <button
                            onClick={() => handleRegenerateChunk(chunk.id)}
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-warning/15 hover:bg-warning/25 text-warning rounded-md text-xs border border-warning/30 transition-colors font-semibold"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>{t.tts.regenerateChunk}</span>
                          </button>
                        )}

                        {chunk.status === "failed" && (
                          <button
                            onClick={() => handleRegenerateChunk(chunk.id)}
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-danger/15 hover:bg-danger/25 text-danger rounded-md text-xs border border-danger/30 transition-colors font-semibold"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>{t.tts.retry}</span>
                          </button>
                        )}

                        {chunk.status === "ready" && (
                          <button
                            onClick={() => handleRegenerateChunk(chunk.id)}
                            className="flex items-center gap-1 px-2 py-1 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-md text-xs border border-borderDefault transition-colors"
                            title={t.tts.regenerateChunk}
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>{t.tts.regenerateChunk}</span>
                          </button>
                        )}

                        {chunk.status === "pending" && (
                          <button
                            onClick={() => handleRegenerateChunk(chunk.id)}
                            className="flex items-center gap-1 px-2 py-1 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-md text-xs border border-borderDefault transition-colors"
                            title="Tạo audio cho đoạn này"
                          >
                            <Sparkles className="w-3 h-3 text-accent" />
                            <span>Tạo audio</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Clean Reading Text with Dynamic Auto-Resizing Textarea */}
                    <div className="pt-0.5">
                      <AutoResizeTextarea
                        value={chunk.text}
                        onChange={(val) => handleChunkTextChange(chunk.id, val)}
                        className="w-full bg-transparent border-0 px-1 py-1 text-[13px] text-textPrimary leading-[1.6] resize-none focus:outline-none focus:bg-surface2/50 focus:ring-1 focus:ring-accent/40 rounded-md transition-all font-normal overflow-hidden block"
                        placeholder="Nhập nội dung đoạn..."
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Audio Preview Player (Constrained to Central Workspace Area only) */}
            {bottomPlayer && (
              <div className="mx-3 mb-3 shrink-0">
                {bottomPlayer}
              </div>
            )}
          </div>
          {React.isValidElement(inspector)
            ? React.cloneElement(inspector as React.ReactElement<any>, {
                onGenerateAudio: handleGenerateAllAudio,
                isGenerating: isGenerating,
                canGenerate: chunks.length > 0,
                generateTooltip:
                  chunksNeedingGeneration.length === 0
                    ? "Chạy lại toàn bộ audio (ghi đè kết quả cũ)"
                    : t.tts.generateAudio,
                completedCount: completedCount,
                totalCount: effectiveTotal,
                isPaused: isPaused && batchQueueExecutor.isQueuePaused(),
                onTogglePause: onTogglePause,
                onCancel: handleCancelGeneration,
              })
            : inspector}
        </div>
      )}
      </div>

      {/* Text Normalization Modal */}
      <TextNormalizationModal
        isOpen={isNormalizerOpen}
        onClose={() => setIsNormalizerOpen(false)}
        originalText={workingText}
        onApply={handleApplyNormalization}
        language={lang}
        onOpenPronunciationManager={() => {
          setIsNormalizerOpen(false);
          setIsPronunciationModalOpen(true);
        }}
      />

      {/* Pronunciation Manager Modal */}
      <PronunciationManagerModal
        isOpen={isPronunciationModalOpen}
        onClose={() => setIsPronunciationModalOpen(false)}
      />
    </div>
  );
};

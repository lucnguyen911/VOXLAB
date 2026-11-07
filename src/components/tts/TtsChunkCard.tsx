import React from "react";
import {
  Sparkles,
  Play,
  Pause,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
} from "lucide-react";
import { ChunkItem } from "../../types/ui";
import { useI18n } from "../../i18n/context";
import {
  isChunkError,
  isChunkWarning,
  isChunkUnverified,
  isChunkChecking,
  getChunkBadgeInfo,
  getIssueShortLabel,
} from "../../services/audio/qualityValidator";

export const AutoResizeTextarea: React.FC<{
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

export interface TtsChunkCardProps {
  chunk: ChunkItem;
  isSelected: boolean;
  isPlaying: boolean;
  isIssuesExpanded: boolean;
  onSelect: (chunk: ChunkItem) => void;
  onPlay: (chunk: ChunkItem) => void;
  onRegenerate: (id: string) => void;
  onTextChange: (id: string, value: string) => void;
  onToggleIssues: (id: string) => void;
}

/**
 * One studio chunk card. Memoized so that typing in one chunk (or any per-chunk status update)
 * re-renders only that card instead of the whole list — per-keystroke cost used to grow linearly
 * with the number of chunks (Phase 11 benchmark: 319 chunks -> ~1s per keystroke at 4x CPU, dev build).
 * Markup is identical to the previous inline JSX in TtsWorkspace.
 */
export const TtsChunkCard = React.memo(function TtsChunkCard({
  chunk,
  isSelected,
  isPlaying,
  isIssuesExpanded,
  onSelect,
  onPlay,
  onRegenerate,
  onTextChange,
  onToggleIssues,
}: TtsChunkCardProps) {
  const { t } = useI18n();
  const chunkIsError = isChunkError(chunk);
  const chunkIsWarning = isChunkWarning(chunk);
  const badgeInfo = getChunkBadgeInfo(chunk);

  return (
    <div
      onClick={() => onSelect(chunk)}
      className={`p-3 rounded-xl border transition-[border-color,background-color,box-shadow] duration-150 cursor-pointer select-none space-y-2 min-h-[96px] ${
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

          {typeof chunk.durationSec === "number" && !Number.isNaN(chunk.durationSec) && (
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

          {chunkIsError && chunk.status !== "generating" && badgeInfo && (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-md bg-danger/15 text-danger border border-danger/30 flex items-center gap-1.5 shrink-0"
              title={chunk.errorMessage || chunk.qualityReview?.summary || badgeInfo.fullBadgeText}
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{badgeInfo.fullBadgeText}</span>
              <span className="inline sm:hidden">{badgeInfo.compactBadgeText}</span>
            </span>
          )}

          {chunkIsWarning && chunk.status !== "generating" && badgeInfo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleIssues(chunk.id);
              }}
              className="text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/30 flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
              title="Bấm để xem chi tiết vấn đề"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{badgeInfo.fullBadgeText}</span>
              <span className="inline sm:hidden">{badgeInfo.compactBadgeText}</span>
            </button>
          )}


          {isChunkChecking(chunk) && chunk.status !== "generating" && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 flex items-center gap-1.5 shrink-0 animate-pulse"
              title="Đang phân tích chất lượng âm thanh và đối chiếu phụ đề qua ASR..."
            >
              <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
              <span>Đang kiểm tra...</span>
            </span>
          )}

          {isChunkUnverified(chunk) && chunk.status !== "generating" && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-md bg-surface3 text-textSecondary border border-borderDefault flex items-center gap-1.5 shrink-0"
              title={chunk.qualityReview?.summary || "Đoạn âm thanh chưa được kiểm chứng qua ASR"}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-textMuted shrink-0" />
              <span>Chưa kiểm chứng</span>
            </span>
          )}
        </div>

        {/* Right: Chunk Actions */}
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {chunk.status === "ready" && (
            <button
              type="button"
              onClick={() => onPlay(chunk)}
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
              onClick={() => onRegenerate(chunk.id)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-warning/15 hover:bg-warning/25 text-warning rounded-md text-xs border border-warning/30 transition-colors font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t.tts.regenerateChunk}</span>
            </button>
          )}

          {chunkIsError && (
            <button
              onClick={() => onRegenerate(chunk.id)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-danger/15 hover:bg-danger/25 text-danger rounded-md text-xs border border-danger/30 transition-colors font-semibold cursor-pointer"
              title="Thử lại đoạn bị lỗi"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t.tts.retry}</span>
            </button>
          )}

          {chunkIsWarning && (
            <button
              onClick={() => onRegenerate(chunk.id)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 rounded-md text-xs border border-amber-500/30 transition-colors font-semibold cursor-pointer"
              title="Tạo lại đoạn có cảnh báo"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Tạo lại đoạn</span>
            </button>
          )}

          {chunk.status === "ready" && !chunkIsError && !chunkIsWarning && (
            <button
              onClick={() => onRegenerate(chunk.id)}
              className="flex items-center gap-1 px-2 py-1 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-md text-xs border border-borderDefault transition-colors"
              title={t.tts.regenerateChunk}
            >
              <RefreshCw className="w-3 h-3" />
              <span>{t.tts.regenerateChunk}</span>
            </button>
          )}

          {chunk.status === "pending" && (
            <button
              onClick={() => onRegenerate(chunk.id)}
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
          onChange={(val) => onTextChange(chunk.id, val)}
          className="w-full bg-transparent border-0 px-1 py-1 text-[13px] text-textPrimary leading-[1.6] resize-none focus:outline-none focus:bg-surface2/50 focus:ring-1 focus:ring-accent/40 rounded-md transition-all font-normal overflow-hidden block"
          placeholder="Nhập nội dung đoạn..."
        />
      </div>

      {/* Expandable breakdown for detected issues */}
      {chunk.qualityReview?.issues && chunk.qualityReview.issues.length > 0 && (
        <div className="pt-1.5 border-t border-borderDefault/40 text-xs" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                onToggleIssues(chunk.id);
              }}
              className="text-textSecondary hover:text-accent font-medium flex items-center gap-1 cursor-pointer transition-colors"
            >
              <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
              <span>
                {isIssuesExpanded
                  ? "Thu gọn chi tiết"
                  : chunk.qualityReview.issues.length === 1
                  ? "Xem chi tiết vấn đề"
                  : `Xem tất cả ${chunk.qualityReview.issues.length} vấn đề phát hiện`}
              </span>
              <ChevronDown className={`w-3 h-3 transition-transform ${isIssuesExpanded ? "rotate-180" : ""}`} />
            </button>
          </div>
          {isIssuesExpanded && (
            <div className="mt-2 space-y-2 pl-2 border-l-2 border-amber-500/40">
              {chunk.qualityReview.issues.map((iss, idx) => {
                const shortLabel = getIssueShortLabel(iss.code);
                const hasTime = Array.isArray(iss.timeRange) && iss.timeRange.length === 2;
                const timeStr = hasTime
                  ? `${Math.floor(iss.timeRange![0] / 60).toString().padStart(2, "0")}:${Math.floor(iss.timeRange![0] % 60).toString().padStart(2, "0")}`
                  : "";
                return (
                  <div key={idx} className="text-textSecondary leading-snug flex items-start justify-between gap-2 py-0.5">
                    <div className="flex items-start gap-1.5 min-w-0 flex-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded text-[11px]">
                            {shortLabel}
                          </span>
                          {timeStr && (
                            <span className="text-[11px] font-mono text-textMuted bg-surface2 px-1 py-0.5 rounded">
                              {timeStr}
                            </span>
                          )}
                          {iss.words && iss.words.length > 0 && (
                            <span className="text-[11px] text-textSecondary italic">
                              (Từ: {iss.words.join(", ")})
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-textPrimary text-xs">{iss.message}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

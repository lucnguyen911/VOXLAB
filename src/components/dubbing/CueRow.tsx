import React, { useRef, useEffect, useCallback, useState } from "react";
import { Play, Pause, RefreshCw, AlertTriangle, AlertCircle, ChevronDown } from "lucide-react";
import {
  OriginalCue,
  TranslatedCue,
  DubAudioSegment,
  TimingOverflowMetadata,
  DubbingMode,
} from "../../types/dubbing";
import { formatSrtTimestamp } from "../../services/subtitle/exporter";
import {
  isChunkError,
  isChunkWarning,
  isChunkChecking,
  isChunkUnverified,
  getChunkBadgeInfo,
  getIssueShortLabel,
} from "../../services/audio/qualityValidator";

export interface CueRowProps {
  original: OriginalCue;
  translated: TranslatedCue;
  audioSegment?: DubAudioSegment;
  overflowMeta?: TimingOverflowMetadata;
  dubbingMode?: DubbingMode;
  narrationSourceCueCount?: number;
  isPlaying?: boolean;
  onUpdateText: (index: number, newText: string) => void;
  onPlayAudio?: (index: number) => void;
  onRegenerateAudio?: (index: number) => void;
}

export const CueRow: React.FC<CueRowProps> = ({
  original,
  translated,
  audioSegment,
  overflowMeta,
  dubbingMode = "source_sync",
  narrationSourceCueCount,
  isPlaying = false,
  onUpdateText,
  onPlayAudio,
  onRegenerateAudio,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isIssuesExpanded, setIsIssuesExpanded] = useState(false);
  const availableDuration = Number((original.endSec - original.startSec).toFixed(2));

  // Auto-resize textarea height
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [translated.text, adjustHeight]);

  const segIsError = audioSegment ? isChunkError(audioSegment) : false;
  const segIsWarning = audioSegment ? isChunkWarning(audioSegment) : false;
  const segIsChecking = audioSegment ? isChunkChecking(audioSegment) : false;
  const segIsUnverified = audioSegment ? isChunkUnverified(audioSegment) : false;
  const badgeInfo = audioSegment ? getChunkBadgeInfo(audioSegment) : null;
  const hasTranslatedContent = Boolean(
    (translated.text && translated.text.trim().length > 0) ||
      translated.isEdited ||
      audioSegment
  );
  const formattedIndex = String(original.index).padStart(2, "0");

  // Audio status pill rendering
  const renderAudioStatusBadge = () => {
    if (!audioSegment) return null;
    const status = audioSegment.status;
    switch (status) {
      case "ready": {
        const hasStretch =
          dubbingMode !== "free_narration" &&
          audioSegment.speedFactor &&
          audioSegment.speedFactor > 1.02;
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {audioSegment.fittedDurationSec ? `${audioSegment.fittedDurationSec}s` : "Sẵn sàng"}
            </span>
            {hasStretch && (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface3 text-textSecondary border border-borderDefault"
                title={`Tốc độ đọc thích ứng: ${audioSegment.speedFactor}x`}
              >
                ⚡ {audioSegment.speedFactor}x
              </span>
            )}
            {segIsError && badgeInfo && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/30 flex items-center gap-1"
                title={audioSegment.errorMessage || audioSegment.qualityReview?.summary || badgeInfo.fullBadgeText}
              >
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>{badgeInfo.fullBadgeText}</span>
              </span>
            )}
            {segIsWarning && badgeInfo && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsIssuesExpanded((prev) => !prev);
                }}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 flex items-center gap-1 transition-colors cursor-pointer"
                title="Bấm để xem chi tiết vấn đề chất lượng âm thanh"
              >
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>{badgeInfo.fullBadgeText}</span>
              </button>
            )}
            {segIsChecking && (
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 flex items-center gap-1 animate-pulse"
                title="Đang phân tích chất lượng âm thanh và đối chiếu phụ đề qua ASR..."
              >
                <RefreshCw className="w-2.5 h-2.5 animate-spin text-cyan-400" />
                <span>Đang kiểm tra...</span>
              </span>
            )}
            {segIsUnverified && (
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface3 text-textSecondary border border-borderDefault flex items-center gap-1"
                title={audioSegment.qualityReview?.summary || "Đoạn âm thanh chưa được kiểm chứng qua ASR"}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-textMuted shrink-0" />
                <span>Chưa kiểm chứng</span>
              </span>
            )}
          </div>
        );
      }
      case "generating":
        return (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30 animate-pulse flex items-center gap-1">
            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
            Đang tạo...
          </span>
        );
      case "modified":
        return (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Đã sửa text
          </span>
        );
      case "needs_generation":
        return (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
            Cần tạo audio
          </span>
        );
      case "failed":
        return (
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1"
            title={audioSegment.errorMessage || "Lỗi tạo âm thanh"}
          >
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span>{badgeInfo?.fullBadgeText || "Lỗi tạo"}</span>
          </span>
        );
      case "idle":
      default:
        return null;
    }
  };

  return (
    <div
      data-cue-index={original.index}
      className={`grid grid-cols-1 md:grid-cols-2 gap-3 transition-all ${
        isPlaying ? "ring-1 ring-accent/60 rounded-xl" : ""
      }`}
    >
      {/* CỘT 1: KỊCH BẢN GỐC (Read-only, Immutable Timestamps) */}
      <div
        className={`p-3 bg-surface1 rounded-xl border transition-all flex flex-col justify-between gap-2 shadow-2xs select-text ${
          isPlaying ? "border-accent shadow-sm" : "border-borderDefault hover:border-accent/40"
        }`}
      >
        {/* Top Header: Index & Timestamps & Duration */}
        <div className="flex items-center justify-between text-[11px] font-mono text-textMuted select-none flex-shrink-0 h-5">
          <div className="flex items-center gap-2">
            <span className="font-bold text-accent">{formattedIndex}</span>
            <span>
              {formatSrtTimestamp(original.startSec)} → {formatSrtTimestamp(original.endSec)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {dubbingMode === "free_narration" && narrationSourceCueCount && narrationSourceCueCount > 1 && (
              <span className="px-1.5 py-0.5 bg-surface2 rounded text-textSecondary text-[10px] font-sans">
                Gộp {narrationSourceCueCount} câu
              </span>
            )}
            <span className="px-1.5 py-0.5 bg-surface2 rounded text-textSecondary text-[10px]">
              {availableDuration}s
            </span>
          </div>
        </div>

        {/* Middle Body: Text vertically centered */}
        <div className="flex-1 flex items-center py-0.5">
          <div className="w-full bg-surface2/50 border border-borderDefault/60 rounded-lg px-2.5 py-1.5 text-xs text-textPrimary leading-relaxed font-sans select-text whitespace-pre-wrap">
            {original.text}
          </div>
        </div>
      </div>

      {/* CỘT 2: BẢN DỊCH (Chỉ hiển thị khi câu đã được dịch hoặc chỉnh sửa) */}
      {hasTranslatedContent ? (
        <div
          className={`p-3 bg-surface1 rounded-xl border transition-all flex flex-col justify-between gap-2 shadow-2xs ${
            isPlaying ? "border-accent shadow-sm" : "border-borderDefault hover:border-accent/40"
          }`}
        >
          {/* Top Header: Status Badges, Overflows & Audio Playback if exists */}
          <div className="flex items-center justify-between gap-2 select-none flex-shrink-0 min-h-[20px] flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono font-bold text-accent">
                {formattedIndex}
              </span>
              {audioSegment?.groupCueIndices && audioSegment.groupCueIndices.length > 1 && (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/25"
                  title={`Đoạn thuyết minh gộp liền mạch các câu ${audioSegment.groupCueIndices[0]}–${audioSegment.groupCueIndices[audioSegment.groupCueIndices.length - 1]}`}
                >
                  {audioSegment.isGroupPrimary === false ? "↳ " : ""}
                  Nhóm {audioSegment.groupCueIndices[0]}–{audioSegment.groupCueIndices[audioSegment.groupCueIndices.length - 1]}
                </span>
              )}
              {renderAudioStatusBadge()}
              {translated.projectionNeedsReview && (
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/25"
                  title="Câu dịch theo ngữ cảnh cần kiểm tra nhanh vị trí ngắt dòng phụ đề"
                >
                  Cần rà soát tách câu
                </span>
              )}
              {translated.isEdited && (
                <span className="text-[10px] text-accent font-medium">
                  • Đã chỉnh sửa
                </span>
              )}
            </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Timing overflow and collision indicator badges (hidden in free_narration mode) */}
            {dubbingMode !== "free_narration" &&
              overflowMeta &&
              overflowMeta.warningLevel !== "none" && (
              <div className="flex items-center gap-1">
                {overflowMeta.warningLevel === "overflow_only" && (
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1"
                    title={`Âm thanh dài hơn câu ${overflowMeta.overflowSec}s nhưng không chạm câu sau`}
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Tràn +{overflowMeta.overflowSec}s (hợp lệ)
                  </span>
                )}
                {overflowMeta.warningLevel === "collision_danger" && (
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/40 flex items-center gap-1"
                    title={`Va chạm ${overflowMeta.collisionSec}s với câu #${overflowMeta.collisionWithIndex}`}
                  >
                    <AlertCircle className="w-3 h-3" />
                    Va chạm câu #{overflowMeta.collisionWithIndex} (+{overflowMeta.collisionSec}s)
                  </span>
                )}
              </div>
            )}

            {/* Single cue generate / regenerate button */}
            {onRegenerateAudio && (
              <button
                type="button"
                onClick={() => onRegenerateAudio(original.index)}
                disabled={audioSegment?.status === "generating"}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                  segIsError
                    ? "bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30 font-semibold"
                    : segIsWarning
                    ? "bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 font-semibold"
                    : "bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary"
                }`}
                title={audioSegment?.status === "ready" ? "Tạo lại âm thanh cho câu này" : "Tạo âm thanh cho câu này"}
              >
                <RefreshCw className={`w-2.5 h-2.5 ${audioSegment?.status === "generating" ? "animate-spin text-accent" : ""}`} />
                <span>
                  {audioSegment?.status === "generating"
                    ? "Đang tạo..."
                    : segIsError
                    ? "Thử lại"
                    : audioSegment?.status === "ready"
                    ? "Tạo lại"
                    : "Tạo audio"}
                </span>
              </button>
            )}

            {/* Audio Playback button only if audio file exists */}
            {audioSegment && (audioSegment.fittedAudioUrl || audioSegment.audioUrl) && (
              <button
                type="button"
                onClick={() => onPlayAudio?.(original.index)}
                className="flex items-center gap-1 px-2 py-0.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded text-[10px] font-medium transition-colors cursor-pointer"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-2.5 h-2.5 text-accent" />
                    <span>Dừng</span>
                  </>
                ) : (
                  <>
                    <Play className="w-2.5 h-2.5 text-accent" />
                    <span>Nghe thử</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Middle Body: Textarea vertically centered */}
        <div className="flex-1 flex items-center py-0.5">
          <textarea
            ref={textareaRef}
            rows={1}
            value={translated.text}
            onChange={(e) => {
              onUpdateText(original.index, e.target.value);
              adjustHeight();
            }}
            className="w-full bg-surface2/50 hover:bg-surface2 focus:bg-surface2 border border-borderDefault/60 focus:border-accent rounded-lg px-2.5 py-1.5 text-xs text-textPrimary leading-relaxed focus:outline-none resize-none overflow-hidden transition-colors font-sans cursor-text caret-accent"
            style={{ overflow: "hidden" }}
            placeholder="Nhập nội dung bản dịch..."
          />
        </div>

        {/* Expandable breakdown for detected quality issues */}
        {audioSegment?.qualityReview?.issues && audioSegment.qualityReview.issues.length > 0 && (
          <div className="pt-1.5 border-t border-borderDefault/40 text-xs" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setIsIssuesExpanded((prev) => !prev)}
                className="text-textSecondary hover:text-accent font-medium flex items-center gap-1 cursor-pointer transition-colors"
              >
                <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                <span>
                  {isIssuesExpanded
                    ? "Thu gọn chi tiết"
                    : audioSegment.qualityReview.issues.length === 1
                    ? "Xem chi tiết vấn đề"
                    : `Xem tất cả ${audioSegment.qualityReview.issues.length} vấn đề phát hiện`}
                </span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isIssuesExpanded ? "rotate-180" : ""}`} />
              </button>
            </div>
            {isIssuesExpanded && (
              <div className="mt-2 space-y-2 pl-2 border-l-2 border-amber-500/40">
                {audioSegment.qualityReview.issues.map((iss, idx) => {
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
      ) : (
        <div className="hidden md:block" aria-hidden="true" />
      )}
    </div>
  );
};

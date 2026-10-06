import React, { useRef, useEffect, useCallback } from "react";
import { Play, Pause, RefreshCw, AlertTriangle, AlertCircle } from "lucide-react";
import {
  OriginalCue,
  TranslatedCue,
  DubAudioSegment,
  TimingOverflowMetadata,
} from "../../types/dubbing";
import { formatSrtTimestamp } from "../../services/subtitle/exporter";

export interface CueRowProps {
  original: OriginalCue;
  translated: TranslatedCue;
  audioSegment?: DubAudioSegment;
  overflowMeta?: TimingOverflowMetadata;
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
  isPlaying = false,
  onUpdateText,
  onPlayAudio,
  onRegenerateAudio: _onRegenerateAudio,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  // Audio status pill rendering
  const renderAudioStatusBadge = () => {
    if (!audioSegment) return null;
    const status = audioSegment.status;
    switch (status) {
      case "ready": {
        const hasStretch = audioSegment.speedFactor && audioSegment.speedFactor > 1.02;
        return (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Sẵn sàng ({audioSegment.fittedDurationSec ? `${audioSegment.fittedDurationSec}s` : ""})
            </span>
            {hasStretch && (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface3 text-textSecondary border border-borderDefault"
                title={`Tốc độ đọc thích ứng: ${audioSegment.speedFactor}x`}
              >
                ⚡ {audioSegment.speedFactor}x
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
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
            Lỗi tạo
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
            <span className="font-bold text-accent">#{String(original.index).padStart(2, "0")}</span>
            <span>
              {formatSrtTimestamp(original.startSec)} → {formatSrtTimestamp(original.endSec)}
            </span>
          </div>
          <span className="px-1.5 py-0.5 bg-surface2 rounded text-textSecondary text-[10px]">
            {availableDuration}s
          </span>
        </div>

        {/* Middle Body: Text vertically centered */}
        <div className="flex-1 flex items-center py-0.5">
          <div className="w-full bg-surface2/50 border border-borderDefault/60 rounded-lg px-2.5 py-1.5 text-xs text-textPrimary leading-relaxed font-sans select-text whitespace-pre-wrap">
            {original.text}
          </div>
        </div>
      </div>

      {/* CỘT 2: BẢN DỊCH (Pure Text Editing & Optional Audio Playback) */}
      <div
        className={`p-3 bg-surface1 rounded-xl border transition-all flex flex-col justify-between gap-2 shadow-2xs ${
          isPlaying ? "border-accent shadow-sm" : "border-borderDefault hover:border-accent/40"
        }`}
      >
        {/* Top Header: Status Badges, Overflows & Audio Playback if exists */}
        <div className="flex items-center justify-between gap-2 select-none flex-shrink-0 h-5">
          <div className="flex items-center gap-2">
            {renderAudioStatusBadge()}
            {translated.isEdited && (
              <span className="text-[10px] text-accent font-medium">
                • Đã chỉnh sửa
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Timing overflow and collision indicator badges */}
            {overflowMeta && overflowMeta.warningLevel !== "none" && (
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
      </div>
    </div>
  );
};

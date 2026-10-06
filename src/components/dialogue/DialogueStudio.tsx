import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  Layers,
  AlertCircle,
  Play,
  Pause,
  RefreshCw,
  Sparkles,
  Clock,
  ArrowLeft,
  UploadCloud,
  Volume2,
} from "lucide-react";
import { DialogueCharacter, DialogueSegment } from "../../types/dialogue";
import { VoiceProfile } from "../../types/ui";
import { parsePauseDurationMs } from "../../services/pause";

const AutoResizeTextarea: React.FC<{
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}> = ({ value, onChange, className, placeholder }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
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

export interface DialogueStudioProps {
  segments: DialogueSegment[];
  characters: DialogueCharacter[];
  voices: VoiceProfile[];
  selectedSegmentId: string | null;
  onSelectSegment: (seg: DialogueSegment) => void;
  activePlayingSegmentId: string | null;
  isPlayingSegment: boolean;
  onPlaySegment: (seg: DialogueSegment) => void;
  onRegenerateSegment: (segmentId: string) => void;
  onSegmentTextChange: (segmentId: string, newText: string) => void;
  onOpenVoicePickerForCharacter?: (characterId: string) => void;
  bottomPlayer?: React.ReactNode;
  onNavigateToPrep?: () => void;
  onDropFile?: (file: File) => void;
  onRegenerateInvalid?: () => void;
  isConverting?: boolean;
}

export const DialogueStudio: React.FC<DialogueStudioProps> = ({
  segments,
  characters,
  voices,
  selectedSegmentId,
  onSelectSegment,
  activePlayingSegmentId,
  isPlayingSegment,
  onPlaySegment,
  onRegenerateSegment,
  onSegmentTextChange,
  onOpenVoicePickerForCharacter,
  bottomPlayer,
  onNavigateToPrep,
  onDropFile,
  onRegenerateInvalid,
  isConverting = false,
}) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Fast lookups
  const charMap = new Map(characters.map((c) => [c.id, c]));
  const voiceMap = new Map(voices.map((v) => [v.id, v]));

  const failedCount = segments.filter((s) => s.status === "failed").length;
  const modifiedCount = segments.filter((s) => s.status === "modified").length;
  const readyCount = segments.filter((s) => s.status === "ready").length;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && onDropFile) {
          onDropFile(file);
        }
      }}
      className="flex-1 flex flex-col h-full overflow-hidden min-h-0 min-w-0 relative"
    >
      {/* Drag Overlay Feedback */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-surface1/90 backdrop-blur-xs pointer-events-none border-2 border-dashed border-accent m-3 rounded-xl">
          <UploadCloud className="w-8 h-8 text-accent animate-bounce mb-2" />
          <span className="text-sm font-semibold text-textPrimary">Thả file kịch bản vào đây để nạp</span>
          <span className="text-xs text-textMuted mt-1">Hỗ trợ .docx, .txt, .md, .srt, .vtt</span>
        </div>
      )}

      {/* Header Info Bar matching TTS Studio */}
      <div className="flex items-center justify-between text-xs text-textMuted px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-2 font-mono text-xs">
          <Layers className="w-3.5 h-3.5 text-accent" />
          <span className="font-semibold text-textPrimary">
            {segments.length} câu thoại
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {readyCount > 0 && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-success/15 border border-success/30 text-success font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span>{readyCount} sẵn sàng</span>
            </span>
          )}
          {failedCount > 0 && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-danger/15 border border-danger/30 text-danger font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-danger" />
              <span>{failedCount} lỗi</span>
            </span>
          )}
          {modifiedCount > 0 && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-warning/15 border border-warning/30 text-warning font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-warning" />
              <span>{modifiedCount} đã sửa</span>
            </span>
          )}
          {onRegenerateInvalid && (failedCount > 0 || modifiedCount > 0) && (
            <button
              type="button"
              onClick={onRegenerateInvalid}
              disabled={isConverting}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-accent hover:bg-accentHover text-white shadow-xs rounded-md text-xs font-semibold transition-all whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ml-1 active:scale-95"
              title="Chỉ tạo lại các đoạn đã chỉnh sửa hoặc bị lỗi"
            >
              <RefreshCw className="w-3 h-3 text-white" />
              <span>Tạo lại ({failedCount + modifiedCount}) đoạn sửa</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Studio Body: List of Segments */}
      <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-2.5 pr-3 min-h-0">
        {segments.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center border border-dashed border-borderDefault rounded-xl p-6 text-center text-xs text-textMuted space-y-3 bg-surface1/30">
            <Layers className="w-8 h-8 text-accent/50" />
            <div className="space-y-1">
              <p className="font-medium text-textPrimary text-sm">Chưa có phân đoạn hội thoại nào</p>
              <p className="text-textSecondary">
                Hãy chuyển sang tab "Soạn thảo" và nhập kịch bản theo định dạng: <span className="font-mono text-accent">[Tên]: Lời thoại</span>
              </p>
            </div>
            {onNavigateToPrep && (
              <button
                type="button"
                onClick={onNavigateToPrep}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accentHover text-white rounded-lg font-medium transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Chuyển sang Soạn thảo</span>
              </button>
            )}
          </div>
        ) : (
          segments.map((seg) => {
            const isSelected = selectedSegmentId === seg.id;
            const isPlaying = activePlayingSegmentId === seg.id && isPlayingSegment;
            const char = charMap.get(seg.characterId);
            const voice = char?.voiceId ? voiceMap.get(char.voiceId) : null;
            const voiceName = voice?.name || "Mặc định";
            const theme = char?.colorTheme;
            const pauseMs = parsePauseDurationMs(seg.rawText) || 0;

            // Estimated or real duration
            const wordCount = seg.cleanText.split(/\s+/).filter(Boolean).length;
            const speed = char?.speed ?? 1.0;
            const durationSec = seg.durationSec || Math.max(1.0, (wordCount / 3.4) / speed + (pauseMs / 1000));

            return (
              <div
                key={seg.id}
                onClick={() => onSelectSegment(seg)}
                className={`p-3 rounded-xl border transition-[border-color,background-color,box-shadow] duration-150 cursor-pointer select-text space-y-2 min-h-[96px] ${
                  isPlaying
                    ? "bg-accent/[0.06] border-accent/60 shadow-xs ring-1 ring-accent/30"
                    : isSelected
                    ? "bg-accent/[0.04] border-accent/45 shadow-2xs"
                    : "bg-surface1 hover:bg-surface2/30 border-borderDefault hover:border-textMuted/40 shadow-2xs"
                }`}
              >
                {/* Top Row: Index, Character Tag, Voice, Duration, Status & Action Buttons */}
                <div className="min-h-[28px] flex items-center justify-between gap-3">
                  {/* Left Badges */}
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {/* Index */}
                    <span className="font-mono text-xs font-bold text-accent px-1.5 py-0.5 rounded-md bg-surface3/80 shrink-0">
                      #{String(seg.index).padStart(2, "0")}
                    </span>

                    {/* Character Tag with their assigned color theme */}
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-md shrink-0 transition-colors ${
                        theme?.badgeClass || "bg-accent/15 text-accent border border-accent/30"
                      }`}
                    >
                      [{seg.characterName}]
                    </span>

                    {/* Voice Selection Button Pill */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenVoicePickerForCharacter?.(seg.characterId);
                      }}
                      className="text-[11px] text-textSecondary hover:text-accent font-medium bg-surface2 hover:bg-surface3 px-2 py-0.5 rounded-md border border-borderDefault/60 hover:border-accent/40 truncate max-w-[170px] shrink-0 transition-colors cursor-pointer flex items-center gap-1 group/voice"
                      title={`Đổi giọng đọc cho [${seg.characterName}]: ${voiceName}`}
                    >
                      <Volume2 className="w-3 h-3 text-textMuted group-hover/voice:text-accent shrink-0" />
                      <span className="truncate">{voiceName}</span>
                    </button>

                    {/* Duration & Live Playing indicator */}
                    <div className="flex items-center gap-1 shrink-0 font-mono text-xs">
                      <span className={`font-medium ${isPlaying ? "text-accent font-semibold" : "text-textMuted"}`}>
                        {durationSec.toFixed(1)}s
                      </span>
                      {isPlaying && (
                        <div className="flex items-end gap-[1.5px] h-3 px-0.5" title="Đang phát">
                          <div className="w-[2px] bg-accent rounded-full animate-eq-1" />
                          <div className="w-[2px] bg-accent rounded-full animate-eq-2" />
                          <div className="w-[2px] bg-accent rounded-full animate-eq-3" />
                        </div>
                      )}
                    </div>

                    {/* Pause token badge */}
                    {pauseMs > 0 && (
                      <span
                        className="font-mono text-xs font-semibold text-accent px-1.5 py-0.5 rounded-md bg-accent/10 border border-accent/25 shrink-0 flex items-center gap-1"
                        title={`Khoảng dừng: ${pauseMs}ms`}
                      >
                        <Clock className="w-3 h-3 text-accent" />
                        <span>{(pauseMs / 1000).toFixed(1)}s pause</span>
                      </span>
                    )}

                    {/* Non-normal state badges */}
                    {seg.status === "generating" && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/30 animate-pulse flex items-center gap-1.5 shrink-0">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Đang tạo...</span>
                      </span>
                    )}

                    {seg.status === "modified" && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-warning/15 text-warning border border-warning/30 flex items-center gap-1 shrink-0">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Đã sửa</span>
                      </span>
                    )}

                    {seg.status === "failed" && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-danger/15 text-danger border border-danger/30 flex items-center gap-1.5 shrink-0">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Thất bại</span>
                        {seg.errorMessage && (
                          <span className="font-normal opacity-90">· {seg.errorMessage}</span>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Right Actions */}
                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Play / Preview Segment Button */}
                    <button
                      type="button"
                      onClick={() => onPlaySegment(seg)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                        isPlaying
                          ? "bg-accent text-white font-semibold shadow-2xs"
                          : "bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault/80"
                      }`}
                      title={isPlaying ? "Tạm dừng đoạn này" : "Nghe thử đoạn này"}
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5 fill-current" />
                          <span>Tạm dừng</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-accent" />
                          <span>Nghe thử</span>
                        </>
                      )}
                    </button>

                    {/* Regenerate Segment Button */}
                    {seg.status === "modified" && (
                      <button
                        type="button"
                        onClick={() => onRegenerateSegment(seg.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-warning/15 hover:bg-warning/25 text-warning rounded-md text-xs border border-warning/30 transition-colors font-semibold cursor-pointer"
                        title="Tạo lại đoạn vừa chỉnh sửa"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Tạo lại</span>
                      </button>
                    )}

                    {seg.status === "failed" && (
                      <button
                        type="button"
                        onClick={() => onRegenerateSegment(seg.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-danger/15 hover:bg-danger/25 text-danger rounded-md text-xs border border-danger/30 transition-colors font-semibold cursor-pointer"
                        title="Thử lại đoạn này"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Thử lại</span>
                      </button>
                    )}

                    {seg.status === "ready" && (
                      <button
                        type="button"
                        onClick={() => onRegenerateSegment(seg.id)}
                        className="flex items-center gap-1 px-2 py-1 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-md text-xs border border-borderDefault transition-colors cursor-pointer"
                        title="Tạo lại âm thanh đoạn này"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Tạo lại</span>
                      </button>
                    )}

                    {seg.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => onRegenerateSegment(seg.id)}
                        className="flex items-center gap-1 px-2 py-1 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary rounded-md text-xs border border-borderDefault transition-colors cursor-pointer"
                        title="Tạo audio cho đoạn này"
                      >
                        <Sparkles className="w-3 h-3 text-accent" />
                        <span>Tạo audio</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Bottom Row: Editable Dialogue Line Text */}
                <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                  <AutoResizeTextarea
                    value={seg.rawText}
                    onChange={(val) => onSegmentTextChange(seg.id, val)}
                    className="w-full bg-transparent border-0 px-1 py-1 text-[13px] text-textPrimary leading-[1.6] resize-none focus:outline-none focus:bg-surface2/50 focus:ring-1 focus:ring-accent/40 rounded-md transition-all font-normal overflow-hidden block"
                    placeholder="Nhập nội dung câu thoại..."
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Audio Player if provided */}
      {bottomPlayer && (
        <div className="mx-3 mb-3 shrink-0">
          {bottomPlayer}
        </div>
      )}
    </div>
  );
};

import React from "react";
import {
  OriginalCue,
  TranslatedCue,
  DubAudioSegment,
  TimingOverflowMetadata,
} from "../../types/dubbing";
import { CueRow } from "./CueRow";
import { Zap, UploadCloud } from "lucide-react";
import { useI18n } from "../../i18n/context";

export interface ReviewGridProps {
  originalCues: OriginalCue[];
  translatedCues: TranslatedCue[];
  audioSegments: Record<number, DubAudioSegment>;
  overflowAnalysis: Record<number, TimingOverflowMetadata>;
  playingCueIndex?: number | null;
  collidingCount?: number;
  onUpdateText: (index: number, newText: string) => void;
  onPlayAudio?: (index: number) => void;
  onRegenerateAudio?: (index: number) => void;
  onAutoFitAll?: () => void;
  onSelectFile?: () => void;
  isDragging?: boolean;
  bottomPlayer?: React.ReactNode;
}

export const ReviewGrid: React.FC<ReviewGridProps> = ({
  originalCues,
  translatedCues,
  audioSegments,
  overflowAnalysis,
  playingCueIndex,
  collidingCount = 0,
  onUpdateText,
  onPlayAudio,
  onRegenerateAudio,
  onAutoFitAll,
  onSelectFile,
  isDragging = false,
  bottomPlayer,
}) => {
  const { lang } = useI18n();

  if (!originalCues || originalCues.length === 0) {
    return (
      <div className="flex-1 flex flex-col p-4 sm:p-6 select-none overflow-hidden bg-background">
        <div
          onClick={onSelectFile}
          className={`flex-1 w-full rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center p-6 sm:p-10 transition-all cursor-pointer group ${
            isDragging
              ? "border-accent bg-accent/10 scale-[0.995]"
              : "border-borderDefault bg-surface1/30 hover:bg-surface1/60 hover:border-accent/50"
          }`}
        >
          <h3 className="text-xl sm:text-2xl font-bold text-textPrimary mb-6 tracking-tight">
            {lang === "vi"
              ? "Kéo thả tệp hoặc thư mục phụ đề vào đây"
              : lang === "en"
              ? "Drag and drop subtitle file or folder here"
              : lang === "ja"
              ? "ここに字幕ファイルまたはフォルダをドラッグ＆ドロップ"
              : "将字幕文件或文件夹拖放到此处"}
          </h3>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectFile?.();
            }}
            className="px-8 py-3.5 bg-accent hover:bg-accent/90 text-background rounded-xl font-semibold text-sm sm:text-base shadow-md hover:shadow-lg transition-all flex items-center gap-2.5 cursor-pointer active:scale-95"
          >
            <UploadCloud className="w-5 h-5" />
            <span>Tải Lên</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Grid Column Headers */}
      <div className="px-4 py-2 bg-surface2/40 border-b border-borderDefault grid grid-cols-1 md:grid-cols-2 gap-3 text-xs select-none flex-shrink-0">
        <div className="flex items-center px-1">
          <span className="font-bold text-textPrimary text-xs">Kịch bản gốc</span>
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="font-bold text-textPrimary text-xs">Bản Dịch</span>
          {collidingCount > 0 && onAutoFitAll && (
            <button
              type="button"
              onClick={onAutoFitAll}
              className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs animate-in fade-in"
              title="Tự động co giãn tốc độ các câu bị va chạm để khớp vừa khít với thời lượng"
            >
              <Zap className="w-3 h-3 text-amber-400" />
              <span>Tự động khớp thời lượng ({collidingCount} câu)</span>
            </button>
          )}
        </div>
      </div>

      {/* Cues Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {originalCues.map((orig, i) => {
          const trans = translatedCues[i] || {
            index: orig.index,
            startSec: orig.startSec,
            endSec: orig.endSec,
            originalText: orig.text,
            text: orig.text,
          };

          return (
            <CueRow
              key={orig.index}
              original={orig}
              translated={trans}
              audioSegment={audioSegments[orig.index]}
              overflowMeta={overflowAnalysis[orig.index]}
              isPlaying={playingCueIndex === orig.index}
              onUpdateText={onUpdateText}
              onPlayAudio={onPlayAudio}
              onRegenerateAudio={onRegenerateAudio}
            />
          );
        })}
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

import React, { useState, useEffect } from "react";
import {
  OriginalCue,
  TranslatedCue,
  DubAudioSegment,
  TimingOverflowMetadata,
  DubbingMode,
  DubbingSpeechGroup,
} from "../../types/dubbing";
import { CueRow } from "./CueRow";
import { Zap, UploadCloud, RefreshCw, FileText, List } from "lucide-react";
import { useI18n } from "../../i18n/context";
import { countChunkQualityIssues } from "../../services/audio/qualityValidator";
import {
  reconstructFreeNarrationScript,
  buildTranslatedNarrationScriptText,
} from "../../services/dubbing/freeNarrationScript";

export interface ReviewGridProps {
  originalCues: OriginalCue[];
  translatedCues: TranslatedCue[];
  speechGroups?: DubbingSpeechGroup[];
  audioSegments: Record<number, DubAudioSegment>;
  overflowAnalysis: Record<number, TimingOverflowMetadata>;
  dubbingMode?: DubbingMode;
  playingCueIndex?: number | null;
  collidingCount?: number;
  isGeneratingAudio?: boolean;
  onUpdateText: (index: number, newText: string) => void;
  onUpdateGroupText?: (groupId: string, newText: string) => void;
  onUpdateFullNarrationScript?: (fullScriptText: string) => void;
  onPlayAudio?: (index: number) => void;
  onRegenerateAudio?: (index: number) => void;
  onRegenerateErrors?: () => void;
  onRegenerateWarnings?: () => void;
  onAutoFitAll?: () => void;
  onSelectFile?: () => void;
  isDragging?: boolean;
  bottomPlayer?: React.ReactNode;
}

export const ReviewGrid: React.FC<ReviewGridProps> = ({
  originalCues,
  translatedCues,
  speechGroups = [],
  audioSegments,
  overflowAnalysis,
  dubbingMode = "source_sync",
  playingCueIndex,
  collidingCount = 0,
  isGeneratingAudio = false,
  onUpdateText,
  onUpdateGroupText,
  onUpdateFullNarrationScript,
  onPlayAudio,
  onRegenerateAudio,
  onRegenerateErrors,
  onRegenerateWarnings,
  onAutoFitAll,
  onSelectFile,
  isDragging = false,
  bottomPlayer,
}) => {
  const { lang } = useI18n();
  const [isFullTxtEditorOpen, setIsFullTxtEditorOpen] = useState(false);
  const [draftFullScript, setDraftFullScript] = useState("");

  const isFreeNarration = dubbingMode === "free_narration";
  const activeNarrationGroups: DubbingSpeechGroup[] =
    isFreeNarration && speechGroups.length > 0
      ? speechGroups
      : isFreeNarration
      ? reconstructFreeNarrationScript(originalCues, translatedCues, audioSegments).groups
      : [];

  useEffect(() => {
    if (!isFreeNarration) {
      setIsFullTxtEditorOpen(false);
      return;
    }
    setDraftFullScript(
      buildTranslatedNarrationScriptText(activeNarrationGroups, translatedCues)
    );
  }, [isFreeNarration, speechGroups, translatedCues]);

  const primarySegments = Object.values(audioSegments).filter(
    (s) => s.isGroupPrimary !== false
  );
  const qualityStats = countChunkQualityIssues(primarySegments);
  const hasReadyAudio = primarySegments.some((s) => s.status === "ready");
  const hasAnyTranslatedText =
    translatedCues.some((c) => Boolean(c.text && c.text.trim().length > 0)) ||
    activeNarrationGroups.some((g) =>
      Boolean((g.translatedText || g.speechText || "").trim().length > 0)
    );

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

  const reconstructedSourceTxt = isFreeNarration
    ? activeNarrationGroups.map((g) => g.sourceText).filter(Boolean).join("\n\n")
    : "";

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Grid Column Headers */}
      <div className="px-4 py-2 bg-surface2/40 border-b border-borderDefault grid grid-cols-1 md:grid-cols-2 gap-3 text-xs select-none flex-shrink-0">
        <div className="flex items-center justify-between px-1 gap-2">
          <span className="font-bold text-textPrimary text-xs">
            Bản gốc
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap px-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-textPrimary text-xs">
              Bản dịch
            </span>
            {hasReadyAudio && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {qualityStats.passCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                    title="Số câu thoại đạt chuẩn hậu kiểm"
                  >
                    Đạt: {qualityStats.passCount}
                  </span>
                )}
                {qualityStats.warningCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20"
                    title="Số câu thoại có cảnh báo cần lưu ý"
                  >
                    Cảnh báo: {qualityStats.warningCount}
                  </span>
                )}
                {qualityStats.errorCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/20"
                    title="Số câu thoại bị lỗi nghiêm trọng cần tạo lại"
                  >
                    Lỗi: {qualityStats.errorCount}
                  </span>
                )}
                {qualityStats.checkingCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20"
                    title="Số câu thoại đang hậu kiểm ASR"
                  >
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    Đang kiểm tra: {qualityStats.checkingCount}
                  </span>
                )}
                {qualityStats.unverifiedCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/25"
                    title="Số câu thoại chưa được ASR hậu kiểm đầy đủ"
                  >
                    Chưa kiểm chứng: {qualityStats.unverifiedCount}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {isFreeNarration && hasAnyTranslatedText && (
              <button
                type="button"
                onClick={() => setIsFullTxtEditorOpen((prev) => !prev)}
                className="flex items-center gap-1 px-2 py-0.5 bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault rounded text-[11px] font-semibold transition-colors cursor-pointer"
                title={
                  isFullTxtEditorOpen
                    ? "Chuyển về chế độ xem theo từng đoạn câu thuyết minh"
                    : "Chỉnh sửa toàn bộ kịch bản thuyết minh dạng văn bản TXT liền mạch"
                }
              >
                {isFullTxtEditorOpen ? (
                  <>
                    <List className="w-3 h-3 text-accent" />
                    <span>Theo đoạn câu</span>
                  </>
                ) : (
                  <>
                    <FileText className="w-3 h-3 text-accent" />
                    <span>Soạn kịch bản TXT liền mạch</span>
                  </>
                )}
              </button>
            )}
            {qualityStats.errorCount > 0 && onRegenerateErrors && (
              <button
                type="button"
                disabled={isGeneratingAudio}
                onClick={onRegenerateErrors}
                className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                title="Chỉ tạo lại các câu bị lỗi nghiêm trọng"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Tạo lại {qualityStats.errorCount} lỗi</span>
              </button>
            )}
            {qualityStats.warningCount > 0 && onRegenerateWarnings && (
              <button
                type="button"
                disabled={isGeneratingAudio}
                onClick={onRegenerateWarnings}
                className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                title="Chỉ tạo lại các câu có cảnh báo"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Tạo lại {qualityStats.warningCount} cảnh báo</span>
              </button>
            )}
            {dubbingMode !== "free_narration" && collidingCount > 0 && onAutoFitAll && (
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
      </div>

      {/* Main Content Area */}
      {isFreeNarration && isFullTxtEditorOpen ? (
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col bg-surface1 border border-borderDefault rounded-xl p-3 gap-2">
            <span className="text-[11px] font-semibold text-textSecondary">
              Kịch bản TXT gốc đã khôi phục (Không gồm số thứ tự & mốc thời gian SRT)
            </span>
            <textarea
              readOnly
              value={reconstructedSourceTxt}
              className="flex-1 w-full min-h-[260px] bg-surface2/50 border border-borderDefault rounded-lg p-3 text-xs text-textPrimary leading-relaxed resize-none focus:outline-none"
            />
          </div>
          <div className="flex flex-col bg-surface1 border border-borderDefault rounded-xl p-3 gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-textSecondary">
                Kịch bản thuyết minh tiếng Việt (Chỉnh sửa tự do trước khi tạo giọng đọc TTS)
              </span>
            </div>
            <textarea
              value={draftFullScript}
              onChange={(e) => {
                const val = e.target.value;
                setDraftFullScript(val);
                onUpdateFullNarrationScript?.(val);
              }}
              placeholder="Nhập hoặc chỉnh sửa kịch bản thuyết minh liền mạch..."
              className="flex-1 w-full min-h-[260px] bg-surface2 border border-borderDefault focus:border-accent rounded-lg p-3 text-xs text-textPrimary leading-relaxed resize-none focus:outline-none"
            />
          </div>
        </div>
      ) : isFreeNarration && activeNarrationGroups.length > 0 ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="free-narration-groups-grid">
          {activeNarrationGroups.map((group, gIdx) => {
            const headCueIdx = group.sourceCueIds[0] || gIdx + 1;
            const groupTranslatedText =
              group.translatedText ||
              group.speechText ||
              group.sourceCueIds
                .map((id) => translatedCues.find((tc) => tc.index === id)?.text || "")
                .filter(Boolean)
                .join(" ");

            const syntheticOriginal: OriginalCue = {
              index: gIdx + 1,
              startSec: group.startSec,
              endSec: group.endSec,
              text: group.sourceText,
            };
            const syntheticTranslated: TranslatedCue = {
              index: gIdx + 1,
              startSec: group.startSec,
              endSec: group.endSec,
              originalText: group.sourceText,
              text: groupTranslatedText,
              subtitleText: groupTranslatedText,
              speechFragmentText: group.speechText || groupTranslatedText,
              groupId: group.groupId,
              isEdited: group.isUserModified,
            };

            const rawSeg = audioSegments[headCueIdx];
            const narrationSeg = rawSeg
              ? {
                  ...rawSeg,
                  groupCueIndices: undefined,
                }
              : undefined;

            return (
              <CueRow
                key={group.groupId}
                original={syntheticOriginal}
                translated={syntheticTranslated}
                audioSegment={narrationSeg}
                dubbingMode="free_narration"
                narrationSourceCueCount={group.sourceCueIds.length}
                isPlaying={
                  playingCueIndex !== null &&
                  playingCueIndex !== undefined &&
                  group.sourceCueIds.includes(playingCueIndex)
                }
                onUpdateText={(_idx, newText) => {
                  if (onUpdateGroupText) {
                    onUpdateGroupText(group.groupId, newText);
                  } else {
                    onUpdateText(headCueIdx, newText);
                  }
                }}
                onPlayAudio={() => onPlayAudio?.(headCueIdx)}
                onRegenerateAudio={() => onRegenerateAudio?.(headCueIdx)}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {originalCues.map((orig, i) => {
            const trans = translatedCues.find((tc) => tc.index === orig.index) ||
              translatedCues[i] || {
                index: orig.index,
                startSec: orig.startSec,
                endSec: orig.endSec,
                originalText: orig.text,
                text: "",
              };

            return (
              <CueRow
                key={orig.index}
                original={orig}
                translated={trans}
                audioSegment={audioSegments[orig.index]}
                overflowMeta={overflowAnalysis[orig.index]}
                dubbingMode={dubbingMode}
                isPlaying={playingCueIndex === orig.index}
                onUpdateText={onUpdateText}
                onPlayAudio={onPlayAudio}
                onRegenerateAudio={onRegenerateAudio}
              />
            );
          })}
        </div>
      )}

      {/* Bottom Audio Player if provided */}
      {bottomPlayer && (
        <div className="mx-3 mb-3 shrink-0">
          {bottomPlayer}
        </div>
      )}
    </div>
  );
};

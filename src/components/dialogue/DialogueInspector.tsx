import React, { useState, useEffect } from "react";
import {
  Settings2,
  Clock,
  Sparkles,
  RefreshCw,
  ChevronRight,
  Sliders,
  RotateCcw,
  Volume2,
  Play,
  Pause,
  X,
} from "lucide-react";
import {
  DialogueCharacter,
  DialogueGlobalSettings,
  DEFAULT_DIALOGUE_SETTINGS,
} from "../../types/dialogue";
import { VoiceProfile, PunctuationPauses } from "../../types/ui";
import { useI18n } from "../../i18n/context";
import {
  loadSubtitleSettings,
  saveSubtitleSettings,
  SubtitleAspectRatio,
  SubtitleMaxLines,
} from "../../services/subtitle";
import { CharacterCard } from "./CharacterCard";
import { EmptyDialogueState } from "./EmptyDialogueState";

export interface DialogueInspectorProps {
  settings: DialogueGlobalSettings;
  onUpdateSettings: (newSettings: Partial<DialogueGlobalSettings>) => void;
  characters: DialogueCharacter[];
  voices: VoiceProfile[];
  onOpenVoicePicker: (characterId: string) => void;
  onUpdateCharacterSpeed: (characterId: string, speed: number) => void;
  onUpdateCharacterPitch: (characterId: string, pitch: number) => void;
  onTestCharacterVoice?: (characterId: string) => void;
  onUseSample: () => void;
  onConvert: () => void;
  isConverting?: boolean;
  isPaused?: boolean;
  onTogglePause?: () => void;
  onCancel?: () => void;
  completedCount?: number;
  totalCount?: number;
  canConvert?: boolean;
  convertTooltip?: string;
  hasGeneratedAudio?: boolean;
}

export const DialogueInspector: React.FC<DialogueInspectorProps> = ({
  settings,
  onUpdateSettings,
  characters,
  voices,
  onOpenVoicePicker,
  onUpdateCharacterSpeed,
  onUpdateCharacterPitch,
  onTestCharacterVoice,
  onUseSample,
  onConvert,
  isConverting = false,
  isPaused = false,
  onTogglePause,
  onCancel,
  completedCount = 0,
  totalCount = 0,
  canConvert = true,
  convertTooltip,
  hasGeneratedAudio = false,
}) => {
  const { t, lang } = useI18n();
  const voiceMap = new Map<string, VoiceProfile>(voices.map((v) => [v.id, v]));

  // Collapsible sections
  const [isPausesOpen, setIsPausesOpen] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Subtitle Settings (Aspect ratio & max lines, identical to TTS inspector)
  const [subtitleSettings, setSubtitleSettings] = useState(() => loadSubtitleSettings());

  useEffect(() => {
    if (settings.exportSrt) {
      setSubtitleSettings(loadSubtitleSettings());
    }
  }, [settings.exportSrt]);

  const handleUpdateSubtitleSettings = (
    updates: Partial<{ aspectRatio: SubtitleAspectRatio; maxLines: SubtitleMaxLines }>
  ) => {
    const updated = { ...subtitleSettings, ...updates };
    setSubtitleSettings(updated);
    saveSubtitleSettings(updates);
  };

  const pauses = settings.pauses || DEFAULT_DIALOGUE_SETTINGS.pauses;
  const isZeroRange = settings.turnPauseMinSec === 0 && settings.turnPauseMaxSec === 0;
  const turnPauseMinSec =
    typeof settings.turnPauseMinSec === "number" && !isZeroRange
      ? settings.turnPauseMinSec
      : DEFAULT_DIALOGUE_SETTINGS.turnPauseMinSec;
  const turnPauseMaxSec =
    typeof settings.turnPauseMaxSec === "number" && !isZeroRange
      ? settings.turnPauseMaxSec
      : DEFAULT_DIALOGUE_SETTINGS.turnPauseMaxSec;

  const handleTurnPauseMinChange = (rawVal: number) => {
    const val = isNaN(rawVal) ? 0 : Math.max(0, Math.min(2.0, Math.round(rawVal * 100) / 100));
    let newMax = turnPauseMaxSec;
    if (val > newMax) {
      newMax = val;
    }
    onUpdateSettings({
      turnPauseMinSec: val,
      turnPauseMaxSec: newMax,
    });
  };

  const handleTurnPauseMaxChange = (rawVal: number) => {
    const val = isNaN(rawVal) ? 0 : Math.max(0, Math.min(2.0, Math.round(rawVal * 100) / 100));
    let newMin = turnPauseMinSec;
    if (val < newMin) {
      newMin = val;
    }
    onUpdateSettings({
      turnPauseMinSec: newMin,
      turnPauseMaxSec: val,
    });
  };

  const handlePauseChange = (key: keyof PunctuationPauses, val: number) => {
    onUpdateSettings({
      pauses: {
        ...pauses,
        [key]: val,
      },
    });
  };

  const handleResetSettings = () => {
    onUpdateSettings({
      masterVolume: DEFAULT_DIALOGUE_SETTINGS.masterVolume,
      turnPauseMinSec: DEFAULT_DIALOGUE_SETTINGS.turnPauseMinSec,
      turnPauseMaxSec: DEFAULT_DIALOGUE_SETTINGS.turnPauseMaxSec,
      sameSpeakerPauseSec: DEFAULT_DIALOGUE_SETTINGS.sameSpeakerPauseSec,
      pauses: { ...DEFAULT_DIALOGUE_SETTINGS.pauses },
      concurrency: DEFAULT_DIALOGUE_SETTINGS.concurrency,
      exportSrt: DEFAULT_DIALOGUE_SETTINGS.exportSrt,
    });
  };

  return (
    <aside className="w-80 lg:w-88 border-l border-borderDefault bg-surface1/40 flex flex-col flex-shrink-0 select-none overflow-hidden">
      {/* Scrollable Inspector Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* CARD 1: THIẾT LẬP CHUNG */}
        <div className="p-3.5 rounded-xl bg-surface1/70 border border-borderDefault/80 space-y-3.5">
          <div className="flex items-center justify-between border-b border-borderDefault/60 pb-2.5">
            <div className="flex items-center gap-2 text-textPrimary font-semibold">
              <div className="w-5 h-5 rounded bg-accent/15 text-accent flex items-center justify-center shrink-0">
                <Sliders className="w-3.5 h-3.5" />
              </div>
              <span>Thiết lập chung</span>
            </div>
            <button
              type="button"
              onClick={handleResetSettings}
              title="Đặt lại thiết lập chung về mặc định"
              className="flex items-center gap-1 text-[11px] text-textMuted hover:text-accent focus-visible:ring-1 focus-visible:ring-accent rounded px-1.5 py-0.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{t.inspector?.resetSettings || "Đặt lại"}</span>
            </button>
          </div>

          {/* Model Selector (Removed Lingual, keeping official Voxlab models) */}
          <div className="space-y-1">
            <label className="text-[11px] text-textSecondary font-medium block">
              Mô hình
            </label>
            <select
              value={settings.model}
              onChange={(e) => onUpdateSettings({ model: e.target.value })}
              className="w-full h-[34px] bg-surface2 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
            >
              <option value="Omni Voice">Omni Voice</option>
              <option value="Chatterbox Turbo">Chatterbox Turbo</option>
              <option value="Qwen 1.7B">Qwen 1.7B</option>
            </select>
          </div>

          {/* Master Volume */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                <Volume2 className="w-3.5 h-3.5 text-textMuted" />
                <span>Âm lượng</span>
              </span>
              <span className="font-mono text-accent font-semibold">
                {Math.round(settings.masterVolume * 100)}%
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                type="range"
                min="0"
                max="2.0"
                step="0.05"
                value={settings.masterVolume}
                onChange={(e) =>
                  onUpdateSettings({ masterVolume: parseFloat(e.target.value) })
                }
                className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
              />
            </div>
            <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
              <span>0%</span>
              <span>200%</span>
            </div>
          </div>

          {/* Collapsible: NGẮT NGHỈ (Punctuation Pauses - Same as TTS Tab) */}
          <div className="pt-1.5 border-t border-borderDefault/60">
            <button
              type="button"
              onClick={() => setIsPausesOpen(!isPausesOpen)}
              className="w-full flex items-center justify-between py-1.5 px-1 rounded-md text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-surface2/50 outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-accent" />
                <span className="uppercase tracking-wider font-bold">
                  {t.inspector.pausesTitle}
                </span>
              </div>
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  isPausesOpen ? "rotate-90" : ""
                }`}
              />
            </button>

            {isPausesOpen && (
              <div className="space-y-3 pt-2">
                {/* Min-Max Turn Pause Section */}
                <div className="p-2.5 rounded-lg bg-surface2/60 border border-borderDefault/70 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-textPrimary">
                    <span>Thời gian nghỉ khi đổi nhân vật</span>
                    <span className="text-[10px] font-mono text-accent">
                      {turnPauseMinSec.toFixed(2)}s – {turnPauseMaxSec.toFixed(2)}s
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Tối thiểu (Min) */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-medium text-textSecondary block truncate">
                        Tối thiểu (Min)
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0.00"
                          max="2.00"
                          step="0.05"
                          value={turnPauseMinSec}
                          onChange={(e) =>
                            handleTurnPauseMinChange(parseFloat(e.target.value))
                          }
                          className="w-full h-7 bg-surface1 border border-borderDefault rounded-md px-1 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                        />
                        <span className="text-textMuted text-[10px] shrink-0">s</span>
                      </div>
                    </div>

                    {/* Tối đa (Max) */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-medium text-textSecondary block truncate">
                        Tối đa (Max)
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0.00"
                          max="2.00"
                          step="0.05"
                          value={turnPauseMaxSec}
                          onChange={(e) =>
                            handleTurnPauseMaxChange(parseFloat(e.target.value))
                          }
                          className="w-full h-7 bg-surface1 border border-borderDefault rounded-md px-1 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                        />
                        <span className="text-textMuted text-[10px] shrink-0">s</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-textMuted leading-tight italic">
                    Thời gian nghỉ giữa hai nhân vật khác nhau khi đổi lượt nói (khuyên dùng: 0.50–0.60s)
                  </p>
                </div>

                <div className="text-[10px] font-semibold text-textMuted uppercase tracking-wider px-0.5 pt-1">
                  Nghỉ theo dấu câu
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {/* Comma Pause */}
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-textSecondary block truncate">
                      {t.inspector.comma}
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0.1"
                        max="3.0"
                        step="0.1"
                        value={pauses.comma}
                        onChange={(e) =>
                          handlePauseChange(
                            "comma",
                            parseFloat(e.target.value) || 0.1
                          )
                        }
                        className="w-full h-7 bg-surface2 border border-borderDefault rounded-md px-1.5 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                      />
                      <span className="text-textMuted text-[10px] shrink-0">
                        {t.inspector.sec}
                      </span>
                    </div>
                  </div>

                  {/* Period Pause */}
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-textSecondary block truncate">
                      {t.inspector.period}
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0.2"
                        max="5.0"
                        step="0.1"
                        value={pauses.period}
                        onChange={(e) =>
                          handlePauseChange(
                            "period",
                            parseFloat(e.target.value) || 0.2
                          )
                        }
                        className="w-full h-7 bg-surface2 border border-borderDefault rounded-md px-1.5 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                      />
                      <span className="text-textMuted text-[10px] shrink-0">
                        {t.inspector.sec}
                      </span>
                    </div>
                  </div>

                  {/* Question & Exclamation Pause */}
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-textSecondary block truncate">
                      {t.inspector.questionExclamation}
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0.2"
                        max="5.0"
                        step="0.1"
                        value={pauses.questionExclamation}
                        onChange={(e) =>
                          handlePauseChange(
                            "questionExclamation",
                            parseFloat(e.target.value) || 0.2
                          )
                        }
                        className="w-full h-7 bg-surface2 border border-borderDefault rounded-md px-1.5 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                      />
                      <span className="text-textMuted text-[10px] shrink-0">
                        {t.inspector.sec}
                      </span>
                    </div>
                  </div>

                  {/* Colon & Semicolon Pause */}
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-textSecondary block truncate">
                      {t.inspector.colonSemicolon}
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0.1"
                        max="3.0"
                        step="0.1"
                        value={pauses.colonSemicolon}
                        onChange={(e) =>
                          handlePauseChange(
                            "colonSemicolon",
                            parseFloat(e.target.value) || 0.1
                          )
                        }
                        className="w-full h-7 bg-surface2 border border-borderDefault rounded-md px-1.5 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                      />
                      <span className="text-textMuted text-[10px] shrink-0">
                        {t.inspector.sec}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Collapsible: NÂNG CAO (Advanced: Processing Speed, SRT Export, Inter-Speaker Pause) */}
          <div className="pt-1.5 border-t border-borderDefault/60">
            <button
              type="button"
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              className="w-full flex items-center justify-between py-1.5 px-1 rounded-md text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-surface2/50 outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Settings2 className="w-3.5 h-3.5 text-accent" />
                <span className="uppercase tracking-wider font-bold">
                  {t.inspector.advanced}
                </span>
              </div>
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  isAdvancedOpen ? "rotate-90" : ""
                }`}
              />
            </button>

            {isAdvancedOpen && (
              <div className="space-y-3 pt-2">
                {/* Processing Speed (Concurrency) */}
                <div className="space-y-1">
                  <label className="text-[11px] text-textSecondary font-medium block">
                    {t.inspector.processingSpeed}
                  </label>
                  <select
                    value={settings.concurrency ?? 1}
                    onChange={(e) =>
                      onUpdateSettings({
                        concurrency: parseInt(e.target.value, 10) || 1,
                      })
                    }
                    className="w-full h-[32px] bg-surface2 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
                  >
                    <option value={1}>{t.inspector.speed1x}</option>
                    <option value={2}>{t.inspector.speed2x}</option>
                    <option value={3}>{t.inspector.speed3x}</option>
                    <option value={4}>{t.inspector.speed4x}</option>
                  </select>
                </div>

                {/* Export SRT Switch */}
                <div className="flex items-center justify-between py-0.5">
                  <span className="text-[11px] text-textSecondary font-medium">
                    {t.inspector?.exportSrt || "Tạo phụ đề SRT"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.exportSrt}
                    onClick={() =>
                      onUpdateSettings({ exportSrt: !settings.exportSrt })
                    }
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      settings.exportSrt ? "bg-accent" : "bg-surface3"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        settings.exportSrt ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Subtitle Display Options (Aspect Ratio & Max Lines) when SRT export is ON */}
                {settings.exportSrt && (
                  <div className="mt-3 pt-3 border-t border-borderDefault/30 space-y-3 animate-in fade-in-50 duration-200">
                    {/* Tỉ lệ khung hình */}
                    <div className="space-y-1.5">
                      <label className="block text-textSecondary font-medium text-[11px]">
                        {t.transcription.aspectRatioLabel}
                      </label>
                      <div className="grid grid-cols-3 gap-1 p-1 bg-surface1 rounded-lg border border-borderDefault">
                        {(["16:9", "9:16", "1:1"] as SubtitleAspectRatio[]).map((ratio) => {
                          const isSelected = subtitleSettings.aspectRatio === ratio;
                          const labels: Record<SubtitleAspectRatio, { ratio: string; sub: string }> = {
                            "16:9": { ratio: "16:9", sub: lang === "vi" ? "Ngang" : lang === "en" ? "Landscape" : "横屏" },
                            "9:16": { ratio: "9:16", sub: lang === "vi" ? "Dọc" : lang === "en" ? "Portrait" : "竖屏" },
                            "1:1": { ratio: "1:1", sub: lang === "vi" ? "Vuông" : lang === "en" ? "Square" : "正方形" },
                          };
                          const info = labels[ratio];
                          return (
                            <button
                              key={ratio}
                              type="button"
                              onClick={() => handleUpdateSubtitleSettings({ aspectRatio: ratio })}
                              className={`py-1.5 px-1 rounded-md text-[11px] font-medium transition-all text-center cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                                isSelected
                                  ? "bg-accent text-background font-semibold shadow-sm"
                                  : "text-textSecondary hover:text-textPrimary hover:bg-surface2/60"
                              }`}
                            >
                              <span className="leading-tight">{info.ratio}</span>
                              <span
                                className={`text-[10px] leading-tight ${
                                  isSelected ? "text-background/80" : "text-textMuted"
                                }`}
                              >
                                {info.sub}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Số dòng tối đa */}
                    <div className="space-y-1.5">
                      <label className="block text-textSecondary font-medium text-[11px]">
                        {t.transcription.maxLinesLabel}
                      </label>
                      <div className="grid grid-cols-2 gap-1 p-1 bg-surface1 rounded-lg border border-borderDefault">
                        {([1, 2] as SubtitleMaxLines[]).map((lines) => {
                          const isSelected = subtitleSettings.maxLines === lines;
                          return (
                            <button
                              key={lines}
                              type="button"
                              onClick={() => handleUpdateSubtitleSettings({ maxLines: lines })}
                              className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all text-center cursor-pointer ${
                                isSelected
                                  ? "bg-accent text-background font-semibold shadow-sm"
                                  : "text-textSecondary hover:text-textPrimary hover:bg-surface2/60"
                              }`}
                            >
                              {lines} {lang === "vi" ? "dòng" : lang === "en" ? (lines === 1 ? "line" : "lines") : "行"}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* CARD 2: TÙY CHỈNH GIỌNG ĐỌC */}
        {characters.length === 0 ? (
          <EmptyDialogueState onUseSample={onUseSample} />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1 text-xs text-textSecondary">
              <span className="font-semibold text-textPrimary">
                Tùy chỉnh giọng đọc ({characters.length})
              </span>
              <span className="text-[11px] text-textMuted">
                {characters.reduce((acc, c) => acc + c.segmentCount, 0)} câu thoại
              </span>
            </div>

            <div className="space-y-2.5">
              {characters.map((char) => (
                <CharacterCard
                  key={char.id}
                  character={char}
                  assignedVoice={char.voiceId ? voiceMap.get(char.voiceId) : null}
                  onSelectVoice={() => onOpenVoicePicker(char.id)}
                  onUpdateSpeed={(s) => onUpdateCharacterSpeed(char.id, s)}
                  onUpdatePitch={(p) => onUpdateCharacterPitch(char.id, p)}
                  onTestVoice={
                    onTestCharacterVoice
                      ? () => onTestCharacterVoice(char.id)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sticky Bottom Action */}
      {(() => {
        const effectivePercent =
          totalCount > 0
            ? Math.min(100, Math.max(0, Math.round((completedCount / totalCount) * 100)))
            : 0;

        return (
          <div className="p-3 border-t border-borderDefault/70 bg-surface1/95 backdrop-blur-xs flex-shrink-0 flex items-center justify-center">
            {isConverting ? (
              isPaused ? (
                /* State: Paused -> Splits into 2 buttons: [Tiếp tục] & [Hủy] */
                <div className="flex items-center gap-2 w-full h-[68px]">
                  <button
                    type="button"
                    onClick={onTogglePause}
                    title={`Tiếp tục tạo (${completedCount}/${totalCount} đoạn - ${effectivePercent}%)`}
                    className="flex-1 h-full px-3 rounded-xl text-sm font-semibold shadow-md transition-all flex flex-col items-center justify-center gap-0.5 bg-accent hover:bg-accentHover text-white cursor-pointer active:scale-[0.98] hover:shadow-lg hover:shadow-accent/25"
                  >
                    <div className="flex items-center gap-1.5">
                      <Play className="w-4 h-4 fill-white" />
                      <span>Tiếp tục</span>
                    </div>
                    <span className="text-[11px] font-mono opacity-85 font-normal">
                      {completedCount}/{totalCount} ({effectivePercent}%)
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={onCancel}
                    title="Hủy tiến trình tạo audio"
                    className="flex-1 h-full px-3 rounded-xl text-sm font-semibold transition-all flex flex-col items-center justify-center gap-0.5 bg-surface2 hover:bg-danger/15 text-textSecondary hover:text-danger border border-borderDefault hover:border-danger/30 cursor-pointer active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-1.5">
                      <X className="w-4 h-4" />
                      <span>Hủy</span>
                    </div>
                    <span className="text-[11px] opacity-70 font-normal">
                      Dừng tác vụ
                    </span>
                  </button>
                </div>
              ) : (
                /* State: Converting -> Single Progress Button (fills left-to-right, click to pause) */
                <button
                  type="button"
                  onClick={onTogglePause}
                  title={`Bấm để tạm dừng (Đang tạo: ${completedCount}/${totalCount} đoạn)`}
                  className="w-full h-[68px] rounded-xl text-sm font-semibold shadow-xs transition-all relative overflow-hidden flex items-center justify-center cursor-pointer border border-borderDefault/80 bg-surface2 dark:bg-surface3 group select-none active:scale-[0.99]"
                >
                  {/* Background progress fill with gradient and animation */}
                  <div
                    className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-300 ease-out shadow-[0_0_12px_rgba(56,189,248,0.25)]"
                    style={{ width: `${Math.max(effectivePercent, 2)}%` }}
                  />

                  {/* Subtle shine effect on progress edge */}
                  {effectivePercent > 0 && effectivePercent < 100 && (
                    <div
                      className="absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none transition-all duration-300 ease-out -translate-x-full"
                      style={{ left: `${Math.max(effectivePercent, 2)}%` }}
                    />
                  )}

                  {/* Base text layer: prominent high-contrast text on light/dark track */}
                  <div className="absolute inset-0 flex items-center justify-center gap-2.5 text-textPrimary font-bold px-4 w-full select-none">
                    <span className="relative flex items-center justify-center w-5 h-5 flex-shrink-0">
                      <RefreshCw className="w-4 h-4 animate-spin text-accent group-hover:opacity-0 transition-opacity" />
                      <Pause className="w-4 h-4 fill-textPrimary text-textPrimary absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                    </span>
                    <span className="truncate">
                      Đang tạo: {completedCount}/{totalCount} đoạn ({effectivePercent}%)
                    </span>
                  </div>

                  {/* Inverted text layer: pure white text clipped precisely to the progress fill area */}
                  <div
                    className="absolute inset-0 flex items-center justify-center gap-2.5 text-white font-bold px-4 w-full pointer-events-none select-none"
                    style={{
                      clipPath: `inset(0 calc(100% - ${Math.max(effectivePercent, 2)}%) 0 0)`,
                    }}
                  >
                    <span className="relative flex items-center justify-center w-5 h-5 flex-shrink-0">
                      <RefreshCw className="w-4 h-4 animate-spin text-white group-hover:opacity-0 transition-opacity" />
                      <Pause className="w-4 h-4 fill-white absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                    </span>
                    <span className="truncate">
                      Đang tạo: {completedCount}/{totalCount} đoạn ({effectivePercent}%)
                    </span>
                  </div>
                </button>
              )
            ) : (
              /* State: Idle -> Standard Action Button */
              <button
                type="button"
                onClick={onConvert}
                disabled={canConvert === false}
                title={
                  convertTooltip ||
                  (hasGeneratedAudio
                    ? "Chạy lại toàn bộ audio hội thoại (ghi đè kết quả cũ)"
                    : "Tạo Audio Hội Thoại")
                }
                className={`w-full h-[68px] px-4 rounded-xl text-sm font-semibold shadow-md transition-all flex items-center justify-center gap-2 ${
                  canConvert === false
                    ? "bg-surface3 text-textMuted cursor-not-allowed border border-borderDefault/50"
                    : "bg-accent hover:bg-accentHover text-white cursor-pointer active:scale-[0.98] hover:shadow-lg hover:shadow-accent/20"
                }`}
              >
                <Sparkles className="w-4 h-4 fill-current" />
                <span>
                  {hasGeneratedAudio ? "Tạo lại Audio Hội Thoại" : "Tạo Audio Hội Thoại"}
                </span>
              </button>
            )}
          </div>
        );
      })()}
    </aside>
  );
};

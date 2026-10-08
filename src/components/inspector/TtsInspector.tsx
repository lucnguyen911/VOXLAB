import React, { useState, useEffect } from "react";
import {
  Settings2,
  Clock,
  RotateCcw,
  Volume2,
  Activity,
  Gauge,
  ChevronRight,
  Sparkles,
  RefreshCw,
  Pause,
  Play,
  X,
} from "lucide-react";
import { ChunkItem, VoiceProfile, PunctuationPauses } from "../../types/ui";
import { useI18n } from "../../i18n/context";
import {
  getVoiceLanguageInfo,
  normalizeAccent,
  getAccentLabel,
  getVoiceSecondaryTags,
} from "../../constants/voiceFilters";
import { CountryFlag } from "../common/CountryFlag";
import {
  loadSubtitleSettings,
  saveSubtitleSettings,
  SubtitleAspectRatio,
  SubtitleMaxLines,
} from "../../services/subtitle";

export interface PersistedTtsSettings {
  speed: number;
  pitch: number;
  volume: number;
  pauses: PunctuationPauses;
  sentencePauseMs?: number;
  concurrency: number;
  exportSrt?: boolean;
}

const DEFAULT_TTS_SETTINGS: PersistedTtsSettings = {
  speed: 1.0,
  pitch: 1.0,
  volume: 1.0,
  pauses: {
    comma: 0.5,
    period: 0.5, // PERIOD_PAUSE = TUNING REQUIRED (0.5s development baseline)
    questionExclamation: 1.0,
    colonSemicolon: 0.6,
  },
  concurrency: 1, // Section 20: default is 1x · Mặc định
  exportSrt: false,
};

const STORAGE_KEY = "voxlab_tts_settings";

export const loadStoredTtsSettings = (): PersistedTtsSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      let concurrency = parsed.concurrency;
      // Section 20: Legacy 8 workers safety clamp to 4
      if (concurrency === 8) {
        concurrency = 4;
      } else if (![1, 2, 3, 4].includes(concurrency)) {
        concurrency = 1;
      }

      return {
        speed:
          typeof parsed.speed === "number" && !isNaN(parsed.speed)
            ? Math.min(1.5, Math.max(0.5, parsed.speed))
            : DEFAULT_TTS_SETTINGS.speed,
        pitch:
          typeof parsed.pitch === "number" && !isNaN(parsed.pitch)
            ? parsed.pitch
            : DEFAULT_TTS_SETTINGS.pitch,
        volume:
          typeof parsed.volume === "number" && !isNaN(parsed.volume)
            ? parsed.volume
            : DEFAULT_TTS_SETTINGS.volume,
        pauses: {
          comma:
            typeof parsed.pauses?.comma === "number"
              ? parsed.pauses.comma
              : DEFAULT_TTS_SETTINGS.pauses.comma,
          period:
            typeof parsed.pauses?.period === "number"
              ? parsed.pauses.period
              : DEFAULT_TTS_SETTINGS.pauses.period,
          questionExclamation:
            typeof parsed.pauses?.questionExclamation === "number"
              ? parsed.pauses.questionExclamation
              : DEFAULT_TTS_SETTINGS.pauses.questionExclamation,
          colonSemicolon:
            typeof parsed.pauses?.colonSemicolon === "number"
              ? parsed.pauses.colonSemicolon
              : DEFAULT_TTS_SETTINGS.pauses.colonSemicolon,
        },
        sentencePauseMs:
          typeof parsed.sentencePauseMs === "number"
            ? parsed.sentencePauseMs
            : undefined,
        concurrency,
        exportSrt: typeof parsed.exportSrt === "boolean" ? parsed.exportSrt : false,
      };
    }
  } catch (e) {
    // Ignore error and return defaults
  }
  return DEFAULT_TTS_SETTINGS;
};

export const saveStoredTtsSettings = (settings: Partial<PersistedTtsSettings>) => {
  try {
    const current = loadStoredTtsSettings();
    const next = { ...current, ...settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    // Ignore storage errors
  }
};

import {
  scanAiModels,
  type ModelStatus,
} from "../../services/ai/aiRuntimeSettings";
import { resolveLocalEngine } from "../../services/ai/ttsEngines";

interface TtsInspectorProps {
  selectedChunk: ChunkItem | null;
  voices: VoiceProfile[];
  activeVoiceId: string;
  onChangeActiveVoice: (id: string) => void;
  activeModel: string;
  onChangeModel: (model: string) => void;
  isOpen?: boolean;
  onToggle?: () => void;
  inspectorWidth?: number;
  onWidthChange?: (width: number) => void;
  onOpenVoiceModal?: () => void;
  lang?: string;
  concurrency?: number;
  onChangeConcurrency?: (concurrency: number) => void;
  exportSrt?: boolean;
  onChangeExportSrt?: (enabled: boolean) => void;
  onGenerateAudio?: () => void;
  isGenerating?: boolean;
  canGenerate?: boolean;
  generateTooltip?: string;
  completedCount?: number;
  totalCount?: number;
  progressStage?: string;
  isPaused?: boolean;
  onTogglePause?: () => void;
  onCancel?: () => void;
}

export const TtsInspector: React.FC<TtsInspectorProps> = ({
  selectedChunk: _selectedChunk,
  voices,
  activeVoiceId,
  onChangeActiveVoice: _onChangeActiveVoice,
  activeModel,
  onChangeModel,
  isOpen: _isOpen = true,
  onToggle: _onToggle,
  inspectorWidth = 340,
  onWidthChange: _onWidthChange,
  onOpenVoiceModal,
  concurrency: propConcurrency,
  onChangeConcurrency,
  exportSrt: propExportSrt,
  onChangeExportSrt,
  onGenerateAudio,
  isGenerating = false,
  canGenerate = true,
  generateTooltip,
  completedCount = 0,
  totalCount = 0,
  progressStage,
  isPaused = false,
  onTogglePause,
  onCancel,
}) => {
  const { t, lang } = useI18n();

  // Model scanning
  const [installedModels, setInstalledModels] = useState<ModelStatus[]>([]);

  useEffect(() => {
    scanAiModels().then(setInstalledModels).catch(() => {});
  }, []);

  const currentCaps = resolveLocalEngine(activeModel);
  const currentModelStatus = installedModels.find(
    (m) => m.id === currentCaps?.modelId || m.engine === currentCaps?.engine
  );
  const isCurrentModelInstalled = currentModelStatus ? currentModelStatus.installed : true;

  // Load initial persisted settings
  const initialSettings = loadStoredTtsSettings();

  // Audio configuration state
  const [speed, setSpeed] = useState<number>(initialSettings.speed);
  const [pitch, setPitch] = useState<number>(initialSettings.pitch);
  const [volume, setVolume] = useState<number>(initialSettings.volume);
  const [localConcurrency, setLocalConcurrency] = useState<number>(
    propConcurrency ?? initialSettings.concurrency
  );
  const [localExportSrt, setLocalExportSrt] = useState<boolean>(
    propExportSrt ?? initialSettings.exportSrt ?? false
  );

  // Punctuation pauses configuration (in seconds)
  const [pauses, setPauses] = useState<PunctuationPauses>(initialSettings.pauses);

  // Accordion states - NÂNG CAO collapsed by default (Section 11)
  const [isPausesOpen, setIsPausesOpen] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Sync propConcurrency with localConcurrency if passed
  useEffect(() => {
    if (propConcurrency !== undefined && propConcurrency !== localConcurrency) {
      setLocalConcurrency(propConcurrency);
    }
  }, [propConcurrency]);

  // Sync propExportSrt with localExportSrt if passed
  useEffect(() => {
    if (propExportSrt !== undefined && propExportSrt !== localExportSrt) {
      setLocalExportSrt(propExportSrt);
    }
  }, [propExportSrt]);

  const effectiveExportSrt = propExportSrt ?? localExportSrt;

  const [subtitleSettings, setSubtitleSettings] = useState(() => loadSubtitleSettings());

  useEffect(() => {
    if (effectiveExportSrt) {
      setSubtitleSettings(loadSubtitleSettings());
    }
  }, [effectiveExportSrt]);

  const handleUpdateSubtitleSettings = (
    updates: Partial<{ aspectRatio: SubtitleAspectRatio; maxLines: SubtitleMaxLines }>
  ) => {
    const updated = { ...subtitleSettings, ...updates };
    setSubtitleSettings(updated);
    saveSubtitleSettings(updates);
  };

  const handleToggleExportSrt = (enabled: boolean) => {
    setLocalExportSrt(enabled);
    saveStoredTtsSettings({ exportSrt: enabled });
    onChangeExportSrt?.(enabled);
  };

  // Selected active voice details
  const activeVoice = voices.find((v) => v.id === activeVoiceId) || voices[0];

  // Reset voice settings (Speed, Pitch, Volume) - Section 7
  const handleResetSettings = () => {
    setSpeed(DEFAULT_TTS_SETTINGS.speed);
    setPitch(DEFAULT_TTS_SETTINGS.pitch);
    setVolume(DEFAULT_TTS_SETTINGS.volume);
    saveStoredTtsSettings({
      speed: DEFAULT_TTS_SETTINGS.speed,
      pitch: DEFAULT_TTS_SETTINGS.pitch,
      volume: DEFAULT_TTS_SETTINGS.volume,
    });
  };

  const handleSpeedChange = (newSpeed: number) => {
    setSpeed(newSpeed);
    saveStoredTtsSettings({ speed: newSpeed });
  };

  const handlePitchChange = (newPitch: number) => {
    setPitch(newPitch);
    saveStoredTtsSettings({ pitch: newPitch });
  };

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    saveStoredTtsSettings({ volume: newVolume });
  };

  const handlePauseChange = (key: keyof PunctuationPauses, val: number) => {
    const updated = { ...pauses, [key]: val };
    setPauses(updated);
    saveStoredTtsSettings({ pauses: updated });
  };

  const handleConcurrencyChange = (val: number) => {
    setLocalConcurrency(val);
    saveStoredTtsSettings({ concurrency: val });
    onChangeConcurrency?.(val);
  };

  const effectiveConcurrency = propConcurrency ?? localConcurrency;

  return (
    <aside
      style={{ width: `${inspectorWidth}px` }}
      className="bg-panel border-l border-borderDefault flex flex-col h-full flex-shrink-0 z-20 select-none transition-all duration-150"
    >
      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* 1. GIỌNG ĐỌC (Voice Card - Section 4: Reduced Metadata, max 2 items) */}
        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
            {t.inspector.primaryVoice || "GIỌNG ĐỌC"}
          </label>
          <div
            id="voice-picker-trigger"
            role="button"
            tabIndex={0}
            onClick={onOpenVoiceModal}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenVoiceModal?.();
              }
            }}
            className="p-3 bg-surface2/60 hover:bg-surface2 border border-borderDefault hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl transition-all cursor-pointer flex items-center justify-between gap-3 group shadow-2xs"
            title={t.inspector.fromLibrary}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`w-10 h-10 rounded-full bg-gradient-to-tr ${
                  activeVoice.avatarColor || "from-pink-500 to-rose-600"
                } flex items-center justify-center text-white font-bold text-xs shadow-sm flex-shrink-0`}
              >
                {activeVoice.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <h4 className="font-semibold text-[13px] text-textPrimary truncate group-hover:text-accent transition-colors">
                  {activeVoice.name}
                </h4>
                {(() => {
                  const langInfo = getVoiceLanguageInfo(activeVoice, lang);
                  let accentOrTag = "";
                  if (activeVoice.accent) {
                    const normAcc = normalizeAccent(activeVoice.accent);
                    accentOrTag = getAccentLabel(normAcc, lang);
                  }
                  if (!accentOrTag) {
                    const secondaryTags = getVoiceSecondaryTags(activeVoice, lang);
                    accentOrTag =
                      secondaryTags.length > 0
                        ? secondaryTags[0]
                        : lang === "vi"
                        ? "Tiêu chuẩn"
                        : "Standard";
                  }
                  return (
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs text-textSecondary font-medium truncate">
                      <CountryFlag countryCode={langInfo.countryCode || langInfo.code} />
                      <span className="truncate">{langInfo.name}</span>
                      {accentOrTag && (
                        <>
                          <span className="text-textMuted text-[10px]">·</span>
                          <span className="text-[11px] text-textMuted truncate">
                            {accentOrTag}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="flex items-center gap-1 text-xs text-accent font-semibold flex-shrink-0 group-hover:translate-x-0.5 transition-transform">
              <span>{t.inspector.changeVoice}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>

        {/* 2. MODEL & DEVICE (Section 5 & Requirement 6: Online voice vs Local model consistency) */}
        <div className="space-y-1.5 pt-0.5">
          {activeVoice?.isOnline || activeVoice?.provider === "edge" || activeVoice?.provider === "google_translate" || activeVoice?.provider === "openai" ? (
            <>
              <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                {t.inspector.model}
              </label>
              <div className="w-full h-[34px] bg-surface2/70 border border-borderDefault rounded-lg px-2.5 flex items-center justify-between text-xs text-textPrimary">
                <div className="flex items-center gap-2 truncate">
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                  <span className="font-medium truncate">
                    {activeVoice.provider === "edge"
                      ? "Microsoft Edge Neural (Cloud API)"
                      : activeVoice.provider === "google_translate"
                      ? "Google Cloud TTS (API v1)"
                      : "OpenAI Audio TTS"}
                  </span>
                </div>
                <span className="text-[10px] text-textMuted uppercase font-mono tracking-wider ml-2 flex-shrink-0">
                  Online
                </span>
              </div>
            </>
          ) : (
            <>
              <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                {t.inspector.model}
              </label>
              <select
                value={activeModel}
                onChange={(e) => onChangeModel(e.target.value)}
                className="w-full h-[34px] bg-surface2 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
              >
                <option value="OmniVoice">OmniVoice (Đa ngữ · Tiếng Việt)</option>
                <option value="Chatterbox Turbo">Chatterbox Turbo (Tiếng Anh)</option>
                <option value="Qwen TTS 1.7B">Qwen TTS 1.7B (Đa ngữ · Base)</option>
              </select>
            </>
          )}
        </div>

        {/* Section 5: Subtle Divider before CÀI ĐẶT */}
        <div className="border-t border-borderDefault/60 pt-1" />

        {/* 3. CÀI ĐẶT (Section 6 & 7: Unified group, inline Reset button, no individual card boxes) */}
        <div className="space-y-3.5">
          {/* Header with inline Reset button */}
          <div className="flex items-center justify-between pb-0.5">
            <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
              {t.inspector.settings}
            </label>
            <button
              type="button"
              onClick={handleResetSettings}
              title={t.inspector.resetSettingsTooltip}
              className="flex items-center gap-1 text-xs text-textMuted hover:text-accent focus-visible:ring-1 focus-visible:ring-accent rounded px-1.5 py-0.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{t.inspector.resetSettings}</span>
            </button>
          </div>

          {/* Speed Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                <Gauge className="w-3.5 h-3.5 text-textMuted" />
                <span>{t.inspector.speed}</span>
              </span>
              <span className="font-mono text-accent font-semibold">
                {speed.toFixed(2)}×
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.05"
                value={speed}
                onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
              />
            </div>
            <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
              <span>0.5×</span>
              <span>1.5×</span>
            </div>
          </div>

          {/* Pitch Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                <Activity className="w-3.5 h-3.5 text-textMuted" />
                <span>{t.inspector.pitch}</span>
              </span>
              <span className="font-mono text-accent font-semibold">
                {pitch.toFixed(2)}
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.05"
                value={pitch}
                onChange={(e) => handlePitchChange(parseFloat(e.target.value))}
                className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
              />
            </div>
            <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
              <span>{t.inspector.low}</span>
              <span>{t.inspector.high}</span>
            </div>
          </div>

          {/* Volume Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-textSecondary flex items-center gap-1.5 font-medium">
                <Volume2 className="w-3.5 h-3.5 text-textMuted" />
                <span>{t.inspector.volume}</span>
              </span>
              <span className="font-mono text-accent font-semibold">
                {Math.round(volume * 100)}%
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                type="range"
                min="0"
                max="2.0"
                step="0.05"
                value={volume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
              />
            </div>
            <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
              <span>0%</span>
              <span>200%</span>
            </div>
          </div>
        </div>

        {/* Section 9 & 10: COLLAPSIBLE NGẮT NGHỈ / PUNCTUATION PAUSES (Default Collapsed, Light Layout, No Nested Cards) */}
        <div className="pt-2 border-t border-borderDefault/60">
          <button
            type="button"
            onClick={() => setIsPausesOpen(!isPausesOpen)}
            className="w-full flex items-center justify-between py-2 px-1 rounded-md text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-surface2/40 outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 transition-colors cursor-pointer"
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
              {/* Section 9: 2-column grid without nested card boxes */}
              <div className="grid grid-cols-2 gap-3">
                {/* Comma Pause */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-textSecondary block truncate">
                    {t.inspector.comma}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0.1"
                      max="3.0"
                      step="0.1"
                      value={pauses.comma}
                      onChange={(e) =>
                        handlePauseChange("comma", parseFloat(e.target.value) || 0.1)
                      }
                      className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                    />
                    <span className="text-textMuted text-[11px] flex-shrink-0">
                      {t.inspector.sec}
                    </span>
                  </div>
                </div>

                {/* Period Pause */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-textSecondary block truncate">
                    {t.inspector.period}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0.2"
                      max="5.0"
                      step="0.1"
                      value={pauses.period}
                      onChange={(e) =>
                        handlePauseChange("period", parseFloat(e.target.value) || 0.2)
                      }
                      className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                    />
                    <span className="text-textMuted text-[11px] flex-shrink-0">
                      {t.inspector.sec}
                    </span>
                  </div>
                </div>

                {/* Question & Exclamation Pause */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-textSecondary block truncate">
                    {t.inspector.questionExclamation}
                  </span>
                  <div className="flex items-center gap-1.5">
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
                      className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                    />
                    <span className="text-textMuted text-[11px] flex-shrink-0">
                      {t.inspector.sec}
                    </span>
                  </div>
                </div>

                {/* Colon & Semicolon Pause */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-textSecondary block truncate">
                    {t.inspector.colonSemicolon}
                  </span>
                  <div className="flex items-center gap-1.5">
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
                      className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                    />
                    <span className="text-textMuted text-[11px] flex-shrink-0">
                      {t.inspector.sec}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section 11-24: COLLAPSIBLE NÂNG CAO (Default Collapsed, Processing Speed, No Duplicate Badge, No Fake VRAM) */}
        <div className="pt-2 border-t border-borderDefault/60">
          <button
            type="button"
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            className="w-full flex items-center justify-between py-2 px-1 rounded-md text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-surface2/40 outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 transition-colors cursor-pointer"
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
            <div className="space-y-3.5 pt-2">
              {/* Processing Speed Section */}
              <div className="space-y-1.5">
                <label className="block text-xs text-textSecondary font-medium">
                  {t.inspector.processingSpeed}
                </label>
                <select
                  value={effectiveConcurrency}
                  onChange={(e) =>
                    handleConcurrencyChange(parseInt(e.target.value, 10) || 1)
                  }
                  className="w-full h-[34px] bg-surface1 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none transition-colors cursor-pointer"
                >
                  <option value={1}>{t.inspector.speed1x}</option>
                  <option value={2}>{t.inspector.speed2x}</option>
                  <option value={3}>{t.inspector.speed3x}</option>
                  <option value={4}>{t.inspector.speed4x}</option>
                </select>
              </div>

              {/* SRT Subtitle Switch (Simple OFF / ON) */}
              <div className="pt-2 border-t border-borderDefault/40">
                <div
                  className="flex items-center justify-between"
                  title={t.inspector.exportSrtDesc}
                >
                  <span className="text-xs text-textSecondary font-medium select-none">
                    {t.inspector.exportSrt}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={effectiveExportSrt}
                    onClick={() => handleToggleExportSrt(!effectiveExportSrt)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      effectiveExportSrt ? "bg-accent" : "bg-surface3"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        effectiveExportSrt ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Subtitle Display Options (Aspect Ratio & Max Lines) when SRT export is ON */}
                {effectiveExportSrt && (
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
            </div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Action in Right Sidebar (Tạo audio / Tiến trình / Tạm dừng / Tiếp tục & Hủy) */}
      {onGenerateAudio && (() => {
        const effectivePercent =
          totalCount > 0
            ? Math.min(100, Math.max(0, Math.round((completedCount / totalCount) * 100)))
            : 0;

        return (
          <div className="p-3 border-t border-borderDefault/70 bg-surface1/95 backdrop-blur-xs flex-shrink-0 flex items-center justify-center">
            {isGenerating ? (
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
                /* State: Generating -> Single Progress Button (fills left-to-right, click to pause) */
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
                      Đang tạo: {completedCount}/{totalCount} đoạn ({effectivePercent}%){progressStage ? ` · ${progressStage}` : ""}
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
                      Đang tạo: {completedCount}/{totalCount} đoạn ({effectivePercent}%){progressStage ? ` · ${progressStage}` : ""}
                    </span>
                  </div>
                </button>
              )
            ) : (
              /* State: Idle -> Standard Action Button */
              <button
                type="button"
                onClick={onGenerateAudio}
                disabled={canGenerate === false || !isCurrentModelInstalled}
                title={
                  !isCurrentModelInstalled
                    ? "Model chưa được cài đặt trong thư mục models."
                    : generateTooltip || t.tts.generateAudio
                }
                className={`w-full h-[68px] px-4 rounded-xl text-sm font-semibold shadow-md transition-all flex items-center justify-center gap-2 ${
                  canGenerate === false || !isCurrentModelInstalled
                    ? "bg-surface3 text-textMuted cursor-not-allowed border border-borderDefault/50"
                    : "bg-accent hover:bg-accentHover text-white cursor-pointer active:scale-[0.98] hover:shadow-lg hover:shadow-accent/20"
                }`}
              >
                <Sparkles className="w-4 h-4 fill-current" />
                <span>
                  {!isCurrentModelInstalled ? "Model chưa được cài" : t.tts.generateAudio}
                </span>
              </button>
            )}
          </div>
        );
      })()}
    </aside>
  );
};

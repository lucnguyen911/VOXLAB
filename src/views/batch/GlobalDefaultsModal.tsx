import React, { useState, useEffect } from "react";
import {
  X,
  FolderOpen,
  Mic,
  MessageSquare,
  Subtitles,
  Languages,
  Film,
  SlidersHorizontal,
  Check,
  Clock,
  RotateCcw,
  Volume2,
  Activity,
  Gauge,
  ChevronRight,
} from "lucide-react";
import {
  BatchTaskConfigMap,
  BatchJobOutputSnapshot,
  BatchCollisionPolicy,
} from "../../types/batch";
import { VoiceProfile, PunctuationPauses } from "../../types/ui";
import { MOCK_VOICES } from "../../mock/data";
import { useI18n } from "../../i18n/context";
import { loadSubtitleSettings } from "../../services/subtitle/profiles";
import {
  loadStoredTtsSettings,
  saveStoredTtsSettings,
  DEFAULT_TTS_SETTINGS,
} from "../../components/inspector/TtsInspector";
import { VoiceSelectionModal } from "../../components/modals/VoiceSelectionModal";
import { CountryFlag } from "../../components/common/CountryFlag";
import {
  getVoiceLanguageInfo,
  normalizeAccent,
  getAccentLabel,
  getVoiceSecondaryTags,
  migrateLegacyVoice,
} from "../../constants/voiceFilters";
import { reconcileCloneVoicesWithProfiles } from "../../services/ai/cloneVoiceRegistry";
import {
  loadBatchGlobalOutputSettings,
  saveBatchGlobalOutputSettings,
} from "../../services/batch/configSnapshotResolver";
import { getDefaultBatchOutputDir } from "../../services/batch/batchRuntime";
import { isTauriRuntime } from "../../services/ai/tauriBackend";

function loadAvailableVoices(): VoiceProfile[] {
  try {
    const raw = localStorage.getItem("voxlab_voices_v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(migrateLegacyVoice);
      }
    }
  } catch {
    // ignore
  }
  return MOCK_VOICES.map(migrateLegacyVoice);
}

function normalizeModelSelectValue(rawModel?: string): string {
  const m = (rawModel || "").toLowerCase();
  if (m.includes("chatterbox")) return "Chatterbox Turbo";
  if (m.includes("qwen")) return "Qwen TTS 1.7B";
  return "OmniVoice";
}

function mapSelectToSnapshotModel(selectVal: string): string {
  if (selectVal === "Chatterbox Turbo") return "chatterbox_turbo";
  if (selectVal === "Qwen TTS 1.7B") return "qwen_tts_1_7b";
  return "omnivoice";
}

export interface GlobalDefaultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  globalDefaults: BatchTaskConfigMap;
  globalOutputDefaults?: BatchJobOutputSnapshot;
  onSaveDefaults: (
    defaults: BatchTaskConfigMap,
    outputDefaults: BatchJobOutputSnapshot
  ) => void;
  selectedJobCount: number;
  onApplyToSelected: (
    defaults: BatchTaskConfigMap,
    outputDefaults: BatchJobOutputSnapshot
  ) => void;
}

export const GlobalDefaultsModal: React.FC<GlobalDefaultsModalProps> = ({
  isOpen,
  onClose,
  globalDefaults,
  globalOutputDefaults,
  onSaveDefaults,
  selectedJobCount,
  onApplyToSelected,
}) => {
  if (!isOpen) return null;

  const { t, lang } = useI18n();

  const [activeTab, setActiveTab] = useState<
    "general" | "tts" | "dialogue" | "transcription" | "translation" | "dubbing"
  >("general");

  const [voices, setVoices] = useState<VoiceProfile[]>(loadAvailableVoices);
  const [isTtsVoiceModalOpen, setIsTtsVoiceModalOpen] = useState(false);
  const [isTtsPausesOpen, setIsTtsPausesOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    reconcileCloneVoicesWithProfiles(loadAvailableVoices())
      .then((reconciled) => {
        if (!cancelled) setVoices(reconciled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [localDefaults, setLocalDefaults] = useState<BatchTaskConfigMap>(() => {
    const storedTts = loadStoredTtsSettings();
    const existingTts = globalDefaults.tts;
    const rawPitch = existingTts?.pitch;
    const pitchVal =
      typeof rawPitch === "number" && rawPitch >= 0.5 && rawPitch <= 1.5
        ? rawPitch
        : storedTts.pitch || 1.0;
    const rawVol = existingTts?.volume;
    const volPct =
      typeof rawVol === "number"
        ? rawVol <= 2.0 && rawVol > 0
          ? Math.round(rawVol * 100)
          : Math.round(rawVol)
        : Math.round((storedTts.volume ?? 1.0) * 100);

    return {
      ...globalDefaults,
      tts: {
        model: existingTts?.model || "omnivoice",
        voiceId:
          existingTts?.voiceId && existingTts.voiceId !== "omnivoice-auto"
            ? existingTts.voiceId
            : loadAvailableVoices()[0]?.id || "voice_01",
        speed: existingTts?.speed ?? storedTts.speed ?? 1.0,
        pitch: pitchVal,
        volume: volPct,
        pauses: existingTts?.pauses || storedTts.pauses || DEFAULT_TTS_SETTINGS.pauses,
        exportSrt: existingTts?.exportSrt ?? storedTts.exportSrt ?? false,
      },
    };
  });

  const [localOutput, setLocalOutput] = useState<BatchJobOutputSnapshot>(() => {
    const initial =
      globalOutputDefaults ||
      loadBatchGlobalOutputSettings(getDefaultBatchOutputDir());
    return {
      ...initial,
      resolvedOutputDirectory:
        initial.resolvedOutputDirectory ||
        getDefaultBatchOutputDir() ||
        "C:\\Users\\lucng\\OneDrive\\Documents\\VoxLab\\Batch_Export",
      flatOutputDirectory: initial.saveInSourceFolder ? false : true,
    };
  });

  const handleBrowseFolder = async () => {
    if (!isTauriRuntime()) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: localOutput.resolvedOutputDirectory || undefined,
      });
      if (typeof picked === "string" && picked.trim()) {
        setLocalOutput((prev) => ({
          ...prev,
          resolvedOutputDirectory: picked.trim(),
        }));
      }
    } catch (err) {
      console.error("Không thể mở hộp thoại chọn thư mục:", err);
    }
  };

  const handleApply = () => {
    if (selectedJobCount === 0) return;
    onApplyToSelected(localDefaults, localOutput);
    onClose();
  };

  const handleSaveDefault = () => {
    saveBatchGlobalOutputSettings(localOutput);
    onSaveDefaults(localDefaults, localOutput);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-[780px] h-[640px] max-h-[90vh] bg-panel rounded-2xl border border-borderDefault shadow-2xl flex flex-col overflow-hidden select-none">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-borderDefault flex items-center justify-between bg-surface1 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-textPrimary">Cấu hình hàng loạt</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface2 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Tab Navigation */}
        <div className="flex items-center px-6 border-b border-borderDefault bg-surface1 text-xs flex-shrink-0 gap-3 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab("general")}
            className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === "general"
                ? "border-accent text-accent"
                : "border-transparent text-textMuted hover:text-textPrimary"
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Xuất & Tệp</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("tts")}
            className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === "tts"
                ? "border-accent text-accent"
                : "border-transparent text-textMuted hover:text-textPrimary"
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>TTS</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("dialogue")}
            className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === "dialogue"
                ? "border-accent text-accent"
                : "border-transparent text-textMuted hover:text-textPrimary"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Hội thoại</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("transcription")}
            className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === "transcription"
                ? "border-accent text-accent"
                : "border-transparent text-textMuted hover:text-textPrimary"
            }`}
          >
            <Subtitles className="w-3.5 h-3.5" />
            <span>Phụ đề</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("translation")}
            className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === "translation"
                ? "border-accent text-accent"
                : "border-transparent text-textMuted hover:text-textPrimary"
            }`}
          >
            <Languages className="w-3.5 h-3.5" />
            <span>Dịch</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("dubbing")}
            className={`py-2.5 border-b-2 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === "dubbing"
                ? "border-accent text-accent"
                : "border-transparent text-textMuted hover:text-textPrimary"
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Lồng tiếng</span>
          </button>
        </div>

        {/* Modal Tab Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {/* TAB 1: XUẤT & TỆP */}
          {activeTab === "general" && (
            <div className="space-y-4">
              {/* Chế độ vị trí lưu kết quả */}
              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1.5">
                  Chế độ thư mục lưu kết quả
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setLocalOutput((prev) => ({
                        ...prev,
                        saveInSourceFolder: false,
                        flatOutputDirectory: true,
                      }))
                    }
                    className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                      !localOutput.saveInSourceFolder
                        ? "border-accent bg-accent/10"
                        : "border-borderDefault bg-surface2 hover:bg-surface3/60"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-textPrimary">
                        Lưu toàn bộ vào 1 thư mục
                      </span>
                      <span
                        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          !localOutput.saveInSourceFolder
                            ? "border-accent bg-accent"
                            : "border-borderDefault"
                        }`}
                      >
                        {!localOutput.saveInSourceFolder && (
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-950" />
                        )}
                      </span>
                    </div>
                    <div className="text-[11px] text-textMuted leading-relaxed">
                      Toàn bộ danh sách tệp sẽ được xuất chung vào 1 thư mục đích cố định bên dưới.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setLocalOutput((prev) => ({
                        ...prev,
                        saveInSourceFolder: true,
                        flatOutputDirectory: false,
                      }))
                    }
                    className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                      localOutput.saveInSourceFolder
                        ? "border-accent bg-accent/10"
                        : "border-borderDefault bg-surface2 hover:bg-surface3/60"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-textPrimary">
                        Tạo folder theo tên file tại thư mục gốc
                      </span>
                      <span
                        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          localOutput.saveInSourceFolder
                            ? "border-accent bg-accent"
                            : "border-borderDefault"
                        }`}
                      >
                        {localOutput.saveInSourceFolder && (
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-950" />
                        )}
                      </span>
                    </div>
                    <div className="text-[11px] text-textMuted leading-relaxed">
                      Mỗi tệp tự tạo 1 folder trùng tên tệp gốc ngay trong chính thư mục chứa tệp đó.
                    </div>
                  </button>
                </div>
              </div>

              {/* Thư mục xuất kết quả */}
              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Thư mục xuất kết quả
                </label>
                {localOutput.saveInSourceFolder ? (
                  <div className="w-full bg-surface2/60 border border-borderDefault rounded-lg px-3 py-2 text-xs text-textSecondary font-mono">
                    &lt;Thư mục chứa file gốc&gt;\&lt;Tên file gốc&gt;\ (Tự động tạo theo từng tệp)
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={localOutput.resolvedOutputDirectory}
                      onChange={(e) =>
                        setLocalOutput((prev) => ({
                          ...prev,
                          resolvedOutputDirectory: e.target.value,
                        }))
                      }
                      className="flex-1 bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary font-mono focus:border-accent focus:outline-none"
                      placeholder="C:\Users\...\Documents\VoxLab\Batch_Export"
                    />
                    {isTauriRuntime() && (
                      <button
                        type="button"
                        onClick={handleBrowseFolder}
                        className="px-3 py-1.5 bg-surface2 hover:bg-surface3 border border-borderDefault rounded-lg text-xs font-semibold text-textPrimary transition-colors cursor-pointer shrink-0"
                      >
                        Chọn...
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Chính sách trùng tên file */}
              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Chính sách trùng tên file
                </label>
                <select
                  value={localOutput.collisionPolicy}
                  onChange={(e) =>
                    setLocalOutput((prev) => ({
                      ...prev,
                      collisionPolicy: e.target.value as BatchCollisionPolicy,
                    }))
                  }
                  className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none"
                >
                  <option value="auto_rename">Tự động đổi tên (_001, _002)</option>
                  <option value="overwrite">Ghi đè file cũ</option>
                  <option value="skip">Bỏ qua nếu đã tồn tại</option>
                </select>
              </div>

              {/* Định dạng Audio & Định dạng Phụ đề */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                    Định dạng Audio
                  </label>
                  <select
                    value={localOutput.outputAudioFormat || "wav"}
                    onChange={(e) =>
                      setLocalOutput((prev) => ({
                        ...prev,
                        outputAudioFormat: e.target.value as "wav" | "mp3",
                      }))
                    }
                    className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none"
                  >
                    <option value="wav">WAV (Không nén)</option>
                    <option value="mp3">MP3 (Chuẩn nén)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                    Định dạng Phụ đề
                  </label>
                  <select
                    value={localOutput.outputSubtitleFormat || "srt"}
                    onChange={(e) => {
                      const fmt = e.target.value as "srt" | "vtt";
                      setLocalOutput((prev) => ({
                        ...prev,
                        outputSubtitleFormat: fmt,
                      }));
                      setLocalDefaults((prev) => ({
                        ...prev,
                        transcription: {
                          ...(prev.transcription || ({} as any)),
                          outputFormat: fmt,
                        },
                      }));
                    }}
                    className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none"
                  >
                    <option value="srt">SRT (SubRip)</option>
                    <option value="vtt">VTT (WebVTT)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: TTS (Đồng bộ 1:1 với TtsInspector) */}
          {activeTab === "tts" && (() => {
            const ttsCfg = localDefaults.tts || {
              model: "omnivoice",
              voiceId: voices[0]?.id || "voice_01",
              speed: 1.0,
              pitch: 1.0,
              volume: 100,
              pauses: DEFAULT_TTS_SETTINGS.pauses,
              exportSrt: false,
            };
            const activeVoice =
              voices.find((v) => v.id === ttsCfg.voiceId) || voices[0];
            const isOnlineVoice = Boolean(
              activeVoice?.isOnline ||
                activeVoice?.provider === "edge" ||
                activeVoice?.provider === "google_translate" ||
                activeVoice?.provider === "openai"
            );
            const selectedModelLabel = normalizeModelSelectValue(ttsCfg.model);
            const speedVal = ttsCfg.speed ?? 1.0;
            const pitchVal =
              typeof ttsCfg.pitch === "number" && ttsCfg.pitch >= 0.5 && ttsCfg.pitch <= 1.5
                ? ttsCfg.pitch
                : 1.0;
            const volumePct =
              typeof ttsCfg.volume === "number"
                ? ttsCfg.volume <= 2.0 && ttsCfg.volume > 0
                  ? Math.round(ttsCfg.volume * 100)
                  : Math.round(ttsCfg.volume)
                : 100;
            const pauses: PunctuationPauses = ttsCfg.pauses || DEFAULT_TTS_SETTINGS.pauses;

            const updateTts = (patch: Partial<typeof ttsCfg>) => {
              setLocalDefaults((prev) => ({
                ...prev,
                tts: {
                  ...ttsCfg,
                  ...(prev.tts || {}),
                  ...patch,
                },
              }));
            };

            return (
              <div className="space-y-4">
                {/* 1. GIỌNG ĐỌC CHÍNH */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                    {t.inspector.primaryVoice || "GIỌNG ĐỌC CHÍNH"}
                  </label>
                  {activeVoice && (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setIsTtsVoiceModalOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setIsTtsVoiceModalOpen(true);
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
                  )}
                </div>

                {/* 2. MODEL */}
                <div className="space-y-1.5 pt-0.5">
                  <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                    {t.inspector.model}
                  </label>
                  {isOnlineVoice ? (
                    <div className="w-full h-[34px] bg-surface2/70 border border-borderDefault rounded-lg px-2.5 flex items-center justify-between text-xs text-textPrimary">
                      <div className="flex items-center gap-2 truncate">
                        <span className="w-2 h-2 rounded-full bg-sky-400" />
                        <span className="font-medium truncate">
                          {activeVoice?.provider === "edge"
                            ? "Microsoft Edge Neural (Cloud API)"
                            : activeVoice?.provider === "google_translate"
                            ? "Google Cloud TTS (API v1)"
                            : "OpenAI Audio TTS"}
                        </span>
                      </div>
                      <span className="text-[10px] text-textMuted uppercase font-mono tracking-wider ml-2 flex-shrink-0">
                        Online
                      </span>
                    </div>
                  ) : (
                    <select
                      value={selectedModelLabel}
                      onChange={(e) => {
                        const mapped = mapSelectToSnapshotModel(e.target.value);
                        updateTts({ model: mapped });
                      }}
                      className="w-full h-[34px] bg-surface2 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
                    >
                      <option value="OmniVoice">OmniVoice (Đa ngữ · Tiếng Việt)</option>
                      <option value="Chatterbox Turbo">Chatterbox Turbo (Tiếng Anh)</option>
                      <option value="Qwen TTS 1.7B">Qwen TTS 1.7B (Đa ngữ · Base)</option>
                    </select>
                  )}
                </div>

                <div className="border-t border-borderDefault/60 pt-1" />

                {/* 3. CÀI ĐẶT */}
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between pb-0.5">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      {t.inspector.settings}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        updateTts({ speed: 1.0, pitch: 1.0, volume: 100 });
                        saveStoredTtsSettings({ speed: 1.0, pitch: 1.0, volume: 1.0 });
                      }}
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
                        {speedVal.toFixed(2)}×
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      value={speedVal}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        updateTts({ speed: val });
                        saveStoredTtsSettings({ speed: val });
                      }}
                      className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                    />
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
                        {pitchVal.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      value={pitchVal}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        updateTts({ pitch: val });
                        saveStoredTtsSettings({ pitch: val });
                      }}
                      className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                    />
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
                        {volumePct}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      step="5"
                      value={volumePct}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        updateTts({ volume: val });
                        saveStoredTtsSettings({ volume: val / 100 });
                      }}
                      className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                      <span>0%</span>
                      <span>200%</span>
                    </div>
                  </div>
                </div>

                {/* 4. NGẮT NGHỈ (Collapsible Accordion) */}
                <div className="pt-2 border-t border-borderDefault/60">
                  <button
                    type="button"
                    onClick={() => setIsTtsPausesOpen(!isTtsPausesOpen)}
                    className="w-full flex items-center justify-between py-2 px-1 rounded-md text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-surface2/40 outline-none focus:outline-none transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-accent" />
                      <span className="uppercase tracking-wider font-bold">
                        {t.inspector.pausesTitle}
                      </span>
                    </div>
                    <ChevronRight
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                        isTtsPausesOpen ? "rotate-90" : ""
                      }`}
                    />
                  </button>

                  {isTtsPausesOpen && (
                    <div className="space-y-3 pt-2">
                      <div className="grid grid-cols-2 gap-3">
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
                              onChange={(e) => {
                                const next = {
                                  ...pauses,
                                  comma: parseFloat(e.target.value) || 0.1,
                                };
                                updateTts({ pauses: next });
                                saveStoredTtsSettings({ pauses: next });
                              }}
                              className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                            />
                            <span className="text-textMuted text-[11px] flex-shrink-0">
                              {t.inspector.sec}
                            </span>
                          </div>
                        </div>

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
                              onChange={(e) => {
                                const next = {
                                  ...pauses,
                                  period: parseFloat(e.target.value) || 0.2,
                                };
                                updateTts({ pauses: next });
                                saveStoredTtsSettings({ pauses: next });
                              }}
                              className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                            />
                            <span className="text-textMuted text-[11px] flex-shrink-0">
                              {t.inspector.sec}
                            </span>
                          </div>
                        </div>

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
                              onChange={(e) => {
                                const next = {
                                  ...pauses,
                                  questionExclamation: parseFloat(e.target.value) || 0.2,
                                };
                                updateTts({ pauses: next });
                                saveStoredTtsSettings({ pauses: next });
                              }}
                              className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                            />
                            <span className="text-textMuted text-[11px] flex-shrink-0">
                              {t.inspector.sec}
                            </span>
                          </div>
                        </div>

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
                              onChange={(e) => {
                                const next = {
                                  ...pauses,
                                  colonSemicolon: parseFloat(e.target.value) || 0.1,
                                };
                                updateTts({ pauses: next });
                                saveStoredTtsSettings({ pauses: next });
                              }}
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

                {/* Voice Selection Modal */}
                <VoiceSelectionModal
                  isOpen={isTtsVoiceModalOpen}
                  onClose={() => setIsTtsVoiceModalOpen(false)}
                  voices={voices}
                  activeVoiceId={ttsCfg.voiceId}
                  currentModel={selectedModelLabel}
                  onSelectVoice={(voice) => {
                    updateTts({ voiceId: voice.id });
                    setIsTtsVoiceModalOpen(false);
                  }}
                />
              </div>
            );
          })()}

          {/* TAB 3: DIALOGUE */}
          {activeTab === "dialogue" && (() => {
            const rawMin = localDefaults.dialogue?.turnPauseMinSec;
            const rawMax = localDefaults.dialogue?.turnPauseMaxSec;
            const isZeroRange = rawMin === 0 && rawMax === 0;

            const minSec =
              typeof rawMin === "number" && !isZeroRange
                ? rawMin
                : 0.40;
            const maxSec =
              typeof rawMax === "number" && !isZeroRange
                ? rawMax
                : 0.70;

            const handleMinChange = (raw: number) => {
              const val = isNaN(raw) ? 0 : Math.max(0, Math.min(2.0, Math.round(raw * 100) / 100));
              let newMax = maxSec;
              if (val > newMax) {
                newMax = val;
              }
              setLocalDefaults((prev) => ({
                ...prev,
                dialogue: {
                  ...(prev.dialogue || ({} as any)),
                  turnPauseMinSec: val,
                  turnPauseMaxSec: newMax,
                },
              }));
            };

            const handleMaxChange = (raw: number) => {
              const val = isNaN(raw) ? 0 : Math.max(0, Math.min(2.0, Math.round(raw * 100) / 100));
              let newMin = minSec;
              if (val < newMin) {
                newMin = val;
              }
              setLocalDefaults((prev) => ({
                ...prev,
                dialogue: {
                  ...(prev.dialogue || ({} as any)),
                  turnPauseMinSec: newMin,
                  turnPauseMaxSec: val,
                },
              }));
            };

            return (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-surface2/60 border border-borderDefault/70 space-y-3">
                  <div className="text-xs font-semibold text-textPrimary">
                    {t.inspector.segmentPauseTitle}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-textSecondary">
                        {t.inspector.min}
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0.00"
                          max="2.00"
                          step="0.05"
                          value={minSec}
                          onChange={(e) => handleMinChange(parseFloat(e.target.value))}
                          className="w-full bg-surface1 border border-borderDefault rounded-lg px-2.5 py-1.5 font-mono text-xs text-textPrimary text-center focus:border-accent focus:outline-none"
                        />
                        <span className="text-textMuted text-xs shrink-0">{t.inspector.sec}</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-textSecondary">
                        {t.inspector.max}
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0.00"
                          max="2.00"
                          step="0.05"
                          value={maxSec}
                          onChange={(e) => handleMaxChange(parseFloat(e.target.value))}
                          className="w-full bg-surface1 border border-borderDefault rounded-lg px-2.5 py-1.5 font-mono text-xs text-textPrimary text-center focus:border-accent focus:outline-none"
                        />
                        <span className="text-textMuted text-xs shrink-0">{t.inspector.sec}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* TAB 4: TRANSCRIPTION */}
          {activeTab === "transcription" && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Mô hình Whisper ASR (Đồng bộ toàn ứng dụng)
                </label>
                <div className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs text-textPrimary flex items-center justify-between">
                  <span className="font-medium text-accent">
                    {loadSubtitleSettings().whisperModel}
                  </span>
                  <span className="text-[11px] text-textMuted italic">
                    Cấu hình tại Tab Phụ đề
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: TRANSLATION */}
          {activeTab === "translation" && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Phong cách dịch mặc định
                </label>
                <select
                  value={localDefaults.translation?.style || "default"}
                  onChange={(e) => {
                    const style = e.target.value as "default" | "cinema";
                    setLocalDefaults((prev) => ({
                      ...prev,
                      translation: { ...(prev.translation || ({} as any)), style },
                    }));
                  }}
                  className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary"
                >
                  <option value="default">Mặc định (Chính xác ngữ nghĩa)</option>
                  <option value="cinema">Cinema Dubbing (Súc tích, khớp timeline)</option>
                </select>
              </div>
            </div>
          )}

          {/* TAB 6: DUBBING */}
          {activeTab === "dubbing" && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Giới hạn tăng tốc WSOLA
                </label>
                <div className="p-3 bg-surface2/60 border border-borderDefault rounded-lg text-xs leading-relaxed text-textSecondary">
                  Tự động co giãn thời lượng để khớp video với trần tốc độ tối đa 1.20x. Nếu vượt quá
                  ngưỡng an toàn, hệ thống kích hoạt cảnh báo va chạm âm thanh.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer with Selection Scope Safeguard (AC-16) */}
        <div className="px-6 py-3.5 border-t border-borderDefault bg-surface1 flex items-center justify-between flex-shrink-0">
          <div className="text-[11px] text-textMuted">
            {selectedJobCount === 0 ? (
              <span className="text-textMuted/70 italic">
                Chọn ít nhất 1 tệp để áp dụng cấu hình.
              </span>
            ) : (
              <span>Áp dụng cấu hình cho {selectedJobCount} tệp đã chọn.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveDefault}
              className="px-3.5 py-1.5 text-xs font-semibold text-textSecondary hover:text-textPrimary bg-surface2 hover:bg-surface3 border border-borderDefault rounded-lg transition-colors cursor-pointer"
              title="Lưu các thông số này làm mẫu mặc định cho các tệp sau"
            >
              Lưu làm mặc định
            </button>

            <button
              type="button"
              disabled={selectedJobCount === 0}
              onClick={handleApply}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
                selectedJobCount === 0
                  ? "bg-surface3 text-textMuted/40 border border-borderDefault/40 cursor-not-allowed"
                  : "bg-accent hover:bg-accentHover text-slate-950 cursor-pointer shadow-sm"
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {selectedJobCount > 0
                  ? `Áp dụng cho ${selectedJobCount} tệp đã chọn`
                  : "Áp dụng"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

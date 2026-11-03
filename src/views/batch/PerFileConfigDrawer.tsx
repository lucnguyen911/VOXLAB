import React, { useState, useEffect } from "react";
import {
  X,
  RotateCcw,
  Check,
  FolderOpen,
  Mic,
  MessageSquare,
  Subtitles,
  Languages,
  Film,
  Clock,
  Volume2,
  Activity,
  Gauge,
  ChevronRight,
  Sparkles,
  Sliders,
} from "lucide-react";
import {
  BatchJob,
  BatchTaskConfigMap,
  BatchJobOutputSnapshot,
  BatchCollisionPolicy,
  BatchDialogueSnapshot,
  BatchTranscriptionSnapshot,
} from "../../types/batch";
import { VoiceProfile, PunctuationPauses } from "../../types/ui";
import { MOCK_VOICES } from "../../mock/data";
import { useI18n } from "../../i18n/context";
import {
  loadSubtitleSettings,
  SubtitleSpeechSpeed,
  SubtitleAspectRatio,
  SubtitleMaxLines,
  WHISPER_AUDIO_LANGUAGES,
} from "../../services/subtitle";
import { SearchableLanguageSelect } from "../../components/common/SearchableLanguageSelect";
import {
  queryHardwareProfile,
  evaluateRecommendedAsrModel,
} from "../../services/ai/hardwareRecommendation";
import {
  loadStoredTtsSettings,
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
import { resolveJobOutputDirectory } from "../../services/batch/outputResolver";
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

export interface PerFileConfigDrawerProps {
  job: BatchJob;
  isOpen: boolean;
  onClose: () => void;
  onSaveOverrides: (
    jobId: string,
    overrides: Partial<BatchTaskConfigMap>,
    outputSnapshot: BatchJobOutputSnapshot
  ) => void;
  onRestoreSnapshot: (jobId: string) => void;
}

export const PerFileConfigDrawer: React.FC<PerFileConfigDrawerProps> = ({
  job,
  isOpen,
  onClose,
  onSaveOverrides,
  onRestoreSnapshot,
}) => {
  if (!isOpen) return null;

  const { t, lang } = useI18n();

  const [activeTab, setActiveTab] = useState<
    "output" | "tts" | "dialogue" | "transcription" | "translation" | "dubbing"
  >("output");
  const [voices, setVoices] = useState<VoiceProfile[]>(loadAvailableVoices);
  const [isTtsVoiceModalOpen, setIsTtsVoiceModalOpen] = useState(false);
  const [isTtsPausesOpen, setIsTtsPausesOpen] = useState(false);
  const [isDialoguePausesOpen, setIsDialoguePausesOpen] = useState(false);
  const [recommendedAsrModel, setRecommendedAsrModel] = useState<string>("large-v3-turbo");

  useEffect(() => {
    let active = true;
    queryHardwareProfile()
      .then((profile) => {
        if (active) {
          const rec = evaluateRecommendedAsrModel(profile);
          setRecommendedAsrModel(rec.recommendedModel);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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

  const [outputSnapshot, setOutputSnapshot] = useState<BatchJobOutputSnapshot>({
    ...job.outputSnapshot,
  });
  const [configOverrides, setConfigOverrides] = useState<Partial<BatchTaskConfigMap>>({
    ...job.configOverrides,
  });

  const handleBrowseFolder = async () => {
    if (!isTauriRuntime()) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: outputSnapshot.resolvedOutputDirectory || undefined,
      });
      if (typeof picked === "string" && picked.trim()) {
        setOutputSnapshot((prev) => ({
          ...prev,
          resolvedOutputDirectory: picked.trim(),
        }));
      }
    } catch (err) {
      console.error("Không thể mở hộp thoại chọn thư mục:", err);
    }
  };

  const previewResolvedDir = resolveJobOutputDirectory({
    ...job,
    outputSnapshot,
  });

  const handleSave = () => {
    onSaveOverrides(job.id, configOverrides, outputSnapshot);
    onClose();
  };

  const handleRestore = () => {
    onRestoreSnapshot(job.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex justify-end animate-in fade-in duration-150">
      <div className="w-full max-w-md h-full bg-panel border-l border-borderDefault shadow-2xl flex flex-col overflow-hidden">
        {/* Drawer Header */}
        <div className="p-4 border-b border-borderDefault bg-surface1 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-sm font-bold text-textPrimary">Tùy chỉnh cấu hình riêng</h3>
            <p className="text-xs text-textMuted font-mono truncate max-w-[280px]">
              {job.sourceFileName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-surface2 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-borderDefault bg-surface1/60 text-xs overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab("output")}
            className={`px-2.5 py-1 rounded font-semibold transition-colors cursor-pointer ${
              activeTab === "output"
                ? "bg-accent/15 text-accent"
                : "text-textMuted hover:text-textPrimary"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Xuất tệp</span>
            </span>
          </button>

          {job.selectedTasks.includes("tts") && (
            <button
              type="button"
              onClick={() => setActiveTab("tts")}
              className={`px-2.5 py-1 rounded font-semibold transition-colors cursor-pointer ${
                activeTab === "tts"
                  ? "bg-accent/15 text-accent"
                  : "text-textMuted hover:text-textPrimary"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5" />
                <span>TTS</span>
              </span>
            </button>
          )}

          {job.selectedTasks.includes("dialogue") && (
            <button
              type="button"
              onClick={() => setActiveTab("dialogue")}
              className={`px-2.5 py-1 rounded font-semibold transition-colors cursor-pointer ${
                activeTab === "dialogue"
                  ? "bg-accent/15 text-accent"
                  : "text-textMuted hover:text-textPrimary"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Hội thoại</span>
              </span>
            </button>
          )}

          {job.selectedTasks.includes("transcription") && (
            <button
              type="button"
              onClick={() => setActiveTab("transcription")}
              className={`px-2.5 py-1 rounded font-semibold transition-colors cursor-pointer ${
                activeTab === "transcription"
                  ? "bg-accent/15 text-accent"
                  : "text-textMuted hover:text-textPrimary"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Subtitles className="w-3.5 h-3.5" />
                <span>Phụ đề</span>
              </span>
            </button>
          )}

          {job.selectedTasks.includes("translation") && (
            <button
              type="button"
              onClick={() => setActiveTab("translation")}
              className={`px-2.5 py-1 rounded font-semibold transition-colors cursor-pointer ${
                activeTab === "translation"
                  ? "bg-accent/15 text-accent"
                  : "text-textMuted hover:text-textPrimary"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Languages className="w-3.5 h-3.5" />
                <span>Dịch</span>
              </span>
            </button>
          )}

          {job.selectedTasks.includes("dubbing") && (
            <button
              type="button"
              onClick={() => setActiveTab("dubbing")}
              className={`px-2.5 py-1 rounded font-semibold transition-colors cursor-pointer ${
                activeTab === "dubbing"
                  ? "bg-accent/15 text-accent"
                  : "text-textMuted hover:text-textPrimary"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5" />
                <span>Lồng tiếng</span>
              </span>
            </button>
          )}
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* TAB 1: OUTPUT SETTINGS */}
          {activeTab === "output" && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Chế độ vị trí lưu
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setOutputSnapshot((prev) => ({
                        ...prev,
                        saveInSourceFolder: false,
                        flatOutputDirectory: true,
                      }))
                    }
                    className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                      !outputSnapshot.saveInSourceFolder
                        ? "border-accent bg-accent/10 text-textPrimary"
                        : "border-borderDefault bg-surface2 text-textSecondary hover:bg-surface3/60"
                    }`}
                  >
                    <div className="font-bold text-[11px]">1 thư mục cố định</div>
                    <div className="text-[10px] text-textMuted">Lưu chung tại folder đích</div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setOutputSnapshot((prev) => ({
                        ...prev,
                        saveInSourceFolder: true,
                        flatOutputDirectory: false,
                      }))
                    }
                    className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                      outputSnapshot.saveInSourceFolder
                        ? "border-accent bg-accent/10 text-textPrimary"
                        : "border-borderDefault bg-surface2 text-textSecondary hover:bg-surface3/60"
                    }`}
                  >
                    <div className="font-bold text-[11px]">Tại thư mục chứa file</div>
                    <div className="text-[10px] text-textMuted">Tạo folder theo tên file gốc</div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Thư mục xuất kết quả
                </label>
                {!outputSnapshot.saveInSourceFolder ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={outputSnapshot.resolvedOutputDirectory}
                      onChange={(e) =>
                        setOutputSnapshot((prev) => ({
                          ...prev,
                          resolvedOutputDirectory: e.target.value,
                        }))
                      }
                      className="flex-1 bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary font-mono focus:border-accent focus:outline-none"
                      placeholder="D:/VoxLabOutput/Batch_Export"
                    />
                    {isTauriRuntime() && (
                      <button
                        type="button"
                        onClick={handleBrowseFolder}
                        className="px-2.5 py-1.5 bg-surface2 hover:bg-surface3 border border-borderDefault rounded-lg text-xs font-semibold text-textPrimary transition-colors cursor-pointer shrink-0"
                      >
                        Chọn...
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="w-full bg-surface2/70 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary font-mono break-all">
                    {previewResolvedDir}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Chính sách trùng tên file
                </label>
                <select
                  value={outputSnapshot.collisionPolicy}
                  onChange={(e) =>
                    setOutputSnapshot((prev) => ({
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

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                    Định dạng Audio
                  </label>
                  <select
                    value={outputSnapshot.outputAudioFormat || "wav"}
                    onChange={(e) =>
                      setOutputSnapshot((prev) => ({
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
                    value={outputSnapshot.outputSubtitleFormat || "srt"}
                    onChange={(e) =>
                      setOutputSnapshot((prev) => ({
                        ...prev,
                        outputSubtitleFormat: e.target.value as "srt" | "vtt",
                      }))
                    }
                    className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none"
                  >
                    <option value="srt">SRT (SubRip)</option>
                    <option value="vtt">VTT (WebVTT)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: TTS OVERRIDES (Đồng bộ 1:1 với TtsInspector) */}
          {activeTab === "tts" && (() => {
            const storedTts = loadStoredTtsSettings();
            const existingTts = configOverrides.tts;
            const ttsCfg = {
              model: existingTts?.model || "omnivoice",
              voiceId:
                existingTts?.voiceId && existingTts.voiceId !== "omnivoice-auto"
                  ? existingTts.voiceId
                  : voices[0]?.id || "voice_01",
              speed: existingTts?.speed ?? storedTts.speed ?? 1.0,
              pitch:
                typeof existingTts?.pitch === "number" &&
                existingTts.pitch >= 0.5 &&
                existingTts.pitch <= 1.5
                  ? existingTts.pitch
                  : storedTts.pitch || 1.0,
              volume:
                typeof existingTts?.volume === "number"
                  ? existingTts.volume <= 2.0 && existingTts.volume > 0
                    ? Math.round(existingTts.volume * 100)
                    : Math.round(existingTts.volume)
                  : Math.round((storedTts.volume ?? 1.0) * 100),
              pauses: existingTts?.pauses || storedTts.pauses || DEFAULT_TTS_SETTINGS.pauses,
              exportSrt: existingTts?.exportSrt ?? storedTts.exportSrt ?? false,
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
            const pauses: PunctuationPauses = ttsCfg.pauses;

            const updateTts = (patch: Partial<typeof ttsCfg>) => {
              setConfigOverrides((prev) => ({
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
                      className="p-3 bg-surface2/60 hover:bg-surface2 border border-borderDefault hover:border-accent/50 rounded-xl transition-all cursor-pointer flex items-center justify-between gap-3 group shadow-2xs"
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
                      onChange={(e) =>
                        updateTts({ model: mapSelectToSnapshotModel(e.target.value) })
                      }
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
                      onClick={() => updateTts({ speed: 1.0, pitch: 1.0, volume: 100 })}
                      className="flex items-center gap-1 text-xs text-textMuted hover:text-accent rounded px-1.5 py-0.5 transition-colors cursor-pointer"
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
                        {ttsCfg.speed.toFixed(2)}×
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      value={ttsCfg.speed}
                      onChange={(e) => updateTts({ speed: parseFloat(e.target.value) })}
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
                        {ttsCfg.pitch.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      value={ttsCfg.pitch}
                      onChange={(e) => updateTts({ pitch: parseFloat(e.target.value) })}
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
                        {ttsCfg.volume}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      step="5"
                      value={ttsCfg.volume}
                      onChange={(e) => updateTts({ volume: parseInt(e.target.value, 10) })}
                      className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                      <span>0%</span>
                      <span>200%</span>
                    </div>
                  </div>
                </div>

                {/* 4. NGẮT NGHỈ */}
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
                              onChange={(e) =>
                                updateTts({
                                  pauses: {
                                    ...pauses,
                                    comma: parseFloat(e.target.value) || 0.1,
                                  },
                                })
                              }
                              className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
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
                              onChange={(e) =>
                                updateTts({
                                  pauses: {
                                    ...pauses,
                                    period: parseFloat(e.target.value) || 0.2,
                                  },
                                })
                              }
                              className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
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
                              onChange={(e) =>
                                updateTts({
                                  pauses: {
                                    ...pauses,
                                    questionExclamation: parseFloat(e.target.value) || 0.2,
                                  },
                                })
                              }
                              className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
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
                              onChange={(e) =>
                                updateTts({
                                  pauses: {
                                    ...pauses,
                                    colonSemicolon: parseFloat(e.target.value) || 0.1,
                                  },
                                })
                              }
                              className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
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

          {/* TAB: DIALOGUE OVERRIDES */}
          {activeTab === "dialogue" && (() => {
            const currentDialogue: Partial<BatchDialogueSnapshot> = configOverrides.dialogue || {};
            const baseDialogue = job.effectiveConfigSnapshot?.tasks.dialogue;
            const rawMin = currentDialogue.turnPauseMinSec;
            const rawMax = currentDialogue.turnPauseMaxSec;
            const isZeroRange = rawMin === 0 && rawMax === 0;

            const minSec =
              typeof rawMin === "number" && !isZeroRange
                ? rawMin
                : (typeof currentDialogue.turnPauseSec === "number" && currentDialogue.turnPauseSec > 0
                  ? currentDialogue.turnPauseSec
                  : (typeof baseDialogue?.turnPauseMinSec === "number" && (baseDialogue.turnPauseMinSec > 0 || (baseDialogue.turnPauseMaxSec ?? 0) > 0)
                    ? baseDialogue.turnPauseMinSec
                    : 0.40));
            const maxSec =
              typeof rawMax === "number" && !isZeroRange
                ? rawMax
                : (typeof currentDialogue.turnPauseSec === "number" && currentDialogue.turnPauseSec > 0
                  ? currentDialogue.turnPauseSec
                  : (typeof baseDialogue?.turnPauseMaxSec === "number" && (baseDialogue.turnPauseMaxSec > 0 || (baseDialogue.turnPauseMinSec ?? 0) > 0)
                    ? baseDialogue.turnPauseMaxSec
                    : 0.70));

            const dlgModel = currentDialogue.model || baseDialogue?.model || "omnivoice";
            const selectedModelLabel = normalizeModelSelectValue(dlgModel);
            const speedVal =
              typeof currentDialogue.speed === "number"
                ? currentDialogue.speed
                : typeof baseDialogue?.speed === "number"
                ? baseDialogue.speed
                : 1.0;
            const rawPitch = currentDialogue.pitch ?? baseDialogue?.pitch;
            const pitchVal =
              typeof rawPitch === "number" && rawPitch >= 0.5 && rawPitch <= 1.5
                ? rawPitch
                : 1.0;
            const rawVol = currentDialogue.volume ?? baseDialogue?.volume;
            const volumePct =
              typeof rawVol === "number"
                ? rawVol <= 2.0 && rawVol > 0
                  ? Math.round(rawVol * 100)
                  : Math.round(rawVol)
                : 100;
            const pauses: PunctuationPauses =
              currentDialogue.pauses || baseDialogue?.pauses || DEFAULT_TTS_SETTINGS.pauses;

            const updateDialogue = (patch: Partial<BatchDialogueSnapshot>) => {
              setConfigOverrides((prev) => ({
                ...prev,
                dialogue: {
                  model: dlgModel,
                  defaultVoiceId:
                    currentDialogue.defaultVoiceId ||
                    baseDialogue?.defaultVoiceId ||
                    "omnivoice-auto",
                  sameSpeakerPauseSec:
                    currentDialogue.sameSpeakerPauseSec ??
                    baseDialogue?.sameSpeakerPauseSec ??
                    0.3,
                  exportSrt: currentDialogue.exportSrt ?? baseDialogue?.exportSrt ?? true,
                  ...(prev.dialogue || {}),
                  ...patch,
                },
              }));
            };

            const handleMinChange = (raw: number) => {
              const val = isNaN(raw) ? 0 : Math.max(0, Math.min(2.0, Math.round(raw * 100) / 100));
              let newMax = maxSec;
              if (val > newMax) {
                newMax = val;
              }
              updateDialogue({
                turnPauseMinSec: val,
                turnPauseMaxSec: newMax,
              });
            };

            const handleMaxChange = (raw: number) => {
              const val = isNaN(raw) ? 0 : Math.max(0, Math.min(2.0, Math.round(raw * 100) / 100));
              let newMin = minSec;
              if (val < newMin) {
                newMin = val;
              }
              updateDialogue({
                turnPauseMinSec: newMin,
                turnPauseMaxSec: val,
              });
            };

            return (
              <div className="space-y-4">
                {/* 1. MODEL */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                    {t.inspector.model}
                  </label>
                  <select
                    value={selectedModelLabel}
                    onChange={(e) => {
                      const mapped = mapSelectToSnapshotModel(e.target.value);
                      updateDialogue({ model: mapped });
                    }}
                    className="w-full h-[34px] bg-surface2 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
                  >
                    <option value="OmniVoice">OmniVoice (Đa ngữ · Tiếng Việt)</option>
                    <option value="Chatterbox Turbo">Chatterbox Turbo (Tiếng Anh)</option>
                    <option value="Qwen TTS 1.7B">Qwen TTS 1.7B (Đa ngữ · Base)</option>
                  </select>
                </div>

                <div className="border-t border-borderDefault/60 pt-1" />

                {/* 2. CÀI ĐẶT */}
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between pb-0.5">
                    <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
                      {t.inspector.settings}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        updateDialogue({ speed: 1.0, pitch: 1.0, volume: 100 })
                      }
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
                      onChange={(e) =>
                        updateDialogue({ speed: parseFloat(e.target.value) })
                      }
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
                      onChange={(e) =>
                        updateDialogue({ pitch: parseFloat(e.target.value) })
                      }
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
                      onChange={(e) =>
                        updateDialogue({ volume: parseInt(e.target.value, 10) })
                      }
                      className="w-full accent-accent bg-surface3 h-1.5 rounded-full appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-[11px] text-textMuted pt-0.5">
                      <span>0%</span>
                      <span>200%</span>
                    </div>
                  </div>
                </div>

                {/* 3. NGẮT NGHỈ (Collapsible Accordion) */}
                <div className="pt-2 border-t border-borderDefault/60">
                  <button
                    type="button"
                    onClick={() => setIsDialoguePausesOpen(!isDialoguePausesOpen)}
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
                        isDialoguePausesOpen ? "rotate-90" : ""
                      }`}
                    />
                  </button>

                  {isDialoguePausesOpen && (
                    <div className="space-y-3.5 pt-2">
                      {/* Segment Turn Pause (Min - Max) */}
                      <div className="space-y-2">
                        <div className="text-[10px] font-semibold text-textMuted uppercase tracking-wider px-0.5">
                          {t.inspector.segmentPauseTitle}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              {t.inspector.min}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.00"
                                max="2.00"
                                step="0.05"
                                value={minSec}
                                onChange={(e) => handleMinChange(parseFloat(e.target.value))}
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                {t.inspector.sec}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <span className="text-xs font-medium text-textSecondary block truncate">
                              {t.inspector.max}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0.00"
                                max="2.00"
                                step="0.05"
                                value={maxSec}
                                onChange={(e) => handleMaxChange(parseFloat(e.target.value))}
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                {t.inspector.sec}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Punctuation Pauses */}
                      <div className="space-y-2 pt-1">
                        <div className="text-[10px] font-semibold text-textMuted uppercase tracking-wider px-0.5">
                          {t.inspector.punctuationPausesTitle}
                        </div>
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
                                onChange={(e) =>
                                  updateDialogue({
                                    pauses: {
                                      ...pauses,
                                      comma: parseFloat(e.target.value) || 0.1,
                                    },
                                  })
                                }
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
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
                                onChange={(e) =>
                                  updateDialogue({
                                    pauses: {
                                      ...pauses,
                                      period: parseFloat(e.target.value) || 0.2,
                                    },
                                  })
                                }
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
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
                                onChange={(e) =>
                                  updateDialogue({
                                    pauses: {
                                      ...pauses,
                                      questionExclamation: parseFloat(e.target.value) || 0.2,
                                    },
                                  })
                                }
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
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
                                onChange={(e) =>
                                  updateDialogue({
                                    pauses: {
                                      ...pauses,
                                      colonSemicolon: parseFloat(e.target.value) || 0.1,
                                    },
                                  })
                                }
                                className="w-full h-8 bg-surface1 border border-borderDefault rounded-lg px-2 text-xs text-textPrimary font-mono text-center focus:border-accent focus:outline-none"
                              />
                              <span className="text-textMuted text-[11px] flex-shrink-0">
                                {t.inspector.sec}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* TAB: TRANSCRIPTION OVERRIDES */}
          {activeTab === "transcription" && (() => {
            const subSettings = loadSubtitleSettings();
            const currentTrans: Partial<BatchTranscriptionSnapshot> = configOverrides.transcription || {};
            const baseTrans = job.effectiveConfigSnapshot?.tasks.transcription;

            const rawModel =
              currentTrans.whisperModel ||
              baseTrans?.whisperModel ||
              subSettings.whisperModel ||
              "large-v3-turbo";
            const whisperModelVal = rawModel === "auto" ? "large-v3-turbo" : rawModel;
            const audioLangVal =
              currentTrans.audioLanguage ||
              baseTrans?.audioLanguage ||
              subSettings.audioLanguage ||
              "auto";
            const speechSpeedVal =
              currentTrans.speechSpeed ??
              baseTrans?.speechSpeed ??
              subSettings.speechSpeed ??
              1.0;
            const aspectRatioVal: SubtitleAspectRatio =
              currentTrans.aspectRatio ||
              baseTrans?.aspectRatio ||
              subSettings.aspectRatio ||
              "16:9";
            const maxLinesVal: SubtitleMaxLines =
              currentTrans.maxLines ||
              baseTrans?.maxLines ||
              subSettings.maxLines ||
              1;

            const updateTranscription = (patch: Partial<BatchTranscriptionSnapshot>) => {
              setConfigOverrides((prev) => ({
                ...prev,
                transcription: {
                  audioLanguage: audioLangVal,
                  whisperModel: whisperModelVal,
                  speechSpeed: speechSpeedVal,
                  aspectRatio: aspectRatioVal,
                  maxLines: maxLinesVal,
                  outputFormat: (outputSnapshot.outputSubtitleFormat || "srt") as "srt" | "vtt",
                  ...(prev.transcription || {}),
                  ...patch,
                },
              }));
            };

            return (
              <div className="space-y-4">
                {/* Group 1: Nhận diện */}
                <div className="space-y-3 p-3.5 bg-surface2/40 rounded-xl border border-borderDefault">
                  <div className="flex items-center gap-1.5 pb-1.5 border-b border-borderDefault/60">
                    <Sparkles className="w-3.5 h-3.5 text-accent" />
                    <span className="font-semibold text-xs text-textPrimary uppercase tracking-wide">
                      {t.transcription.recognitionGroupTitle}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-textSecondary font-medium text-[11px]">
                      {t.transcription.modelLabel}
                    </label>
                    <select
                      value={whisperModelVal}
                      onChange={(e) => updateTranscription({ whisperModel: e.target.value })}
                      className="w-full bg-surface1 border border-borderDefault rounded-md px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none cursor-pointer"
                    >
                      <option value="large-v3-turbo">
                        {t.transcription.whisperModelTurbo}
                        {recommendedAsrModel === "large-v3-turbo"
                          ? ` · (${t.transcription.recommendedBadge})`
                          : ""}
                      </option>
                      <option value="large-v3">
                        {t.transcription.whisperModelLarge}
                        {recommendedAsrModel === "large-v3"
                          ? ` · (${t.transcription.recommendedBadge})`
                          : ""}
                      </option>
                      <option value="medium">
                        {t.transcription.whisperModelMedium}
                        {recommendedAsrModel === "medium"
                          ? ` · (${t.transcription.recommendedBadge})`
                          : ""}
                      </option>
                      <option value="small">
                        {t.transcription.whisperModelSmall}
                        {recommendedAsrModel === "small"
                          ? ` · (${t.transcription.recommendedBadge})`
                          : ""}
                      </option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-textSecondary font-medium text-[11px]">
                      {t.transcription.langAudio}
                    </label>
                    <SearchableLanguageSelect
                      value={audioLangVal}
                      onChange={(code) => updateTranscription({ audioLanguage: code })}
                      languages={WHISPER_AUDIO_LANGUAGES}
                      searchPlaceholder={
                        lang === "vi" ? "Tìm ngôn ngữ âm thanh..." : "Search audio language..."
                      }
                      ariaLabel={t.transcription.langAudio}
                      size="sm"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-textSecondary font-medium text-[11px]">
                      {t.transcription.speechSpeedLabel}
                    </label>
                    <select
                      value={speechSpeedVal}
                      onChange={(e) =>
                        updateTranscription({
                          speechSpeed: Number(e.target.value) as SubtitleSpeechSpeed,
                        })
                      }
                      className="w-full bg-surface1 border border-borderDefault rounded-md px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none cursor-pointer"
                    >
                      <option value={1.0}>{t.transcription.speechSpeedNormal}</option>
                      <option value={0.9}>{t.transcription.speechSpeedFast}</option>
                      <option value={0.8}>{t.transcription.speechSpeedVeryFast}</option>
                    </select>
                  </div>
                </div>

                {/* Group 2: Hiển thị */}
                <div className="space-y-3 p-3.5 bg-surface2/40 rounded-xl border border-borderDefault">
                  <div className="flex items-center gap-1.5 pb-1.5 border-b border-borderDefault/60">
                    <Sliders className="w-3.5 h-3.5 text-accent" />
                    <span className="font-semibold text-xs text-textPrimary uppercase tracking-wide">
                      {t.transcription.displayGroupTitle}
                    </span>
                  </div>

                  {/* Tỷ lệ khung hình */}
                  <div className="space-y-1.5">
                    <label className="block text-textSecondary font-medium text-[11px]">
                      {t.transcription.aspectRatioLabel}
                    </label>
                    <div className="grid grid-cols-3 gap-1 p-1 bg-surface1 rounded-lg border border-borderDefault">
                      {(["16:9", "9:16", "1:1"] as SubtitleAspectRatio[]).map((ratio) => {
                        const isSelected = aspectRatioVal === ratio;
                        const labels: Record<SubtitleAspectRatio, { ratio: string; sub: string }> = {
                          "16:9": { ratio: "16:9", sub: "Ngang" },
                          "9:16": { ratio: "9:16", sub: "Dọc" },
                          "1:1": { ratio: "1:1", sub: "Vuông" },
                        };
                        const info = labels[ratio];
                        return (
                          <button
                            key={ratio}
                            type="button"
                            onClick={() => updateTranscription({ aspectRatio: ratio })}
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
                        const isSelected = maxLinesVal === lines;
                        return (
                          <button
                            key={lines}
                            type="button"
                            onClick={() => updateTranscription({ maxLines: lines })}
                            className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all text-center cursor-pointer ${
                              isSelected
                                ? "bg-accent text-background font-semibold shadow-sm"
                                : "text-textSecondary hover:text-textPrimary hover:bg-surface2/60"
                            }`}
                          >
                            {lines} dòng
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* TAB 3: TRANSLATION OVERRIDES */}
          {activeTab === "translation" && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Phong cách dịch
                </label>
                <select
                  value={configOverrides.translation?.style || "default"}
                  onChange={(e) => {
                    const style = e.target.value as "default" | "cinema";
                    setConfigOverrides((prev) => ({
                      ...prev,
                      translation: {
                        ...(prev.translation || {}),
                        style,
                      } as any,
                    }));
                  }}
                  className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none"
                >
                  <option value="default">Mặc định (Chính xác ngữ nghĩa)</option>
                  <option value="cinema">Cinema Dubbing (Súc tích, khớp timeline)</option>
                </select>
              </div>
            </div>
          )}

          {/* TAB 4: DUBBING OVERRIDES */}
          {activeTab === "dubbing" && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Hệ số tốc độ (Speed Multiplier)
                </label>
                <input
                  type="range"
                  min="0.8"
                  max="1.2"
                  step="0.05"
                  value={configOverrides.dubbing?.speedMultiplier ?? 1.0}
                  onChange={(e) => {
                    const speedMultiplier = parseFloat(e.target.value);
                    setConfigOverrides((prev) => ({
                      ...prev,
                      dubbing: {
                        ...(prev.dubbing || {}),
                        speedMultiplier,
                      } as any,
                    }));
                  }}
                  className="w-full accent-accent bg-surface3 h-1.5 rounded-full cursor-pointer"
                />
                <span className="font-mono text-accent text-right block">
                  {(configOverrides.dubbing?.speedMultiplier ?? 1.0).toFixed(2)}x
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-borderDefault bg-surface1 flex items-center justify-between flex-shrink-0">
          {job.effectiveConfigSnapshot && (
            <button
              type="button"
              onClick={handleRestore}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 cursor-pointer"
              title="Khôi phục cấu hình về đúng snapshot gốc (CTA sẽ hoàn nguyên về Thử lại)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Khôi phục snapshot</span>
            </button>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-semibold text-textSecondary hover:text-textPrimary bg-surface2 rounded-lg cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-slate-950 bg-accent hover:bg-accentHover rounded-lg cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Áp dụng</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

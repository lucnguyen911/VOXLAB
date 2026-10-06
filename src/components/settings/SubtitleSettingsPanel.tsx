import React, { useState } from "react";
import {
  Captions,
  Languages,
  Plus,
  Sparkles,
  HelpCircle,
  Trash2,
} from "lucide-react";
import {
  SubtitleSettings,
  SubtitleAspectRatio,
  SubtitleMaxLines,
  SubtitleSpeechSpeed,
  SubtitleProcessingSpeed,
  loadSubtitleSettings,
  saveSubtitleSettings,
} from "../../services/subtitle";
import {
  WHISPER_AUDIO_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
} from "../../services/subtitle/languages";
import { SearchableLanguageSelect } from "../common/SearchableLanguageSelect";
import { WhisperModelSelect, WhisperModelOption } from "../common/WhisperModelSelect";
import { AddTranslationModelModal } from "../modals/AddTranslationModelModal";
import {
  translationManager,
  TranslationProvider,
  loadTranslationSettings,
  saveTranslationSettings,
  TranslationSettings,
} from "../../services/translation";

export const SubtitleSettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<SubtitleSettings>(() => loadSubtitleSettings());
  const [transSettings, setTransSettings] = useState<TranslationSettings>(() => loadTranslationSettings());
  const [providers, setProviders] = useState<TranslationProvider[]>(() =>
    translationManager.listProviders()
  );
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Whisper model options
  const whisperModels: WhisperModelOption[] = [
    {
      id: "large-v3-turbo",
      label: "large-v3-turbo",
      desc: "Nhanh, chính xác tốt · Khuyên dùng",
    },
    {
      id: "large-v3",
      label: "large-v3",
      desc: "Chính xác tối đa · Yêu cầu cấu hình mạnh",
    },
    {
      id: "medium",
      label: "medium",
      desc: "Nhanh, nhẹ máy · Độ chính xác khá",
    },
  ];

  // Speech speed options
  const speechSpeeds: { id: SubtitleSpeechSpeed; label: string; desc: string }[] = [
    { id: 1.0, label: "1.0x — Bình thường", desc: "Mặc định · Không làm chậm" },
    { id: 0.9, label: "0.9x — Cho giọng nói nhanh", desc: "Tăng độ chính xác cho bài giảng, nói nhanh" },
    { id: 0.8, label: "0.8x — Cho giọng nói rất nhanh", desc: "Tối ưu tin tức, podcast nhanh, rap" },
  ];

  // Processing speed options (Batch size abstraction)
  const processingSpeeds: { id: SubtitleProcessingSpeed; label: string; desc: string }[] = [
    { id: "auto", label: "Tự động — Khuyên dùng", desc: "Tối ưu thông minh theo GPU và phần cứng" },
    { id: "1x", label: "1x — Tiết kiệm VRAM", desc: "Chạy tuần tự · Ít tốn bộ nhớ đồ họa nhất" },
    { id: "2x", label: "2x — Nhanh", desc: "Song song vừa · Cân bằng tải" },
    { id: "4x", label: "4x — Rất nhanh", desc: "Xử lý hàng loạt tốc độ cao" },
    { id: "8x", label: "8x — Cần nhiều VRAM", desc: "Tối đa công suất · Yêu cầu GPU mạnh (>12GB VRAM)" },
  ];

  // Aspect ratio options (without exposing technical character limits)
  const aspectRatios: { id: SubtitleAspectRatio; label: string; desc: string }[] = [
    { id: "16:9", label: "16:9 — Ngang", desc: "YouTube, Phim, Màn hình ngang" },
    { id: "9:16", label: "9:16 — Dọc", desc: "TikTok, Shorts, Reels" },
    { id: "1:1", label: "1:1 — Vuông", desc: "Instagram, Facebook Feed" },
  ];

  // Max lines options
  const maxLinesOptions: { id: SubtitleMaxLines; label: string; desc: string }[] = [
    { id: 2, label: "2 dòng — Khuyên dùng", desc: "Độ dài dòng cân bằng, dễ đọc" },
    { id: 1, label: "1 dòng", desc: "Phụ đề 1 hàng duy nhất cho video ngắn" },
  ];

  const updateSetting = <K extends keyof SubtitleSettings>(key: K, value: SubtitleSettings[K]) => {
    const updated = {
      ...settings,
      [key]: value,
    };
    setSettings(updated);
    saveSubtitleSettings(updated);
  };

  const updateTransSetting = <K extends keyof TranslationSettings>(
    key: K,
    value: TranslationSettings[K]
  ) => {
    const updated = saveTranslationSettings({ [key]: value });
    setTransSettings(updated);
  };

  const handleModelAdded = () => {
    setProviders(translationManager.listProviders());
    setTransSettings(loadTranslationSettings());
  };

  const handleDeleteCustomModel = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    translationManager.deleteCustomModel(id);
    setProviders(translationManager.listProviders());
    setTransSettings(loadTranslationSettings());
  };

  const currentProvider = providers.find((p) => p.id === transSettings.translationProviderId) || providers[0];
  const isLocalProvider = currentProvider?.badge === "Local" || currentProvider?.type === "lmstudio";

  // Dynamic helper text for Whisper model
  const whisperHelperText =
    settings.whisperModel === "large-v3-turbo"
      ? "Nhanh, chính xác tốt · Khuyên dùng."
      : settings.whisperModel === "large-v3"
      ? "Chính xác tối đa · Yêu cầu cấu hình mạnh."
      : "Nhanh, nhẹ máy · Độ chính xác khá.";

  return (
    <div className="space-y-6 select-none w-full">
      {/* Header */}
      <div>
        <h3 className="text-sm font-bold text-textPrimary">Cài đặt phụ đề</h3>
        <p className="text-xs text-textMuted mt-0.5">
          Cấu hình quy chuẩn nhận diện giọng nói và dịch phụ đề tự động cho VoxLab Studio.
        </p>
      </div>

      {/* ======================================================== */}
      {/* 1. SECTION: PHỤ ĐỀ */}
      {/* ======================================================== */}
      <div className="p-5 bg-surface1 rounded-2xl border border-borderDefault space-y-5 shadow-xs">
        <div className="flex items-center gap-2 pb-2.5 border-b border-borderDefault">
          <Captions className="w-4 h-4 text-accent" />
          <h4 className="font-bold text-xs uppercase tracking-wider text-textPrimary">
            Phụ đề
          </h4>
        </div>

        {/* Logical Group 1: Nhận diện giọng nói (Asymmetric 3 columns on wide desktop) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_1.35fr_1fr] gap-4">
          {/* 1. Ngôn ngữ âm thanh (1.0fr) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-textSecondary block">
              Ngôn ngữ âm thanh
            </label>
            <SearchableLanguageSelect
              value={settings.audioLanguage}
              onChange={(code) => updateSetting("audioLanguage", code)}
              languages={WHISPER_AUDIO_LANGUAGES}
              searchPlaceholder="Tìm ngôn ngữ..."
              ariaLabel="Ngôn ngữ âm thanh"
            />
            <p className="text-[11px] text-textMuted leading-tight">
              Tự động nhận diện nếu không chọn ngôn ngữ cụ thể.
            </p>
          </div>

          {/* 2. Mô hình Whisper (1.35fr - extra width for desktop readability) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-textSecondary block">
              Mô hình Whisper
            </label>
            <WhisperModelSelect
              value={settings.whisperModel}
              onChange={(modelId) => updateSetting("whisperModel", modelId)}
              models={whisperModels}
              ariaLabel="Mô hình Whisper"
            />
            <p className="text-[11px] text-textMuted leading-tight">
              {whisperHelperText}
            </p>
          </div>

          {/* 3. Tốc độ giọng nói (1.0fr) */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold text-textSecondary">
                Tốc độ giọng nói
              </label>
              <div
                className="text-textMuted hover:text-textPrimary cursor-help transition-colors"
                title="Làm chậm audio tạm thời khi nhận diện. Không thay đổi audio gốc hoặc timestamp."
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </div>
            </div>
            <select
              value={settings.speechSpeed}
              onChange={(e) =>
                updateSetting("speechSpeed", parseFloat(e.target.value) as SubtitleSpeechSpeed)
              }
              className="w-full bg-surface2 border border-borderDefault hover:border-textMuted/60 focus:border-accent rounded-lg px-3 py-2 text-xs text-textPrimary focus:outline-none transition-colors cursor-pointer select-none"
            >
              {speechSpeeds.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-textMuted leading-tight">
              Làm chậm audio tạm thời khi nhận diện. Không thay đổi audio gốc hoặc timestamp.
            </p>
          </div>
        </div>

        {/* Logical Group 2: Hiển thị & Xử lý (Balanced 3 columns) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
          {/* 4. Tốc độ xử lý */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-textSecondary block">
              Tốc độ xử lý
            </label>
            <select
              value={settings.processingSpeed}
              onChange={(e) =>
                updateSetting(
                  "processingSpeed",
                  e.target.value as SubtitleProcessingSpeed
                )
              }
              className="w-full bg-surface2 border border-borderDefault hover:border-textMuted/60 focus:border-accent rounded-lg px-3 py-2 text-xs text-textPrimary focus:outline-none transition-colors cursor-pointer select-none"
            >
              {processingSpeeds.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-textMuted leading-tight">
              Tự động tối ưu theo GPU và VRAM.
            </p>
          </div>

          {/* 5. Tỷ lệ khung hình */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-textSecondary block">
              Tỷ lệ khung hình
            </label>
            <select
              value={settings.aspectRatio}
              onChange={(e) =>
                updateSetting("aspectRatio", e.target.value as SubtitleAspectRatio)
              }
              className="w-full bg-surface2 border border-borderDefault hover:border-textMuted/60 focus:border-accent rounded-lg px-3 py-2 text-xs text-textPrimary focus:outline-none transition-colors cursor-pointer select-none"
            >
              {aspectRatios.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-textMuted leading-tight">
              Điều chỉnh độ dài phụ đề theo định dạng video.
            </p>
          </div>

          {/* 6. Số dòng phụ đề */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-textSecondary block">
              Số dòng phụ đề
            </label>
            <select
              value={settings.maxLines}
              onChange={(e) =>
                updateSetting("maxLines", parseInt(e.target.value, 10) as SubtitleMaxLines)
              }
              className="w-full bg-surface2 border border-borderDefault hover:border-textMuted/60 focus:border-accent rounded-lg px-3 py-2 text-xs text-textPrimary focus:outline-none transition-colors cursor-pointer select-none"
            >
              {maxLinesOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-textMuted leading-tight">
              2 dòng giúp cân bằng độ dài và khả năng đọc.
            </p>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 2. SECTION: DỊCH PHỤ ĐỀ */}
      {/* ======================================================== */}
      <div className="p-5 bg-surface1 rounded-2xl border border-borderDefault space-y-5 shadow-xs">
        <div className="flex items-center justify-between pb-2.5 border-b border-borderDefault">
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-accent" />
            <h4 className="font-bold text-xs uppercase tracking-wider text-textPrimary">
              Dịch phụ đề
            </h4>
          </div>
        </div>

        {/* 2 Main Translation Settings */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1. Ngôn ngữ đích */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-textSecondary block">
              Ngôn ngữ đích
            </label>
            <SearchableLanguageSelect
              value={transSettings.targetLanguage}
              onChange={(code) => updateTransSetting("targetLanguage", code)}
              languages={TRANSLATION_TARGET_LANGUAGES}
              searchPlaceholder="Tìm ngôn ngữ đích..."
              ariaLabel="Ngôn ngữ đích"
            />
            <p className="text-[11px] text-textMuted leading-tight">
              Bản dịch phụ đề sẽ được chuyển ngữ sang ngôn ngữ này khi kích hoạt dịch.
            </p>
          </div>

          {/* 2. Model dịch */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-textSecondary">
                Model dịch
              </label>
              {currentProvider?.badge && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-surface3 text-textSecondary border border-borderDefault">
                  [{currentProvider.badge}]
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={transSettings.translationProviderId}
                onChange={(e) => updateTransSetting("translationProviderId", e.target.value)}
                className="flex-1 bg-surface2 border border-borderDefault hover:border-textMuted/60 focus:border-accent rounded-lg px-3 py-2 text-xs text-textPrimary focus:outline-none transition-colors cursor-pointer select-none"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName} [{p.badge}]
                  </option>
                ))}
              </select>

              {/* Delete button if custom model */}
              {transSettings.translationProviderId.startsWith("custom_") && (
                <button
                  type="button"
                  onClick={(e) => handleDeleteCustomModel(transSettings.translationProviderId, e)}
                  title="Xóa model tùy chỉnh này"
                  className="p-2 text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Provider status & description */}
            <div className="text-[11px] text-textMuted leading-tight flex items-center gap-1.5">
              {isLocalProvider && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 shrink-0 inline-block"
                  title="Sẵn sàng"
                />
              )}
              <span className="truncate">
                {currentProvider?.description || "Dịch tự động nội dung phụ đề."}
              </span>
            </div>
          </div>
        </div>

        {/* Action: + Thêm model dịch (Clean footer row) */}
        <div className="pt-3 border-t border-borderDefault flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-textMuted flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
            <span>Hỗ trợ LM Studio và các máy chủ tương thích OpenAI.</span>
          </div>

          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded-lg border border-borderDefault text-xs font-medium transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5 text-accent" />
            <span>+ Thêm model dịch</span>
          </button>
        </div>
      </div>

      {/* Add Custom Translation Model Modal */}
      <AddTranslationModelModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={handleModelAdded}
      />
    </div>
  );
};

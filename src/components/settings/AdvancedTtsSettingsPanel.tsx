import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Sliders,
  Sparkles,
  ShieldCheck,
  Zap,
  RotateCcw,
  Save,
  Check,
  Info,
  AlertCircle,
} from "lucide-react";
import {
  TtsModelKey,
  ModelPresetId,
  StoredTtsAdvancedSettings,
  OmniVoiceAdvancedSettings,
  ChatterboxAdvancedSettings,
  QwenAdvancedSettings,
  OMNIVOICE_DEFAULT_SETTINGS,
  CHATTERBOX_DEFAULT_SETTINGS,
  QWEN_DEFAULT_SETTINGS,
  OMNIVOICE_PRESETS,
  CHATTERBOX_PRESETS,
  QWEN_PRESETS,
  getTtsAdvancedSettingsSnapshot,
  loadTtsAdvancedSettings,
  saveTtsAdvancedSettings,
} from "../../services/ai/ttsAdvancedSettings";

export const AdvancedTtsSettingsPanel: React.FC = () => {
  const [activeModel, setActiveModel] = useState<TtsModelKey>("omnivoice");

  // Requirement 2: Strict separation between Persisted State and Draft State
  const [persistedSettings, setPersistedSettings] = useState<StoredTtsAdvancedSettings>(() =>
    getTtsAdvancedSettingsSnapshot()
  );
  const [draftSettings, setDraftSettings] = useState<StoredTtsAdvancedSettings>(() =>
    getTtsAdvancedSettingsSnapshot()
  );

  // Track if user has modified draft before async load resolves to prevent overwriting user input
  const hasUserEditedRef = useRef(false);

  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    loadTtsAdvancedSettings().then((loaded) => {
      if (!mounted) return;
      setPersistedSettings(loaded);
      // Only sync draft if user hasn't started editing
      if (!hasUserEditedRef.current) {
        setDraftSettings(loaded);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(draftSettings) !== JSON.stringify(persistedSettings),
    [draftSettings, persistedSettings]
  );

  const handlePresetSelect = useCallback((modelKey: TtsModelKey, preset: ModelPresetId) => {
    hasUserEditedRef.current = true;
    setIsSaved(false);
    setSaveError(null);
    setDraftSettings((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as StoredTtsAdvancedSettings;
      if (preset === "custom") {
        next[modelKey].preset = "custom";
        return next;
      }

      if (modelKey === "omnivoice") {
        next.omnivoice.preset = preset;
        next.omnivoice.settings = { ...OMNIVOICE_PRESETS[preset] };
      } else if (modelKey === "chatterbox") {
        next.chatterbox.preset = preset;
        next.chatterbox.settings = { ...CHATTERBOX_PRESETS[preset] };
      } else if (modelKey === "qwen") {
        next.qwen.preset = preset;
        next.qwen.settings = { ...QWEN_PRESETS[preset] };
      }
      return next;
    });
  }, []);

  const handleUpdateOmniVoice = useCallback(
    <K extends keyof OmniVoiceAdvancedSettings>(key: K, val: OmniVoiceAdvancedSettings[K]) => {
      hasUserEditedRef.current = true;
      setIsSaved(false);
      setSaveError(null);
      setDraftSettings((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as StoredTtsAdvancedSettings;
        next.omnivoice.preset = "custom";
        next.omnivoice.settings[key] = val;
        return next;
      });
    },
    []
  );

  const handleUpdateChatterbox = useCallback(
    <K extends keyof ChatterboxAdvancedSettings>(key: K, val: ChatterboxAdvancedSettings[K]) => {
      hasUserEditedRef.current = true;
      setIsSaved(false);
      setSaveError(null);
      setDraftSettings((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as StoredTtsAdvancedSettings;
        next.chatterbox.preset = "custom";
        next.chatterbox.settings[key] = val;
        return next;
      });
    },
    []
  );

  const handleUpdateQwen = useCallback(
    <K extends keyof QwenAdvancedSettings>(key: K, val: QwenAdvancedSettings[K]) => {
      hasUserEditedRef.current = true;
      setIsSaved(false);
      setSaveError(null);
      setDraftSettings((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as StoredTtsAdvancedSettings;
        next.qwen.preset = "custom";
        next.qwen.settings[key] = val;
        return next;
      });
    },
    []
  );

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveTtsAdvancedSettings(draftSettings);
      setPersistedSettings(draftSettings);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setSaveError(
        msg.includes("Không thể") || msg.includes("thất bại")
          ? msg
          : `Không thể lưu cài đặt xuống ổ đĩa: ${msg}`
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Requirement 2: Reset ONLY resets the draft of the active model in-memory.
  // It NEVER modifies other models' draft changes and NEVER writes to App Data until "Lưu cài đặt" is pressed.
  const handleResetCurrentModel = useCallback(() => {
    hasUserEditedRef.current = true;
    setIsSaved(false);
    setSaveError(null);
    setDraftSettings((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as StoredTtsAdvancedSettings;
      if (activeModel === "omnivoice") {
        next.omnivoice = {
          preset: "balanced",
          settings: { ...OMNIVOICE_DEFAULT_SETTINGS },
        };
      } else if (activeModel === "chatterbox") {
        next.chatterbox = {
          preset: "balanced",
          settings: { ...CHATTERBOX_DEFAULT_SETTINGS },
        };
      } else if (activeModel === "qwen") {
        next.qwen = {
          preset: "balanced",
          settings: { ...QWEN_DEFAULT_SETTINGS },
        };
      }
      return next;
    });
  }, [activeModel]);

  const omniState = draftSettings.omnivoice;
  const chatterState = draftSettings.chatterbox;
  const qwenState = draftSettings.qwen;

  return (
    <div className="p-5 bg-surface1 rounded-xl border border-borderDefault space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-accent" />
            <h3 className="font-semibold text-sm text-textPrimary">Cài đặt TTS nâng cao toàn cục</h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/15 text-accent border border-accent/30">
              Dùng chung toàn ứng dụng
            </span>
          </div>
          <p className="text-xs text-textMuted mt-1">
            Thiết lập siêu tham số suy luận chuyên sâu cho từng mô hình AI cục bộ. Các thông số này được lưu bền vững và tự động áp dụng khi tạo giọng tại TTS, Hội thoại, Batch, Dubbing và Voice Clone.
          </p>
        </div>

        {/* Global Save feedback & Unsaved status */}
        <div className="flex items-center gap-2 shrink-0">
          {hasUnsavedChanges && !isSaved && !saveError && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-medium animate-fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span>Có thay đổi chưa lưu</span>
            </div>
          )}
          {isSaved && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium shrink-0 animate-fade-in">
              <Check className="w-3.5 h-3.5" />
              <span>Đã lưu cài đặt</span>
            </div>
          )}
          {saveError && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-medium shrink-0 animate-fade-in">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Lưu thất bại: {saveError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Model Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-borderDefault/80 pb-2">
        <button
          type="button"
          onClick={() => setActiveModel("omnivoice")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer ${
            activeModel === "omnivoice"
              ? "bg-accent text-white shadow-xs font-semibold"
              : "bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary"
          }`}
        >
          <span>OmniVoice</span>
          <span className={`text-[10px] px-1.5 py-0.2 rounded ${
            activeModel === "omnivoice" ? "bg-white/20 text-white" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          }`}>
            Tiếng Việt
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveModel("chatterbox")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer ${
            activeModel === "chatterbox"
              ? "bg-accent text-white shadow-xs font-semibold"
              : "bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary"
          }`}
        >
          <span>Chatterbox Turbo</span>
          <span className={`text-[10px] px-1.5 py-0.2 rounded ${
            activeModel === "chatterbox" ? "bg-white/20 text-white" : "bg-sky-500/15 text-sky-600 dark:text-sky-400"
          }`}>
            English Turbo
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveModel("qwen")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer ${
            activeModel === "qwen"
              ? "bg-accent text-white shadow-xs font-semibold"
              : "bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary"
          }`}
        >
          <span>Qwen3-TTS 1.7B Base</span>
          <span className={`text-[10px] px-1.5 py-0.2 rounded ${
            activeModel === "qwen" ? "bg-white/20 text-white" : "bg-purple-500/15 text-purple-600 dark:text-purple-400"
          }`}>
            Zero-shot ICL
          </span>
        </button>
      </div>

      {/* Preset Selector */}
      <div className="p-3.5 bg-surface2/60 rounded-xl border border-borderDefault/80 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-textPrimary flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span>Cấu hình sẵn (Preset)</span>
          </label>
          <span className="text-[11px] text-textMuted">
            {activeModel === "omnivoice" && (omniState.preset === "custom" ? "Đang tùy chỉnh thủ công" : `Đang dùng: ${omniState.preset.toUpperCase()}`)}
            {activeModel === "chatterbox" && (chatterState.preset === "custom" ? "Đang tùy chỉnh thủ công" : `Đang dùng: ${chatterState.preset.toUpperCase()}`)}
            {activeModel === "qwen" && (qwenState.preset === "custom" ? "Đang tùy chỉnh thủ công" : `Đang dùng: ${qwenState.preset.toUpperCase()}`)}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(["stable", "balanced", "expressive", "custom"] as ModelPresetId[]).map((pid) => {
            const currentPreset =
              activeModel === "omnivoice"
                ? omniState.preset
                : activeModel === "chatterbox"
                ? chatterState.preset
                : qwenState.preset;
            const isSelected = currentPreset === pid;

            const labels: Record<ModelPresetId, { title: string; desc: string; icon: React.ReactNode }> = {
              stable: {
                title: "Ổn định",
                desc: "Ít nuốt chữ, đọc rõ",
                icon: <ShieldCheck className="w-3.5 h-3.5" />,
              },
              balanced: {
                title: "Cân bằng",
                desc: "Chuẩn mặc định",
                icon: <Zap className="w-3.5 h-3.5" />,
              },
              expressive: {
                title: "Biểu cảm",
                desc: "Ngữ điệu tự nhiên",
                icon: <Sparkles className="w-3.5 h-3.5" />,
              },
              custom: {
                title: "Tùy chỉnh",
                desc: "Chỉnh thủ công",
                icon: <Sliders className="w-3.5 h-3.5" />,
              },
            };

            const info = labels[pid];

            return (
              <button
                key={pid}
                type="button"
                onClick={() => handlePresetSelect(activeModel, pid)}
                className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                  isSelected
                    ? "bg-accent/10 border-accent text-accent font-semibold shadow-xs"
                    : "bg-surface1 border-borderDefault hover:bg-surface3/60 text-textSecondary hover:text-textPrimary"
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs">
                  {info.icon}
                  <span className="font-semibold">{info.title}</span>
                  {pid === "balanced" && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-surface3 text-textMuted ml-auto">
                      Mặc định
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-textMuted mt-0.5">{info.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Model Parameter Controls */}
      <div className="space-y-4">
        {/* ================================================================= */}
        {/* OmniVoice Controls                                                */}
        {/* ================================================================= */}
        {activeModel === "omnivoice" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* num_step */}
            <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-textPrimary">
                  Số bước suy luận <span className="font-mono text-[11px] text-textMuted">(num_step)</span>
                </label>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent">
                  {omniState.settings.num_step}
                </span>
              </div>
              <input
                type="range"
                min={8}
                max={100}
                step={1}
                value={omniState.settings.num_step}
                onChange={(e) => handleUpdateOmniVoice("num_step", Number(e.target.value))}
                className="w-full accent-accent cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-textMuted font-mono">
                <span>8 (Nhanh)</span>
                <span>32 (Chuẩn)</span>
                <span>100 (Kỹ)</span>
              </div>
              <p className="text-[11px] text-textMuted leading-relaxed">
                Số bước giải Flow Matching. Giá trị càng cao âm thanh càng nét và tự nhiên hơn nhưng thời gian suy luận tăng tỷ lệ thuận.
              </p>
            </div>

            {/* guidance_scale */}
            <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-textPrimary">
                  Mức hướng dẫn <span className="font-mono text-[11px] text-textMuted">(guidance_scale)</span>
                </label>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent">
                  {omniState.settings.guidance_scale.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min={1.0}
                max={5.0}
                step={0.1}
                value={omniState.settings.guidance_scale}
                onChange={(e) => handleUpdateOmniVoice("guidance_scale", Number(e.target.value))}
                className="w-full accent-accent cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-textMuted font-mono">
                <span>1.0 (Tự do)</span>
                <span>2.0 (Chuẩn)</span>
                <span>5.0 (Bám sát)</span>
              </div>
              <p className="text-[11px] text-textMuted leading-relaxed">
                Classifier-Free Guidance (CFG). Mức cao giúp giọng đọc bám sát văn bản mục tiêu và tránh nuốt chữ.
              </p>
            </div>

            {/* position_temperature */}
            <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-textPrimary">
                  Nhiệt độ vị trí <span className="font-mono text-[11px] text-textMuted">(position_temperature)</span>
                </label>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent">
                  {omniState.settings.position_temperature.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min={1.0}
                max={10.0}
                step={0.1}
                value={omniState.settings.position_temperature}
                onChange={(e) => handleUpdateOmniVoice("position_temperature", Number(e.target.value))}
                className="w-full accent-accent cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-textMuted font-mono">
                <span>1.0 (Ổn định)</span>
                <span>5.0 (Chuẩn)</span>
                <span>10.0 (Linh hoạt)</span>
              </div>
              <p className="text-[11px] text-textMuted leading-relaxed">
                Nhiệt độ chọn vị trí căn chỉnh khung thời gian âm thanh. Mức thấp giúp nhịp điệu phát âm ổn định và chuẩn xác hơn.
              </p>
            </div>

            {/* class_temperature */}
            <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-textPrimary">
                  Nhiệt độ lấy mẫu lớp <span className="font-mono text-[11px] text-textMuted">(class_temperature)</span>
                </label>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent">
                  {omniState.settings.class_temperature.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.0}
                max={1.0}
                step={0.05}
                value={omniState.settings.class_temperature}
                onChange={(e) => handleUpdateOmniVoice("class_temperature", Number(e.target.value))}
                className="w-full accent-accent cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-textMuted font-mono">
                <span>0.0 (Greedy - Chuẩn)</span>
                <span>0.2 (Biểu cảm)</span>
                <span>1.0 (Đa dạng)</span>
              </div>
              <p className="text-[11px] text-textMuted leading-relaxed">
                Nhiệt độ chọn token mã âm thanh. 0.0 là giải mã tối ưu (ít lỗi nhất); tăng nhẹ (0.1 - 0.2) giúp tăng sắc thái cảm xúc.
              </p>
            </div>

            {/* Switches: denoise & postprocess_output */}
            <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 flex items-center justify-between">
              <div>
                <label className="text-xs font-medium text-textPrimary block">
                  Khử nhiễu tiền xử lý <span className="font-mono text-[11px] text-textMuted">(denoise)</span>
                </label>
                <p className="text-[11px] text-textMuted mt-0.5">
                  Chèn token khử nhiễu để làm sạch tạp âm nền từ giọng mẫu.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={omniState.settings.denoise}
                onClick={() => handleUpdateOmniVoice("denoise", !omniState.settings.denoise)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  omniState.settings.denoise ? "bg-accent" : "bg-surface3"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    omniState.settings.denoise ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 flex items-center justify-between">
              <div>
                <label className="text-xs font-medium text-textPrimary block">
                  Hậu xử lý đầu ra <span className="font-mono text-[11px] text-textMuted">(postprocess_output)</span>
                </label>
                <p className="text-[11px] text-textMuted mt-0.5">
                  Tự động cắt khoảng lặng thừa ở hai đầu và làm mượt viền fade-in/fade-out.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={omniState.settings.postprocess_output}
                onClick={() => handleUpdateOmniVoice("postprocess_output", !omniState.settings.postprocess_output)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  omniState.settings.postprocess_output ? "bg-accent" : "bg-surface3"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    omniState.settings.postprocess_output ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* Chatterbox Turbo Controls                                         */}
        {/* ================================================================= */}
        {activeModel === "chatterbox" && (
          <div className="space-y-4">
            <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-lg flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Lưu ý về Chatterbox Turbo:</strong> Phiên bản Turbo không hỗ trợ <code>cfg_weight</code>, <code>exaggeration</code>, <code>min_p</code> và <code>speed</code>. VoxLab chỉ hiển thị đúng các tham số thực tế mà kiến trúc Turbo chấp nhận.
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* temperature */}
              <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-textPrimary">
                    Nhiệt độ lấy mẫu <span className="font-mono text-[11px] text-textMuted">(temperature)</span>
                  </label>
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent">
                    {chatterState.settings.temperature.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={1.5}
                  step={0.05}
                  value={chatterState.settings.temperature}
                  onChange={(e) => handleUpdateChatterbox("temperature", Number(e.target.value))}
                  className="w-full accent-accent cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-textMuted font-mono">
                  <span>0.2 (Chính xác)</span>
                  <span>0.8 (Chuẩn)</span>
                  <span>1.5 (Đa dạng)</span>
                </div>
                <p className="text-[11px] text-textMuted leading-relaxed">
                  Kiểm soát độ biến thiên âm vị. Mức thấp (0.6 - 0.7) giúp giọng đọc rõ ràng, ít lỗi; mức cao tăng độ tự nhiên của tiếng thở và ngắt giọng.
                </p>
              </div>

              {/* top_p */}
              <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-textPrimary">
                    Xác suất tích lũy <span className="font-mono text-[11px] text-textMuted">(top_p)</span>
                  </label>
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent">
                    {chatterState.settings.top_p.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.0}
                  step={0.01}
                  value={chatterState.settings.top_p}
                  onChange={(e) => handleUpdateChatterbox("top_p", Number(e.target.value))}
                  className="w-full accent-accent cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-textMuted font-mono">
                  <span>0.5 (Tập trung)</span>
                  <span>0.95 (Chuẩn)</span>
                  <span>1.0 (Đầy đủ)</span>
                </div>
                <p className="text-[11px] text-textMuted leading-relaxed">
                  Nucleus sampling. Giới hạn các ứng viên token trong phân phối xác suất cao nhất (Khuyến nghị: 0.95).
                </p>
              </div>

              {/* top_k */}
              <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-textPrimary">
                    Giới hạn ứng viên <span className="font-mono text-[11px] text-textMuted">(top_k)</span>
                  </label>
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent">
                    {chatterState.settings.top_k}
                  </span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={1500}
                  step={50}
                  value={chatterState.settings.top_k}
                  onChange={(e) => handleUpdateChatterbox("top_k", Number(e.target.value))}
                  className="w-full accent-accent cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-textMuted font-mono">
                  <span>100 (Hạn chế)</span>
                  <span>1000 (Chuẩn)</span>
                  <span>1500 (Rộng)</span>
                </div>
                <p className="text-[11px] text-textMuted leading-relaxed">
                  Số lượng token hàng đầu được xem xét ở mỗi bước lấy mẫu (Khuyến nghị: 1000).
                </p>
              </div>

              {/* repetition_penalty */}
              <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-textPrimary">
                    Phạt lặp từ <span className="font-mono text-[11px] text-textMuted">(repetition_penalty)</span>
                  </label>
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent">
                    {chatterState.settings.repetition_penalty.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={1.0}
                  max={1.8}
                  step={0.05}
                  value={chatterState.settings.repetition_penalty}
                  onChange={(e) => handleUpdateChatterbox("repetition_penalty", Number(e.target.value))}
                  className="w-full accent-accent cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-textMuted font-mono">
                  <span>1.0 (Tắt)</span>
                  <span>1.2 (Chuẩn)</span>
                  <span>1.8 (Chặt chẽ)</span>
                </div>
                <p className="text-[11px] text-textMuted leading-relaxed">
                  Ngăn chặn tình trạng vấp chữ, lặp lại từ hoặc âm tiết cuối câu ở đoạn văn dài (Khuyến nghị: 1.2).
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* Qwen3-TTS 1.7B Base Controls                                      */}
        {/* ================================================================= */}
        {activeModel === "qwen" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* temperature */}
              <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-textPrimary">
                    Nhiệt độ lấy mẫu <span className="font-mono text-[11px] text-textMuted">(temperature)</span>
                  </label>
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent">
                    {qwenState.settings.temperature.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={1.5}
                  step={0.05}
                  value={qwenState.settings.temperature}
                  onChange={(e) => handleUpdateQwen("temperature", Number(e.target.value))}
                  className="w-full accent-accent cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-textMuted font-mono">
                  <span>0.2 (Chính xác)</span>
                  <span>0.9 (Chuẩn Qwen)</span>
                  <span>1.5 (Đa dạng)</span>
                </div>
                <p className="text-[11px] text-textMuted leading-relaxed">
                  Nhiệt độ sinh mã âm thanh. Giảm xuống 0.7 - 0.8 giúp giọng đọc ổn định, phát âm rõ chữ hơn.
                </p>
              </div>

              {/* top_p */}
              <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-textPrimary">
                    Xác suất tích lũy <span className="font-mono text-[11px] text-textMuted">(top_p)</span>
                  </label>
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent">
                    {qwenState.settings.top_p.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.0}
                  step={0.01}
                  value={qwenState.settings.top_p}
                  onChange={(e) => handleUpdateQwen("top_p", Number(e.target.value))}
                  className="w-full accent-accent cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-textMuted font-mono">
                  <span>0.5 (Tập trung)</span>
                  <span>0.95 (Ổn định)</span>
                  <span>1.0 (Chuẩn Qwen)</span>
                </div>
                <p className="text-[11px] text-textMuted leading-relaxed">
                  Ngưỡng xác suất tích lũy. Mặc định của Qwen3-TTS là 1.0 (không cắt đuôi phân phối).
                </p>
              </div>

              {/* top_k */}
              <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-textPrimary">
                    Giới hạn ứng viên <span className="font-mono text-[11px] text-textMuted">(top_k)</span>
                  </label>
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent">
                    {qwenState.settings.top_k}
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={150}
                  step={5}
                  value={qwenState.settings.top_k}
                  onChange={(e) => handleUpdateQwen("top_k", Number(e.target.value))}
                  className="w-full accent-accent cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-textMuted font-mono">
                  <span>5 (Chặt)</span>
                  <span>50 (Chuẩn Qwen)</span>
                  <span>150 (Rộng)</span>
                </div>
                <p className="text-[11px] text-textMuted leading-relaxed">
                  Số lượng ứng viên mã âm thanh hàng đầu. Qwen3-TTS sử dụng top-k=50 làm giá trị chuẩn.
                </p>
              </div>

              {/* repetition_penalty */}
              <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-textPrimary">
                    Phạt lặp âm <span className="font-mono text-[11px] text-textMuted">(repetition_penalty)</span>
                  </label>
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent">
                    {qwenState.settings.repetition_penalty.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={1.0}
                  max={1.5}
                  step={0.01}
                  value={qwenState.settings.repetition_penalty}
                  onChange={(e) => handleUpdateQwen("repetition_penalty", Number(e.target.value))}
                  className="w-full accent-accent cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-textMuted font-mono">
                  <span>1.0 (Tắt)</span>
                  <span>1.05 (Chuẩn Qwen)</span>
                  <span>1.5 (Chặt chẽ)</span>
                </div>
                <p className="text-[11px] text-textMuted leading-relaxed">
                  Hệ số chống lặp ngữ âm. 1.05 giúp hạn chế lặp từ mà vẫn giữ độ trôi chảy mượt mà.
                </p>
              </div>

              {/* Switches: do_sample & x_vector_only_mode */}
              <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 flex items-center justify-between">
                <div>
                  <label className="text-xs font-medium text-textPrimary block">
                    Chế độ lấy mẫu ngẫu nhiên <span className="font-mono text-[11px] text-textMuted">(do_sample)</span>
                  </label>
                  <p className="text-[11px] text-textMuted mt-0.5">
                    Kích hoạt cơ chế sampling có trọng số (Khuyến nghị: Bật cho mô hình Base).
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={qwenState.settings.do_sample}
                  onClick={() => handleUpdateQwen("do_sample", !qwenState.settings.do_sample)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    qwenState.settings.do_sample ? "bg-accent" : "bg-surface3"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      qwenState.settings.do_sample ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault/60 flex items-center justify-between">
                <div>
                  <label className="text-xs font-medium text-textPrimary block">
                    Chỉ dùng đặc trưng người nói <span className="font-mono text-[11px] text-textMuted">(x_vector_only_mode)</span>
                  </label>
                  <p className="text-[11px] text-textMuted mt-0.5">
                    Tắt để sử dụng chế độ In-Context Learning (ICL) chất lượng cao nhất khi có giọng mẫu và văn bản mẫu.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={qwenState.settings.x_vector_only_mode}
                  onClick={() => handleUpdateQwen("x_vector_only_mode", !qwenState.settings.x_vector_only_mode)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    qwenState.settings.x_vector_only_mode ? "bg-accent" : "bg-surface3"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      qwenState.settings.x_vector_only_mode ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-borderDefault/80">
        <button
          type="button"
          onClick={handleResetCurrentModel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-borderDefault bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary text-xs font-medium transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Khôi phục mặc định cho {activeModel === "omnivoice" ? "OmniVoice" : activeModel === "chatterbox" ? "Chatterbox" : "Qwen3-TTS"}</span>
        </button>

        <div className="flex items-center gap-3">
          {saveError && (
            <span className="text-xs text-rose-500 font-medium flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {saveError}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50 ${
              hasUnsavedChanges
                ? "bg-accent hover:bg-accentHover ring-2 ring-accent/40 font-bold"
                : "bg-accent hover:bg-accentHover"
            }`}
          >
            {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isSaving ? "Đang lưu..." : isSaved ? "Đã lưu cài đặt" : hasUnsavedChanges ? "Lưu thay đổi cài đặt" : "Lưu cài đặt TTS"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

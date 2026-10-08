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
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Gauge,
  Cpu,
  Volume2,
  Clock,
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

// ============================================================================
// REUSABLE SUBCOMPONENTS
// ============================================================================

interface SectionCardProps {
  title: string;
  englishTitle: string;
  icon: React.ReactNode;
  badge?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const SectionCard: React.FC<SectionCardProps> = ({
  title,
  englishTitle,
  icon,
  badge,
  isOpen,
  onToggle,
  children,
}) => {
  return (
    <div className="bg-surface2/30 rounded-xl border border-borderDefault/70 overflow-hidden transition-all">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 bg-surface2/50 hover:bg-surface2 flex items-center justify-between transition-colors cursor-pointer text-left select-none"
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-surface3/80 text-accent">
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-textPrimary tracking-tight">
                {title}
              </span>
              <span className="text-[11px] font-mono text-textMuted/80 hidden sm:inline">
                ({englishTitle})
              </span>
              {badge && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-accent/10 text-accent border border-accent/25">
                  {badge}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="p-1 rounded text-textMuted hover:text-textPrimary">
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {isOpen && (
        <div className="p-4 pt-3.5 space-y-3.5 animate-fade-in border-t border-borderDefault/40">
          {children}
        </div>
      )}
    </div>
  );
};

interface SliderParamProps {
  label: string;
  techName: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  formatValue?: (val: number) => string;
  description: string;
  warning?: string;
  onChange: (val: number) => void;
}

const SliderParam: React.FC<SliderParamProps> = ({
  label,
  techName,
  value,
  defaultValue,
  min,
  max,
  step,
  unit = "",
  formatValue,
  description,
  warning,
  onChange,
}) => {
  const isDefault = Math.abs(value - defaultValue) < 0.0001;
  const displayVal = formatValue ? formatValue(value) : `${value}${unit}`;
  const defaultDisplay = formatValue ? formatValue(defaultValue) : `${defaultValue}${unit}`;

  return (
    <div className="p-3 bg-surface1/80 rounded-lg border border-borderDefault/60 space-y-2 hover:border-borderDefault transition-colors">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-textPrimary">
          {label} <span className="font-mono text-[11px] text-textMuted font-normal">({techName})</span>
        </label>
        <div className="flex items-center gap-1.5 shrink-0">
          {!isDefault && (
            <span
              title={`Mặc định: ${defaultDisplay}`}
              className="text-[10px] font-mono text-textMuted px-1.5 py-0.5 rounded bg-surface2 border border-borderDefault/50"
            >
              Mặc định: {defaultDisplay}
            </span>
          )}
          <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent border border-accent/20">
            {displayVal}
          </span>
        </div>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent cursor-pointer h-1.5 rounded-lg bg-surface3"
      />

      <div className="flex justify-between text-[10px] text-textMuted font-mono">
        <span>{formatValue ? formatValue(min) : `${min}${unit}`} (Tối thiểu)</span>
        <span>{formatValue ? formatValue(max) : `${max}${unit}`} (Tối đa)</span>
      </div>

      <p className="text-[11px] text-textMuted leading-relaxed">
        {description}
      </p>

      {warning && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 p-2 rounded border border-amber-500/20">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      )}
    </div>
  );
};

interface SwitchParamProps {
  label: string;
  techName: string;
  value: boolean;
  defaultValue: boolean;
  description: string;
  warning?: string;
  onChange: (val: boolean) => void;
}

const SwitchParam: React.FC<SwitchParamProps> = ({
  label,
  techName,
  value,
  defaultValue,
  description,
  warning,
  onChange,
}) => {
  const isDefault = value === defaultValue;

  return (
    <div className="p-3 bg-surface1/80 rounded-lg border border-borderDefault/60 flex items-start justify-between gap-4 hover:border-borderDefault transition-colors">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-textPrimary">
            {label} <span className="font-mono text-[11px] text-textMuted font-normal">({techName})</span>
          </label>
          {!isDefault && (
            <span className="text-[10px] font-mono text-textMuted px-1.5 py-0.2 rounded bg-surface2 border border-borderDefault/50">
              Mặc định: {defaultValue ? "Bật" : "Tắt"}
            </span>
          )}
        </div>
        <p className="text-[11px] text-textMuted leading-relaxed">
          {description}
        </p>
        {warning && (
          <div className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 p-1.5 rounded border border-amber-500/20 mt-1">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>{warning}</span>
          </div>
        )}
      </div>

      <div className="shrink-0 pt-0.5 flex flex-col items-end gap-1">
        <button
          type="button"
          role="switch"
          aria-checked={value}
          onClick={() => onChange(!value)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            value ? "bg-accent" : "bg-surface3"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              value ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
        <span className="text-[10px] font-medium text-textMuted">
          {value ? "Bật" : "Tắt"}
        </span>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const AdvancedTtsSettingsPanel: React.FC = () => {
  const [activeModel, setActiveModel] = useState<TtsModelKey>("omnivoice");

  // Accordion section toggles
  const [sectionsOpen, setSectionsOpen] = useState<{
    main: boolean;
    advanced: boolean;
    audio: boolean;
  }>({
    main: true,
    advanced: true,
    audio: true,
  });

  const toggleSection = (sec: "main" | "advanced" | "audio") => {
    setSectionsOpen((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };

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
            Tiếng Việt / Flow
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
          <div className="space-y-4">
            {/* Section 1: Thông số chính */}
            <SectionCard
              title="Thông số chính"
              englishTitle="Main Parameters"
              icon={<Gauge className="w-4 h-4" />}
              badge="Cơ bản"
              isOpen={sectionsOpen.main}
              onToggle={() => toggleSection("main")}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <SliderParam
                  label="Số bước suy luận"
                  techName="num_step"
                  value={omniState.settings.num_step}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.num_step}
                  min={4}
                  max={128}
                  step={1}
                  description="Số bước giải phương trình vi phân Flow Matching. Số bước càng cao âm thanh càng nét và tự nhiên hơn nhưng thời gian suy luận tăng tỷ lệ thuận."
                  warning={
                    omniState.settings.num_step < 16
                      ? "Số bước dưới 16 có thể khiến giọng nói méo mó hoặc rè tiếng."
                      : omniState.settings.num_step > 80
                      ? "Số bước trên 80 làm tăng đáng kể thời gian suy luận nhưng chất lượng không cải thiện thêm nhiều."
                      : undefined
                  }
                  onChange={(val) => handleUpdateOmniVoice("num_step", val)}
                />

                <SliderParam
                  label="Mức hướng dẫn phân loại"
                  techName="guidance_scale"
                  value={omniState.settings.guidance_scale}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.guidance_scale}
                  min={1.0}
                  max={10.0}
                  step={0.1}
                  formatValue={(v) => v.toFixed(1)}
                  description="Classifier-Free Guidance (CFG). Mức cao giúp giọng đọc bám sát nội dung văn bản mục tiêu và tránh nuốt chữ."
                  warning={
                    omniState.settings.guidance_scale > 4.5
                      ? "Mức hướng dẫn quá cao (> 4.5) có thể khiến giọng bị cứng hoặc biến dạng âm sắc."
                      : undefined
                  }
                  onChange={(val) => handleUpdateOmniVoice("guidance_scale", val)}
                />
              </div>
            </SectionCard>

            {/* Section 2: Thông số chuyên sâu */}
            <SectionCard
              title="Thông số chuyên sâu"
              englishTitle="In-depth Parameters"
              icon={<Cpu className="w-4 h-4" />}
              badge="Nâng cao"
              isOpen={sectionsOpen.advanced}
              onToggle={() => toggleSection("advanced")}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <SliderParam
                  label="Độ lệch bước thời gian"
                  techName="t_shift"
                  value={omniState.settings.t_shift}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.t_shift}
                  min={0.01}
                  max={5.0}
                  step={0.01}
                  formatValue={(v) => v.toFixed(2)}
                  description="Dịch chuyển phân bố thời gian giải Flow Matching. Giá trị nhỏ ưu tiên bước khử nhiễu sớm giúp nhịp điệu tự nhiên hơn."
                  onChange={(val) => handleUpdateOmniVoice("t_shift", val)}
                />

                <SliderParam
                  label="Hệ số phạt theo tầng mã"
                  techName="layer_penalty_factor"
                  value={omniState.settings.layer_penalty_factor}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.layer_penalty_factor}
                  min={0.0}
                  max={20.0}
                  step={0.5}
                  formatValue={(v) => v.toFixed(1)}
                  description="Ưu tiên giải mã chính xác các tầng codebook cơ bản trước khi tạo chi tiết âm sắc. Mức cao giúp âm phát ra ổn định và ít tạp âm lạ."
                  onChange={(val) => handleUpdateOmniVoice("layer_penalty_factor", val)}
                />

                <SliderParam
                  label="Nhiệt độ chọn vị trí"
                  techName="position_temperature"
                  value={omniState.settings.position_temperature}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.position_temperature}
                  min={0.0}
                  max={20.0}
                  step={0.1}
                  formatValue={(v) => v.toFixed(1)}
                  description="Nhiệt độ chọn vị trí căn chỉnh khung thời gian âm thanh. Mức thấp giúp nhịp điệu phát âm ổn định và chuẩn xác hơn."
                  onChange={(val) => handleUpdateOmniVoice("position_temperature", val)}
                />

                <SliderParam
                  label="Nhiệt độ lấy mẫu lớp"
                  techName="class_temperature"
                  value={omniState.settings.class_temperature}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.class_temperature}
                  min={0.0}
                  max={5.0}
                  step={0.05}
                  formatValue={(v) => v.toFixed(2)}
                  description="Nhiệt độ chọn token mã âm thanh. 0.0 là giải mã tối ưu (ít lỗi nhất); tăng nhẹ (0.1 - 0.2) giúp tăng sắc thái cảm xúc."
                  onChange={(val) => handleUpdateOmniVoice("class_temperature", val)}
                />
              </div>

              {/* Special Duration Control: Auto vs Fixed */}
              <div className="p-3 bg-surface1/80 rounded-lg border border-borderDefault/60 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-accent" />
                    <label className="text-xs font-medium text-textPrimary">
                      Thời lượng âm thanh cố định <span className="font-mono text-[11px] text-textMuted font-normal">(duration)</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    {omniState.settings.duration !== null ? (
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent border border-accent/20">
                        {omniState.settings.duration.toFixed(1)}s
                      </span>
                    ) : (
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        Tự động (Auto)
                      </span>
                    )}
                  </div>
                </div>

                {/* Duration mode switch */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleUpdateOmniVoice("duration", null)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                      omniState.settings.duration === null
                        ? "bg-accent text-white shadow-xs"
                        : "bg-surface2 hover:bg-surface3 text-textSecondary"
                    }`}
                  >
                    Tự động tính theo văn bản (Khuyến nghị)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateOmniVoice("duration", 10.0)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                      omniState.settings.duration !== null
                        ? "bg-accent text-white shadow-xs"
                        : "bg-surface2 hover:bg-surface3 text-textSecondary"
                    }`}
                  >
                    Chỉ định số giây cố định
                  </button>
                </div>

                {omniState.settings.duration !== null && (
                  <div className="space-y-2 pt-1">
                    <input
                      type="range"
                      min={0.5}
                      max={120.0}
                      step={0.5}
                      value={omniState.settings.duration}
                      onChange={(e) => handleUpdateOmniVoice("duration", Number(e.target.value))}
                      className="w-full accent-accent cursor-pointer h-1.5 rounded-lg bg-surface3"
                    />
                    <div className="flex justify-between text-[10px] text-textMuted font-mono">
                      <span>0.5s</span>
                      <span>{omniState.settings.duration.toFixed(1)} giây</span>
                      <span>120.0s</span>
                    </div>
                    <div className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        <strong>Cảnh báo:</strong> Nếu đặt thời lượng cố định, mô hình sẽ ép âm thanh tạo ra đúng số giây này bất kể câu dài hay ngắn, có thể khiến người đọc nói quá nhanh hoặc quá chậm.
                      </span>
                    </div>
                  </div>
                )}

                <p className="text-[11px] text-textMuted leading-relaxed">
                  Để mặc định <em>Tự động</em> giúp VoxLab tính toán thời lượng phù hợp với độ dài câu và tốc độ nói tự nhiên.
                </p>
              </div>
            </SectionCard>

            {/* Section 3: Xử lý âm thanh */}
            <SectionCard
              title="Xử lý âm thanh"
              englishTitle="Audio Processing"
              icon={<Volume2 className="w-4 h-4" />}
              badge="Hậu kỳ"
              isOpen={sectionsOpen.audio}
              onToggle={() => toggleSection("audio")}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <SwitchParam
                  label="Khử nhiễu tiền xử lý giọng mẫu"
                  techName="denoise"
                  value={omniState.settings.denoise}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.denoise}
                  description="Chèn token khử nhiễu để loại bỏ tạp âm nền từ tệp giọng mẫu trước khi tổng hợp."
                  onChange={(val) => handleUpdateOmniVoice("denoise", val)}
                />

                <SwitchParam
                  label="Tiền xử lý âm thanh mẫu"
                  techName="preprocess_prompt"
                  value={omniState.settings.preprocess_prompt}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.preprocess_prompt}
                  description="Tự động cắt khoảng lặng hai đầu và chuẩn hóa dấu câu cho văn bản/âm thanh mẫu."
                  onChange={(val) => handleUpdateOmniVoice("preprocess_prompt", val)}
                />

                <SwitchParam
                  label="Hậu xử lý âm thanh đầu ra"
                  techName="postprocess_output"
                  value={omniState.settings.postprocess_output}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.postprocess_output}
                  description="Tự động cắt khoảng lặng thừa ở hai đầu âm thanh đầu ra và áp dụng làm mượt viền."
                  onChange={(val) => handleUpdateOmniVoice("postprocess_output", val)}
                />

                <SliderParam
                  label="Khoảng đệm khoảng lặng"
                  techName="pad_duration"
                  value={omniState.settings.pad_duration}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.pad_duration}
                  min={0.0}
                  max={2.0}
                  step={0.05}
                  unit="s"
                  formatValue={(v) => `${v.toFixed(2)}s`}
                  description="Thời lượng khoảng lặng (giây) được thêm vào trước và sau đoạn âm thanh đầu ra."
                  onChange={(val) => handleUpdateOmniVoice("pad_duration", val)}
                />

                <SliderParam
                  label="Thời gian làm mượt viền"
                  techName="fade_duration"
                  value={omniState.settings.fade_duration}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.fade_duration}
                  min={0.0}
                  max={2.0}
                  step={0.05}
                  unit="s"
                  formatValue={(v) => `${v.toFixed(2)}s`}
                  description="Thời gian fade-in/fade-out (giây) ở hai đầu đoạn âm thanh để tránh tiếng lách cách (click/pop)."
                  onChange={(val) => handleUpdateOmniVoice("fade_duration", val)}
                />

                <SliderParam
                  label="Thời lượng đoạn chia nhỏ"
                  techName="audio_chunk_duration"
                  value={omniState.settings.audio_chunk_duration}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.audio_chunk_duration}
                  min={5.0}
                  max={60.0}
                  step={1.0}
                  unit="s"
                  formatValue={(v) => `${v.toFixed(0)}s`}
                  description="Thời lượng mục tiêu của từng đoạn con khi mô hình tự động cắt văn bản quá dài."
                  onChange={(val) => handleUpdateOmniVoice("audio_chunk_duration", val)}
                />

                <SliderParam
                  label="Ngưỡng kích hoạt chia đoạn"
                  techName="audio_chunk_threshold"
                  value={omniState.settings.audio_chunk_threshold}
                  defaultValue={OMNIVOICE_DEFAULT_SETTINGS.audio_chunk_threshold}
                  min={10.0}
                  max={120.0}
                  step={5.0}
                  unit="s"
                  formatValue={(v) => `${v.toFixed(0)}s`}
                  description="Ngưỡng thời lượng tối thiểu để kích hoạt thuật toán chia nhỏ âm thanh thành nhiều đoạn."
                  onChange={(val) => handleUpdateOmniVoice("audio_chunk_threshold", val)}
                />
              </div>
            </SectionCard>
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
                <strong>Lưu ý về Chatterbox Turbo:</strong> Phiên bản Turbo không hỗ trợ <code>cfg_weight</code>, <code>exaggeration</code>, <code>min_p</code> và <code>speed</code> (mã nguồn upstream bỏ qua nếu truyền vào). VoxLab chỉ hiển thị đúng các tham số thực tế mà kiến trúc Turbo xử lý.
              </span>
            </div>

            {/* Section 1: Thông số chính */}
            <SectionCard
              title="Thông số chính"
              englishTitle="Main Parameters"
              icon={<Gauge className="w-4 h-4" />}
              badge="Cơ bản"
              isOpen={sectionsOpen.main}
              onToggle={() => toggleSection("main")}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <SliderParam
                  label="Nhiệt độ lấy mẫu"
                  techName="temperature"
                  value={chatterState.settings.temperature}
                  defaultValue={CHATTERBOX_DEFAULT_SETTINGS.temperature}
                  min={0.1}
                  max={2.0}
                  step={0.05}
                  formatValue={(v) => v.toFixed(2)}
                  description="Kiểm soát độ biến thiên âm vị. Mức thấp (0.6 - 0.7) giúp giọng đọc rõ ràng, ít lỗi; mức cao tăng độ tự nhiên của tiếng thở và ngắt giọng."
                  onChange={(val) => handleUpdateChatterbox("temperature", val)}
                />

                <SliderParam
                  label="Xác suất tích lũy"
                  techName="top_p"
                  value={chatterState.settings.top_p}
                  defaultValue={CHATTERBOX_DEFAULT_SETTINGS.top_p}
                  min={0.1}
                  max={1.0}
                  step={0.01}
                  formatValue={(v) => v.toFixed(2)}
                  description="Nucleus sampling. Giới hạn các ứng viên token trong phân phối xác suất cao nhất (Khuyến nghị: 0.95)."
                  onChange={(val) => handleUpdateChatterbox("top_p", val)}
                />

                <SliderParam
                  label="Giới hạn ứng viên"
                  techName="top_k"
                  value={chatterState.settings.top_k}
                  defaultValue={CHATTERBOX_DEFAULT_SETTINGS.top_k}
                  min={10}
                  max={2000}
                  step={50}
                  description="Số lượng token hàng đầu được xem xét ở mỗi bước lấy mẫu (Khuyến nghị: 1000)."
                  onChange={(val) => handleUpdateChatterbox("top_k", val)}
                />

                <SliderParam
                  label="Phạt lặp từ"
                  techName="repetition_penalty"
                  value={chatterState.settings.repetition_penalty}
                  defaultValue={CHATTERBOX_DEFAULT_SETTINGS.repetition_penalty}
                  min={1.0}
                  max={2.0}
                  step={0.05}
                  formatValue={(v) => v.toFixed(2)}
                  description="Ngăn chặn tình trạng vấp chữ, lặp lại từ hoặc âm tiết cuối câu ở đoạn văn dài (Khuyến nghị: 1.2)."
                  onChange={(val) => handleUpdateChatterbox("repetition_penalty", val)}
                />
              </div>
            </SectionCard>

            {/* Section 2: Xử lý âm thanh */}
            <SectionCard
              title="Xử lý âm thanh"
              englishTitle="Audio Processing"
              icon={<Volume2 className="w-4 h-4" />}
              badge="Chuẩn hóa"
              isOpen={sectionsOpen.audio}
              onToggle={() => toggleSection("audio")}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <SwitchParam
                  label="Chuẩn hóa âm lượng giọng mẫu"
                  techName="norm_loudness"
                  value={chatterState.settings.norm_loudness}
                  defaultValue={CHATTERBOX_DEFAULT_SETTINGS.norm_loudness}
                  description="Tự động chuẩn hóa âm lượng của tệp giọng mẫu về mức chuẩn phát thanh (-24 LUFS) khi trích xuất đặc trưng âm sắc."
                  onChange={(val) => handleUpdateChatterbox("norm_loudness", val)}
                />
              </div>
            </SectionCard>
          </div>
        )}

        {/* ================================================================= */}
        {/* Qwen3-TTS 1.7B Base Controls                                      */}
        {/* ================================================================= */}
        {activeModel === "qwen" && (
          <div className="space-y-4">
            <div className="p-3 bg-purple-500/10 border border-purple-500/25 rounded-lg flex items-start gap-2 text-xs text-purple-700 dark:text-purple-300">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Kiến trúc Qwen3-TTS 1.7B Base:</strong> Mô hình kết hợp mạng Talker chính và mạng Subtalker (Code Predictor 15 tầng). Chế độ In-Context Learning (ICL) mang lại chất lượng và độ giống giọng clone cao nhất khi có cả âm thanh mẫu và văn bản mẫu.
              </span>
            </div>

            {/* Section 1: Thông số chính */}
            <SectionCard
              title="Thông số chính"
              englishTitle="Main Parameters"
              icon={<Gauge className="w-4 h-4" />}
              badge="Talker"
              isOpen={sectionsOpen.main}
              onToggle={() => toggleSection("main")}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <SliderParam
                  label="Nhiệt độ lấy mẫu chính"
                  techName="temperature"
                  value={qwenState.settings.temperature}
                  defaultValue={QWEN_DEFAULT_SETTINGS.temperature}
                  min={0.1}
                  max={2.0}
                  step={0.05}
                  formatValue={(v) => v.toFixed(2)}
                  description="Nhiệt độ sinh mã âm thanh chính của mạng Talker. Giảm xuống 0.7 - 0.8 giúp giọng đọc ổn định, phát âm rõ chữ hơn."
                  onChange={(val) => handleUpdateQwen("temperature", val)}
                />

                <SliderParam
                  label="Xác suất tích lũy chính"
                  techName="top_p"
                  value={qwenState.settings.top_p}
                  defaultValue={QWEN_DEFAULT_SETTINGS.top_p}
                  min={0.1}
                  max={1.0}
                  step={0.01}
                  formatValue={(v) => v.toFixed(2)}
                  description="Ngưỡng xác suất tích lũy cho Talker. Mặc định của Qwen3-TTS là 1.0 (không cắt đuôi phân phối xác suất)."
                  onChange={(val) => handleUpdateQwen("top_p", val)}
                />

                <SliderParam
                  label="Giới hạn ứng viên chính"
                  techName="top_k"
                  value={qwenState.settings.top_k}
                  defaultValue={QWEN_DEFAULT_SETTINGS.top_k}
                  min={1}
                  max={200}
                  step={1}
                  description="Số lượng ứng viên mã âm thanh hàng đầu cho mạng Talker (Chuẩn Qwen: 50)."
                  onChange={(val) => handleUpdateQwen("top_k", val)}
                />

                <SliderParam
                  label="Phạt lặp âm"
                  techName="repetition_penalty"
                  value={qwenState.settings.repetition_penalty}
                  defaultValue={QWEN_DEFAULT_SETTINGS.repetition_penalty}
                  min={1.0}
                  max={2.0}
                  step={0.01}
                  formatValue={(v) => v.toFixed(2)}
                  description="Hệ số chống lặp ngữ âm. 1.05 giúp hạn chế lặp từ mà vẫn giữ độ trôi chảy mượt mà."
                  onChange={(val) => handleUpdateQwen("repetition_penalty", val)}
                />

                <SwitchParam
                  label="Chế độ lấy mẫu ngẫu nhiên"
                  techName="do_sample"
                  value={qwenState.settings.do_sample}
                  defaultValue={QWEN_DEFAULT_SETTINGS.do_sample}
                  description="Kích hoạt cơ chế sampling có trọng số cho mạng Talker (Khuyến nghị: Bật cho mô hình Base)."
                  onChange={(val) => handleUpdateQwen("do_sample", val)}
                />

                <SwitchParam
                  label="Chỉ dùng đặc trưng x-vector"
                  techName="x_vector_only_mode"
                  value={qwenState.settings.x_vector_only_mode}
                  defaultValue={QWEN_DEFAULT_SETTINGS.x_vector_only_mode}
                  description="Tắt để sử dụng chế độ In-Context Learning (ICL) chất lượng cao nhất khi có giọng mẫu và văn bản mẫu."
                  onChange={(val) => handleUpdateQwen("x_vector_only_mode", val)}
                />
              </div>
            </SectionCard>

            {/* Section 2: Thông số chuyên sâu (Subtalker & Generation) */}
            <SectionCard
              title="Thông số chuyên sâu"
              englishTitle="In-depth Parameters"
              icon={<Cpu className="w-4 h-4" />}
              badge="Subtalker"
              isOpen={sectionsOpen.advanced}
              onToggle={() => toggleSection("advanced")}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <SwitchParam
                  label="Lấy mẫu ngẫu nhiên Subtalker"
                  techName="subtalker_dosample"
                  value={qwenState.settings.subtalker_dosample}
                  defaultValue={QWEN_DEFAULT_SETTINGS.subtalker_dosample}
                  description="Bật lấy mẫu ngẫu nhiên cho mạng Code Predictor (dự đoán 15 tầng mã phụ trợ)."
                  onChange={(val) => handleUpdateQwen("subtalker_dosample", val)}
                />

                <SliderParam
                  label="Nhiệt độ Subtalker"
                  techName="subtalker_temperature"
                  value={qwenState.settings.subtalker_temperature}
                  defaultValue={QWEN_DEFAULT_SETTINGS.subtalker_temperature}
                  min={0.1}
                  max={2.0}
                  step={0.05}
                  formatValue={(v) => v.toFixed(2)}
                  description="Nhiệt độ lấy mẫu cho mạng Subtalker (Giá trị chuẩn theo cấu hình Qwen: 0.9)."
                  onChange={(val) => handleUpdateQwen("subtalker_temperature", val)}
                />

                <SliderParam
                  label="Xác suất tích lũy Subtalker"
                  techName="subtalker_top_p"
                  value={qwenState.settings.subtalker_top_p}
                  defaultValue={QWEN_DEFAULT_SETTINGS.subtalker_top_p}
                  min={0.1}
                  max={1.0}
                  step={0.01}
                  formatValue={(v) => v.toFixed(2)}
                  description="Ngưỡng xác suất tích lũy cho mạng Subtalker (Chuẩn Qwen: 1.0)."
                  onChange={(val) => handleUpdateQwen("subtalker_top_p", val)}
                />

                <SliderParam
                  label="Giới hạn ứng viên Subtalker"
                  techName="subtalker_top_k"
                  value={qwenState.settings.subtalker_top_k}
                  defaultValue={QWEN_DEFAULT_SETTINGS.subtalker_top_k}
                  min={1}
                  max={200}
                  step={1}
                  description="Số lượng ứng viên token hàng đầu cho mạng Subtalker (Chuẩn Qwen: 50)."
                  onChange={(val) => handleUpdateQwen("subtalker_top_k", val)}
                />

                <SliderParam
                  label="Giới hạn token âm thanh"
                  techName="max_new_tokens"
                  value={qwenState.settings.max_new_tokens}
                  defaultValue={QWEN_DEFAULT_SETTINGS.max_new_tokens}
                  min={256}
                  max={8192}
                  step={128}
                  formatValue={(v) => `${v} tokens`}
                  description="Số token âm thanh tối đa sinh ra cho một đoạn tổng hợp. 2048 token tương đương khoảng 25-30 giây phát âm."
                  onChange={(val) => handleUpdateQwen("max_new_tokens", val)}
                />

                <SwitchParam
                  label="Chế độ xử lý toàn câu"
                  techName="non_streaming_mode"
                  value={qwenState.settings.non_streaming_mode}
                  defaultValue={QWEN_DEFAULT_SETTINGS.non_streaming_mode}
                  description="Xử lý toàn bộ văn bản một lượt thay vì giả lập streaming. Giúp đồng bộ ngữ cảnh âm thanh tốt hơn cho các câu dài."
                  onChange={(val) => handleUpdateQwen("non_streaming_mode", val)}
                />
              </div>
            </SectionCard>
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

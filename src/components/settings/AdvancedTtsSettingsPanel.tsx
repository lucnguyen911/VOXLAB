import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  RotateCcw,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  TtsModelKey,
  StoredTtsAdvancedSettings,
  OmniVoiceAdvancedSettings,
  ChatterboxAdvancedSettings,
  QwenAdvancedSettings,
  OMNIVOICE_DEFAULT_SETTINGS,
  CHATTERBOX_DEFAULT_SETTINGS,
  QWEN_DEFAULT_SETTINGS,
  getTtsAdvancedSettingsSnapshot,
  loadTtsAdvancedSettings,
  saveModelTtsAdvancedSettings,
  resetModelTtsAdvancedSettings,
} from "../../services/ai/ttsAdvancedSettings";

// ============================================================================
// REUSABLE PARAMETER CONTROLS
// ============================================================================

interface SliderParamProps {
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  formatValue?: (val: number) => string;
  description: string;
  onChange: (val: number) => void;
}

const SliderParam: React.FC<SliderParamProps> = ({
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  unit = "",
  formatValue,
  description,
  onChange,
}) => {
  const isDefault = Math.abs(value - defaultValue) < 0.0001;
  const displayVal = formatValue ? formatValue(value) : `${value}${unit}`;
  const defaultDisplay = formatValue ? formatValue(defaultValue) : `${defaultValue}${unit}`;

  return (
    <div className="p-3.5 bg-surface2/40 rounded-xl border border-borderDefault/70 space-y-2 hover:border-borderDefault transition-colors">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-textPrimary">
          {label}
        </label>
        <div className="flex items-center gap-1.5 shrink-0">
          {!isDefault && (
            <span
              title={`Mặc định: ${defaultDisplay}`}
              className="text-[10px] font-mono text-textMuted px-1.5 py-0.5 rounded bg-surface3/80 border border-borderDefault/50"
            >
              Mặc định: {defaultDisplay}
            </span>
          )}
          <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface3 text-accent border border-accent/25">
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

      <p className="text-[11px] text-textMuted leading-snug">
        {description}
      </p>
    </div>
  );
};

interface SwitchParamProps {
  label: string;
  value: boolean;
  defaultValue: boolean;
  description: string;
  onChange: (val: boolean) => void;
}

const SwitchParam: React.FC<SwitchParamProps> = ({
  label,
  value,
  defaultValue,
  description,
  onChange,
}) => {
  const isDefault = value === defaultValue;

  return (
    <div className="p-3.5 bg-surface2/40 rounded-xl border border-borderDefault/70 flex items-center justify-between gap-4 hover:border-borderDefault transition-colors">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-textPrimary">
            {label}
          </label>
          {!isDefault && (
            <span className="text-[10px] font-mono text-textMuted px-1.5 py-0.2 rounded bg-surface3/80 border border-borderDefault/50">
              Mặc định: {defaultValue ? "Bật" : "Tắt"}
            </span>
          )}
        </div>
        <p className="text-[11px] text-textMuted leading-snug">
          {description}
        </p>
      </div>

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
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const AdvancedTtsSettingsPanel: React.FC = () => {
  const [activeModel, setActiveModel] = useState<TtsModelKey>("omnivoice");

  const [draftSettings, setDraftSettings] = useState<StoredTtsAdvancedSettings>(() =>
    getTtsAdvancedSettingsSnapshot()
  );

  const hasUserEditedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isResetSuccess, setIsResetSuccess] = useState(false);
  const [isOperating, setIsOperating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    loadTtsAdvancedSettings().then((loaded) => {
      if (!mounted) return;
      if (!hasUserEditedRef.current) {
        setDraftSettings(loaded);
      }
    });
    return () => {
      mounted = false;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // Listen for global reset from Tab Chung ("Đặt lại mặc định")
  useEffect(() => {
    const handleExternalReset = () => {
      loadTtsAdvancedSettings().then((loaded) => {
        setDraftSettings(loaded);
      });
    };
    window.addEventListener("voxlab_tts_advanced_settings_changed", handleExternalReset);
    return () => {
      window.removeEventListener("voxlab_tts_advanced_settings_changed", handleExternalReset);
    };
  }, []);

  const scheduleAutoSave = useCallback(
    (model: TtsModelKey, nextModelSettings: any) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveModelTtsAdvancedSettings(model, nextModelSettings).catch((err: any) => {
          setActionError(err?.message || "Không thể lưu cài đặt.");
        });
      }, 180);
    },
    []
  );

  const handleUpdateOmniVoice = useCallback(
    <K extends keyof OmniVoiceAdvancedSettings>(key: K, val: OmniVoiceAdvancedSettings[K]) => {
      hasUserEditedRef.current = true;
      setIsResetSuccess(false);
      setActionError(null);
      setDraftSettings((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as StoredTtsAdvancedSettings;
        next.omnivoice.settings[key] = val;
        scheduleAutoSave("omnivoice", next.omnivoice.settings);
        return next;
      });
    },
    [scheduleAutoSave]
  );

  const handleUpdateChatterbox = useCallback(
    <K extends keyof ChatterboxAdvancedSettings>(key: K, val: ChatterboxAdvancedSettings[K]) => {
      hasUserEditedRef.current = true;
      setIsResetSuccess(false);
      setActionError(null);
      setDraftSettings((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as StoredTtsAdvancedSettings;
        next.chatterbox.settings[key] = val;
        scheduleAutoSave("chatterbox", next.chatterbox.settings);
        return next;
      });
    },
    [scheduleAutoSave]
  );

  const handleUpdateQwen = useCallback(
    <K extends keyof QwenAdvancedSettings>(key: K, val: QwenAdvancedSettings[K]) => {
      hasUserEditedRef.current = true;
      setIsResetSuccess(false);
      setActionError(null);
      setDraftSettings((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as StoredTtsAdvancedSettings;
        next.qwen.settings[key] = val;
        scheduleAutoSave("qwen", next.qwen.settings);
        return next;
      });
    },
    [scheduleAutoSave]
  );

  const handleResetCurrentModel = async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    setIsOperating(true);
    setActionError(null);
    setIsResetSuccess(false);
    try {
      const updatedPersisted = await resetModelTtsAdvancedSettings(activeModel);
      setDraftSettings((prev) => ({
        ...prev,
        [activeModel]: JSON.parse(JSON.stringify(updatedPersisted[activeModel])),
      }));
      setIsResetSuccess(true);
      setTimeout(() => setIsResetSuccess(false), 2500);
    } catch (err: any) {
      setActionError(err?.message || "Không thể khôi phục mặc định.");
    } finally {
      setIsOperating(false);
    }
  };

  const omniState = draftSettings.omnivoice;
  const chatterState = draftSettings.chatterbox;
  const qwenState = draftSettings.qwen;

  return (
    <div className="p-5 bg-surface1 rounded-xl border border-borderDefault space-y-4">
      {/* Header & Model Sub-Tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <span className="font-semibold text-xs text-textPrimary block">
          Thông số nâng cao TTS
        </span>

        <div className="flex items-center gap-2">
          {isResetSuccess && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
              <Check className="w-3.5 h-3.5" />
              <span>Đã đặt lại mặc định</span>
            </span>
          )}
          {actionError && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-medium">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{actionError}</span>
            </span>
          )}
          <button
            type="button"
            onClick={handleResetCurrentModel}
            disabled={isOperating}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-borderDefault bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Đặt lại mặc định</span>
          </button>
        </div>
      </div>

      {/* Model Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-borderDefault/80 pb-3">
        <button
          type="button"
          onClick={() => {
            setActiveModel("omnivoice");
            setActionError(null);
            setIsResetSuccess(false);
          }}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            activeModel === "omnivoice"
              ? "bg-accent text-white shadow-xs font-semibold"
              : "bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary"
          }`}
        >
          OmniVoice
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveModel("chatterbox");
            setActionError(null);
            setIsResetSuccess(false);
          }}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            activeModel === "chatterbox"
              ? "bg-accent text-white shadow-xs font-semibold"
              : "bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary"
          }`}
        >
          Chatterbox Turbo
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveModel("qwen");
            setActionError(null);
            setIsResetSuccess(false);
          }}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            activeModel === "qwen"
              ? "bg-accent text-white shadow-xs font-semibold"
              : "bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary"
          }`}
        >
          Qwen3-TTS 1.7B Base
        </button>
      </div>

      {/* Model Parameter Controls */}
      <div>
        {activeModel === "omnivoice" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SliderParam
              label="Số bước suy luận"
              value={omniState.settings.num_step}
              defaultValue={OMNIVOICE_DEFAULT_SETTINGS.num_step}
              min={4}
              max={128}
              step={1}
              description="Giảm: xử lý nhanh hơn • Tăng: âm thanh chi tiết, mượt hơn."
              onChange={(val) => handleUpdateOmniVoice("num_step", val)}
            />

            <SliderParam
              label="Mức hướng dẫn"
              value={omniState.settings.guidance_scale}
              defaultValue={OMNIVOICE_DEFAULT_SETTINGS.guidance_scale}
              min={1.0}
              max={10.0}
              step={0.1}
              formatValue={(v) => v.toFixed(1)}
              description="Giảm: ngữ điệu tự nhiên hơn • Tăng: đọc rõ chữ, bám sát văn bản."
              onChange={(val) => handleUpdateOmniVoice("guidance_scale", val)}
            />

            <SliderParam
              label="Nhiệt độ vị trí"
              value={omniState.settings.position_temperature}
              defaultValue={OMNIVOICE_DEFAULT_SETTINGS.position_temperature}
              min={0.0}
              max={20.0}
              step={0.1}
              formatValue={(v) => v.toFixed(1)}
              description="Giảm: nhịp đọc đều, ổn định • Tăng: nhịp điệu và ngắt nghỉ linh hoạt hơn."
              onChange={(val) => handleUpdateOmniVoice("position_temperature", val)}
            />

            <SliderParam
              label="Nhiệt độ lớp"
              value={omniState.settings.class_temperature}
              defaultValue={OMNIVOICE_DEFAULT_SETTINGS.class_temperature}
              min={0.0}
              max={5.0}
              step={0.05}
              formatValue={(v) => v.toFixed(2)}
              description="Giảm: phát âm chuẩn, ít lỗi • Tăng: giọng biến thiên đa dạng hơn."
              onChange={(val) => handleUpdateOmniVoice("class_temperature", val)}
            />

            <div className="md:col-span-2">
              <SwitchParam
                label="Khử nhiễu"
                value={omniState.settings.denoise}
                defaultValue={OMNIVOICE_DEFAULT_SETTINGS.denoise}
                description="Bật: lọc tạp âm nền của giọng mẫu • Tắt: giữ nguyên âm thanh gốc."
                onChange={(val) => handleUpdateOmniVoice("denoise", val)}
              />
            </div>
          </div>
        )}

        {activeModel === "chatterbox" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SliderParam
              label="Nhiệt độ lấy mẫu"
              value={chatterState.settings.temperature}
              defaultValue={CHATTERBOX_DEFAULT_SETTINGS.temperature}
              min={0.1}
              max={2.0}
              step={0.05}
              formatValue={(v) => v.toFixed(2)}
              description="Giảm: đọc ổn định, ít lỗi • Tăng: giàu cảm xúc và nhấn nhá hơn."
              onChange={(val) => handleUpdateChatterbox("temperature", val)}
            />

            <SliderParam
              label="Xác suất tích lũy"
              value={chatterState.settings.top_p}
              defaultValue={CHATTERBOX_DEFAULT_SETTINGS.top_p}
              min={0.1}
              max={1.0}
              step={0.01}
              formatValue={(v) => v.toFixed(2)}
              description="Giảm: phát âm an toàn, rõ chữ • Tăng: âm sắc tự nhiên, phong phú hơn."
              onChange={(val) => handleUpdateChatterbox("top_p", val)}
            />

            <SliderParam
              label="Phạt lặp"
              value={chatterState.settings.repetition_penalty}
              defaultValue={CHATTERBOX_DEFAULT_SETTINGS.repetition_penalty}
              min={1.0}
              max={2.0}
              step={0.05}
              formatValue={(v) => v.toFixed(2)}
              description="Giảm: giọng liền mạch tự nhiên • Tăng: chống lặp từ hoặc ngân âm cuối câu."
              onChange={(val) => handleUpdateChatterbox("repetition_penalty", val)}
            />

            <SwitchParam
              label="Chuẩn hóa âm lượng"
              value={chatterState.settings.norm_loudness}
              defaultValue={CHATTERBOX_DEFAULT_SETTINGS.norm_loudness}
              description="Bật: cân bằng âm lượng giọng mẫu đều nhau • Tắt: giữ âm lượng gốc."
              onChange={(val) => handleUpdateChatterbox("norm_loudness", val)}
            />
          </div>
        )}

        {activeModel === "qwen" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SliderParam
              label="Nhiệt độ lấy mẫu"
              value={qwenState.settings.temperature}
              defaultValue={QWEN_DEFAULT_SETTINGS.temperature}
              min={0.1}
              max={2.0}
              step={0.05}
              formatValue={(v) => v.toFixed(2)}
              description="Giảm: đọc ổn định, rõ chữ • Tăng: ngữ điệu biểu cảm, đa dạng hơn."
              onChange={(val) => handleUpdateQwen("temperature", val)}
            />

            <SliderParam
              label="Xác suất tích lũy"
              value={qwenState.settings.top_p}
              defaultValue={QWEN_DEFAULT_SETTINGS.top_p}
              min={0.1}
              max={1.0}
              step={0.01}
              formatValue={(v) => v.toFixed(2)}
              description="Giảm: phát âm tập trung, chuẩn xác • Tăng: giữ trọn độ tự nhiên của giọng."
              onChange={(val) => handleUpdateQwen("top_p", val)}
            />

            <SliderParam
              label="Phạt lặp"
              value={qwenState.settings.repetition_penalty}
              defaultValue={QWEN_DEFAULT_SETTINGS.repetition_penalty}
              min={1.0}
              max={2.0}
              step={0.01}
              formatValue={(v) => v.toFixed(2)}
              description="Giảm: đọc trôi chảy tự nhiên • Tăng: chống vấp chữ và lặp âm ở câu dài."
              onChange={(val) => handleUpdateQwen("repetition_penalty", val)}
            />

            <SwitchParam
              label="Chỉ dùng đặc trưng người nói"
              value={qwenState.settings.x_vector_only_mode}
              defaultValue={QWEN_DEFAULT_SETTINGS.x_vector_only_mode}
              description="Bật: chỉ lấy màu giọng mẫu • Tắt: bám sát cả màu giọng và văn bản mẫu."
              onChange={(val) => handleUpdateQwen("x_vector_only_mode", val)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

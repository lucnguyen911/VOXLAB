import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Sliders,
  RotateCcw,
  Save,
  Check,
  Info,
  AlertCircle,
  AlertTriangle,
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
  techName: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  formatValue?: (val: number) => string;
  minLabel?: string;
  maxLabel?: string;
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
  minLabel,
  maxLabel,
  description,
  warning,
  onChange,
}) => {
  const isDefault = Math.abs(value - defaultValue) < 0.0001;
  const displayVal = formatValue ? formatValue(value) : `${value}${unit}`;
  const defaultDisplay = formatValue ? formatValue(defaultValue) : `${defaultValue}${unit}`;

  return (
    <div className="p-3.5 bg-surface2/40 rounded-xl border border-borderDefault/70 space-y-2 hover:border-borderDefault transition-colors">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-textPrimary">
          {label} <span className="font-mono text-[11px] text-textMuted font-normal">({techName})</span>
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

      <div className="flex justify-between text-[10px] text-textMuted font-mono">
        <span>{minLabel || `${formatValue ? formatValue(min) : min}${unit}`}</span>
        <span>{maxLabel || `${formatValue ? formatValue(max) : max}${unit}`}</span>
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
    <div className="p-3.5 bg-surface2/40 rounded-xl border border-borderDefault/70 flex items-start justify-between gap-4 hover:border-borderDefault transition-colors">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-textPrimary">
            {label} <span className="font-mono text-[11px] text-textMuted font-normal">({techName})</span>
          </label>
          {!isDefault && (
            <span className="text-[10px] font-mono text-textMuted px-1.5 py-0.2 rounded bg-surface3/80 border border-borderDefault/50">
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

  // Strict separation between Persisted State and Draft State
  const [persistedSettings, setPersistedSettings] = useState<StoredTtsAdvancedSettings>(() =>
    getTtsAdvancedSettingsSnapshot()
  );
  const [draftSettings, setDraftSettings] = useState<StoredTtsAdvancedSettings>(() =>
    getTtsAdvancedSettingsSnapshot()
  );

  // Track if user has modified draft before initial async load resolves
  const hasUserEditedRef = useRef(false);

  const [isSaved, setIsSaved] = useState(false);
  const [isResetSuccess, setIsResetSuccess] = useState(false);
  const [isOperating, setIsOperating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    loadTtsAdvancedSettings().then((loaded) => {
      if (!mounted) return;
      setPersistedSettings(loaded);
      if (!hasUserEditedRef.current) {
        setDraftSettings(loaded);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Determine if the currently selected active model has unsaved modifications
  const isCurrentModelDirty = useMemo(() => {
    return (
      JSON.stringify(draftSettings[activeModel].settings) !==
      JSON.stringify(persistedSettings[activeModel].settings)
    );
  }, [draftSettings, persistedSettings, activeModel]);

  const handleUpdateOmniVoice = useCallback(
    <K extends keyof OmniVoiceAdvancedSettings>(key: K, val: OmniVoiceAdvancedSettings[K]) => {
      hasUserEditedRef.current = true;
      setIsSaved(false);
      setIsResetSuccess(false);
      setActionError(null);
      setDraftSettings((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as StoredTtsAdvancedSettings;
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
      setIsResetSuccess(false);
      setActionError(null);
      setDraftSettings((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as StoredTtsAdvancedSettings;
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
      setIsResetSuccess(false);
      setActionError(null);
      setDraftSettings((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as StoredTtsAdvancedSettings;
        next.qwen.settings[key] = val;
        return next;
      });
    },
    []
  );

  const modelDisplayName = useMemo(() => {
    switch (activeModel) {
      case "omnivoice":
        return "OmniVoice";
      case "chatterbox":
        return "Chatterbox Turbo";
      case "qwen":
        return "Qwen3-TTS 1.7B Base";
    }
  }, [activeModel]);

  // Requirement: Saving applies to the active model and persists atomically to App Data
  const handleSave = async () => {
    setIsOperating(true);
    setActionError(null);
    setIsSaved(false);
    setIsResetSuccess(false);
    try {
      const updated = await saveModelTtsAdvancedSettings(
        activeModel,
        draftSettings[activeModel].settings
      );
      setPersistedSettings(updated);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setActionError(
        msg.includes("Không thể") || msg.includes("thất bại")
          ? msg
          : `Không thể lưu cài đặt cho ${modelDisplayName}: ${msg}`
      );
    } finally {
      setIsOperating(false);
    }
  };

  // Requirement 4: Reset To Defaults - Mandatory single-click atomic operation
  // 1. Resets target model to official default set (including internal parameters).
  // 2. Automatically writes default config to App Data on disk.
  // 3. Updates active in-memory configuration cache.
  // 4. Immediately updates UI controls.
  // 5. Shows "Đã khôi phục mặc định" without needing to press "Lưu cài đặt".
  // 6. Data protection: Does NOT modify persisted or draft data of the other 2 models.
  // 7. If disk write fails: reports error in Vietnamese, no false success, RAM/disk consistency preserved.
  const handleResetCurrentModel = async () => {
    setIsOperating(true);
    setActionError(null);
    setIsSaved(false);
    setIsResetSuccess(false);
    try {
      const updatedPersisted = await resetModelTtsAdvancedSettings(activeModel);
      // Update persisted state baseline
      setPersistedSettings(updatedPersisted);
      // Update ONLY the active model in draft state, preserving any unsaved drafts of other models
      setDraftSettings((prev) => ({
        ...prev,
        [activeModel]: JSON.parse(JSON.stringify(updatedPersisted[activeModel])),
      }));
      setIsResetSuccess(true);
      setTimeout(() => setIsResetSuccess(false), 3000);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setActionError(
        msg.includes("Không thể") || msg.includes("thất bại")
          ? msg
          : `Không thể khôi phục mặc định cho ${modelDisplayName}: ${msg}`
      );
    } finally {
      setIsOperating(false);
    }
  };

  const omniState = draftSettings.omnivoice;
  const chatterState = draftSettings.chatterbox;
  const qwenState = draftSettings.qwen;

  return (
    <div className="p-5 bg-surface1 rounded-xl border border-borderDefault space-y-4">
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
            Bộ thông số suy luận mặc định chuẩn cho từng mô hình AI cục bộ. Tùy chỉnh tại đây sẽ tự động áp dụng cho tất cả chức năng TTS, Hội thoại, Batch, Dubbing và Voice Clone.
          </p>
        </div>

        {/* Global Save / Reset / Dirty feedback */}
        <div className="flex items-center gap-2 shrink-0">
          {isCurrentModelDirty && !isSaved && !isResetSuccess && !actionError && (
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
          {isResetSuccess && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium shrink-0 animate-fade-in">
              <Check className="w-3.5 h-3.5" />
              <span>Đã khôi phục mặc định</span>
            </div>
          )}
          {actionError && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-medium shrink-0 animate-fade-in">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{actionError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Model Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-borderDefault/80 pb-2">
        <button
          type="button"
          onClick={() => {
            setActiveModel("omnivoice");
            setActionError(null);
            setIsSaved(false);
            setIsResetSuccess(false);
          }}
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
            5 thông số
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveModel("chatterbox");
            setActionError(null);
            setIsSaved(false);
            setIsResetSuccess(false);
          }}
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
            4 thông số
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveModel("qwen");
            setActionError(null);
            setIsSaved(false);
            setIsResetSuccess(false);
          }}
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
            4 thông số
          </span>
        </button>
      </div>

      {/* Model Parameter Controls */}
      <div className="space-y-4">
        {/* ================================================================= */}
        {/* OmniVoice Controls: Exactly 5 parameters                          */}
        {/* ================================================================= */}
        {activeModel === "omnivoice" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* 1. num_step */}
            <SliderParam
              label="Số bước suy luận"
              techName="num_step"
              value={omniState.settings.num_step}
              defaultValue={OMNIVOICE_DEFAULT_SETTINGS.num_step}
              min={4}
              max={128}
              step={1}
              minLabel="4 (Nhanh)"
              maxLabel="128 (Kỹ)"
              description="Số bước giải Flow Matching. Giá trị cao hơn giúp âm thanh nét và tự nhiên hơn nhưng thời gian xử lý lâu hơn."
              warning={
                omniState.settings.num_step < 16
                  ? "Giá trị dưới 16 có thể khiến giọng nói méo mó hoặc rè tiếng."
                  : undefined
              }
              onChange={(val) => handleUpdateOmniVoice("num_step", val)}
            />

            {/* 2. guidance_scale */}
            <SliderParam
              label="Mức hướng dẫn"
              techName="guidance_scale"
              value={omniState.settings.guidance_scale}
              defaultValue={OMNIVOICE_DEFAULT_SETTINGS.guidance_scale}
              min={1.0}
              max={10.0}
              step={0.1}
              formatValue={(v) => v.toFixed(1)}
              minLabel="1.0 (Tự do)"
              maxLabel="10.0 (Bám sát)"
              description="Mức độ bám sát văn bản (CFG). Giúp đọc rõ chữ và hạn chế nuốt từ."
              onChange={(val) => handleUpdateOmniVoice("guidance_scale", val)}
            />

            {/* 3. position_temperature */}
            <SliderParam
              label="Nhiệt độ vị trí"
              techName="position_temperature"
              value={omniState.settings.position_temperature}
              defaultValue={OMNIVOICE_DEFAULT_SETTINGS.position_temperature}
              min={0.0}
              max={20.0}
              step={0.1}
              formatValue={(v) => v.toFixed(1)}
              minLabel="0.0 (Cố định)"
              maxLabel="20.0 (Linh hoạt)"
              description="Kiểm soát căn chỉnh nhịp điệu và thời gian phát âm. Mức thấp giúp đọc ổn định hơn."
              onChange={(val) => handleUpdateOmniVoice("position_temperature", val)}
            />

            {/* 4. class_temperature */}
            <SliderParam
              label="Nhiệt độ lớp"
              techName="class_temperature"
              value={omniState.settings.class_temperature}
              defaultValue={OMNIVOICE_DEFAULT_SETTINGS.class_temperature}
              min={0.0}
              max={5.0}
              step={0.05}
              formatValue={(v) => v.toFixed(2)}
              minLabel="0.0 (Tối ưu - Ít lỗi)"
              maxLabel="5.0 (Đa dạng)"
              description="Nhiệt độ lấy mẫu mã âm thanh. 0.0 là giải mã chuẩn tối ưu (ít lỗi nhất)."
              onChange={(val) => handleUpdateOmniVoice("class_temperature", val)}
            />

            {/* 5. denoise */}
            <div className="md:col-span-2">
              <SwitchParam
                label="Khử nhiễu"
                techName="denoise"
                value={omniState.settings.denoise}
                defaultValue={OMNIVOICE_DEFAULT_SETTINGS.denoise}
                description="Khử tạp âm nền từ tệp giọng mẫu trước khi tổng hợp."
                onChange={(val) => handleUpdateOmniVoice("denoise", val)}
              />
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* Chatterbox Turbo Controls: Exactly 4 parameters                   */}
        {/* ================================================================= */}
        {activeModel === "chatterbox" && (
          <div className="space-y-3.5">
            <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-lg flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Lưu ý:</strong> Chatterbox Turbo đã được tối ưu tốc độ và chất lượng. Các thông số không hỗ trợ bởi kiến trúc Turbo (như CFG, exaggeration, speed) được ẩn hoàn toàn để tránh nhầm lẫn.
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* 1. temperature */}
              <SliderParam
                label="Nhiệt độ lấy mẫu"
                techName="temperature"
                value={chatterState.settings.temperature}
                defaultValue={CHATTERBOX_DEFAULT_SETTINGS.temperature}
                min={0.1}
                max={2.0}
                step={0.05}
                formatValue={(v) => v.toFixed(2)}
                minLabel="0.1 (Chính xác)"
                maxLabel="2.0 (Đa dạng)"
                description="Kiểm soát độ biến thiên âm vị. Mức thấp giúp giọng đọc rõ và ít lỗi; mức cao tăng sắc thái tự nhiên."
                onChange={(val) => handleUpdateChatterbox("temperature", val)}
              />

              {/* 2. top_p */}
              <SliderParam
                label="Xác suất tích lũy"
                techName="top_p"
                value={chatterState.settings.top_p}
                defaultValue={CHATTERBOX_DEFAULT_SETTINGS.top_p}
                min={0.1}
                max={1.0}
                step={0.01}
                formatValue={(v) => v.toFixed(2)}
                minLabel="0.1 (Tập trung)"
                maxLabel="1.0 (Đầy đủ)"
                description="Giới hạn các token có xác suất tích lũy cao nhất (Nucleus sampling)."
                onChange={(val) => handleUpdateChatterbox("top_p", val)}
              />

              {/* 3. repetition_penalty */}
              <SliderParam
                label="Phạt lặp"
                techName="repetition_penalty"
                value={chatterState.settings.repetition_penalty}
                defaultValue={CHATTERBOX_DEFAULT_SETTINGS.repetition_penalty}
                min={1.0}
                max={2.0}
                step={0.05}
                formatValue={(v) => v.toFixed(2)}
                minLabel="1.0 (Tắt)"
                maxLabel="2.0 (Chặt chẽ)"
                description="Ngăn chặn tình trạng vấp chữ, lặp lại từ hoặc âm tiết cuối câu ở đoạn văn dài."
                onChange={(val) => handleUpdateChatterbox("repetition_penalty", val)}
              />

              {/* 4. norm_loudness */}
              <SwitchParam
                label="Chuẩn hóa âm lượng"
                techName="norm_loudness"
                value={chatterState.settings.norm_loudness}
                defaultValue={CHATTERBOX_DEFAULT_SETTINGS.norm_loudness}
                description="Tự động chuẩn hóa âm lượng giọng mẫu về mức chuẩn phát thanh (-24 LUFS) khi trích xuất đặc trưng."
                onChange={(val) => handleUpdateChatterbox("norm_loudness", val)}
              />
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* Qwen3-TTS 1.7B Base Controls: Exactly 4 parameters                */}
        {/* ================================================================= */}
        {activeModel === "qwen" && (
          <div className="space-y-3.5">
            <div className="p-3 bg-purple-500/10 border border-purple-500/25 rounded-lg flex items-start gap-2 text-xs text-purple-700 dark:text-purple-300">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Chế độ khuyên dùng:</strong> Mặc định ưu tiên chế độ nhân bản giọng theo ngữ cảnh (ICL) chất lượng cao nhất bằng cách sử dụng đồng thời cả âm thanh tham chiếu và bản chép lời.
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* 1. temperature */}
              <SliderParam
                label="Nhiệt độ lấy mẫu"
                techName="temperature"
                value={qwenState.settings.temperature}
                defaultValue={QWEN_DEFAULT_SETTINGS.temperature}
                min={0.1}
                max={2.0}
                step={0.05}
                formatValue={(v) => v.toFixed(2)}
                minLabel="0.1 (Chính xác)"
                maxLabel="2.0 (Đa dạng)"
                description="Nhiệt độ sinh mã âm thanh. Giảm nhẹ (0.7 - 0.8) giúp giọng đọc ổn định, phát âm rõ chữ hơn."
                onChange={(val) => handleUpdateQwen("temperature", val)}
              />

              {/* 2. top_p */}
              <SliderParam
                label="Xác suất tích lũy"
                techName="top_p"
                value={qwenState.settings.top_p}
                defaultValue={QWEN_DEFAULT_SETTINGS.top_p}
                min={0.1}
                max={1.0}
                step={0.01}
                formatValue={(v) => v.toFixed(2)}
                minLabel="0.1 (Tập trung)"
                maxLabel="1.0 (Chuẩn Qwen)"
                description="Ngưỡng xác suất tích lũy. Mặc định 1.0 của Qwen3-TTS giữ trọn phân phối ngữ âm."
                onChange={(val) => handleUpdateQwen("top_p", val)}
              />

              {/* 3. repetition_penalty */}
              <SliderParam
                label="Phạt lặp"
                techName="repetition_penalty"
                value={qwenState.settings.repetition_penalty}
                defaultValue={QWEN_DEFAULT_SETTINGS.repetition_penalty}
                min={1.0}
                max={2.0}
                step={0.01}
                formatValue={(v) => v.toFixed(2)}
                minLabel="1.0 (Tắt)"
                maxLabel="2.0 (Chặt chẽ)"
                description="Hệ số chống lặp ngữ âm. 1.05 giúp hạn chế lặp từ mà vẫn giữ độ trôi chảy mượt mà."
                onChange={(val) => handleUpdateQwen("repetition_penalty", val)}
              />

              {/* 4. x_vector_only_mode */}
              <SwitchParam
                label="Chỉ dùng đặc trưng người nói"
                techName="x_vector_only_mode"
                value={qwenState.settings.x_vector_only_mode}
                defaultValue={QWEN_DEFAULT_SETTINGS.x_vector_only_mode}
                description="Tắt để ưu tiên chế độ In-Context Learning (ICL) chất lượng cao nhất khi có cả âm thanh mẫu và bản chép lời."
                onChange={(val) => handleUpdateQwen("x_vector_only_mode", val)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Action Footer: Exactly 2 Buttons: Khôi phục mặc định & Lưu cài đặt */}
      <div className="flex items-center justify-between pt-3 border-t border-borderDefault/80">
        <button
          type="button"
          onClick={handleResetCurrentModel}
          disabled={isOperating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-borderDefault bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Khôi phục mặc định cho {modelDisplayName}</span>
        </button>

        <div className="flex items-center gap-3">
          {actionError && (
            <span className="text-xs text-rose-500 font-medium flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {actionError}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={isOperating}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50 ${
              isCurrentModelDirty
                ? "bg-accent hover:bg-accentHover ring-2 ring-accent/40 font-bold"
                : "bg-accent hover:bg-accentHover"
            }`}
          >
            {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>
              {isOperating
                ? "Đang lưu..."
                : isSaved
                ? "Đã lưu cài đặt"
                : isCurrentModelDirty
                ? `Lưu cài đặt cho ${modelDisplayName}`
                : "Lưu cài đặt"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

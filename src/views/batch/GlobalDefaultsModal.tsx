import React, { useState } from "react";
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
} from "lucide-react";
import { BatchTaskConfigMap } from "../../types/batch";
import { useI18n } from "../../i18n/context";

export interface GlobalDefaultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  globalDefaults: BatchTaskConfigMap;
  onSaveDefaults: (defaults: BatchTaskConfigMap) => void;
  selectedJobCount: number;
  onApplyToSelected: (defaults: BatchTaskConfigMap) => void;
}

export const GlobalDefaultsModal: React.FC<GlobalDefaultsModalProps> = ({
  isOpen,
  onClose,
  globalDefaults,
  onSaveDefaults,
  selectedJobCount,
  onApplyToSelected,
}) => {
  if (!isOpen) return null;

  const { t } = useI18n();

  const [activeTab, setActiveTab] = useState<
    "general" | "tts" | "dialogue" | "transcription" | "translation" | "dubbing"
  >("general");

  const [localDefaults, setLocalDefaults] = useState<BatchTaskConfigMap>({
    ...globalDefaults,
  });

  const handleApply = () => {
    if (selectedJobCount === 0) return;
    onApplyToSelected(localDefaults);
    onClose();
  };

  const handleSaveDefault = () => {
    onSaveDefaults(localDefaults);
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
              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Định dạng âm thanh đầu ra
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setLocalDefaults((prev) => ({
                        ...prev,
                        tts: { ...(prev.tts || ({} as any)), volume: 100 },
                      }))
                    }
                    className="p-3 rounded-lg border border-borderDefault bg-surface2 text-left"
                  >
                    <div className="font-bold text-textPrimary">WAV (Không nén)</div>
                    <div className="text-[11px] text-textMuted">Tương thích tối đa cho hậu kỳ</div>
                  </button>
                  <button
                    type="button"
                    className="p-3 rounded-lg border border-borderDefault bg-surface2 text-left opacity-80"
                  >
                    <div className="font-bold text-textPrimary">MP3 (Chuẩn nén)</div>
                    <div className="text-[11px] text-textMuted">Tiết kiệm dung lượng lưu trữ</div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: TTS */}
          {activeTab === "tts" && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Tốc độ đọc mặc định (Speed)
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.05"
                  value={localDefaults.tts?.speed ?? 1.0}
                  onChange={(e) => {
                    const speed = parseFloat(e.target.value);
                    setLocalDefaults((prev) => ({
                      ...prev,
                      tts: { ...(prev.tts || ({} as any)), speed },
                    }));
                  }}
                  className="w-full accent-accent bg-surface3 h-1.5 rounded-full cursor-pointer"
                />
                <span className="font-mono text-accent text-right block">
                  {(localDefaults.tts?.speed ?? 1.0).toFixed(2)}x
                </span>
              </div>
            </div>
          )}

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
                  Mô hình Whisper ASR
                </label>
                <select
                  value={localDefaults.transcription?.whisperModel || "base"}
                  onChange={(e) => {
                    const whisperModel = e.target.value;
                    setLocalDefaults((prev) => ({
                      ...prev,
                      transcription: { ...(prev.transcription || ({} as any)), whisperModel },
                    }));
                  }}
                  className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary"
                >
                  <option value="tiny">Tiny (Nhanh nhất, độ chính xác cơ bản)</option>
                  <option value="base">Base (Cân bằng tốc độ & độ chính xác)</option>
                  <option value="small">Small (Chính xác tốt hơn)</option>
                  <option value="large-v3">Large v3 (Chính xác cao nhất)</option>
                </select>
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

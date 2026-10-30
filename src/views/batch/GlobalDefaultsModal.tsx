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
import {
  BatchTaskConfigMap,
  BatchJobOutputSnapshot,
  BatchCollisionPolicy,
} from "../../types/batch";
import { useI18n } from "../../i18n/context";
import { loadSubtitleSettings } from "../../services/subtitle/profiles";
import {
  loadBatchGlobalOutputSettings,
  saveBatchGlobalOutputSettings,
} from "../../services/batch/configSnapshotResolver";
import { getDefaultBatchOutputDir } from "../../services/batch/batchRuntime";
import { isTauriRuntime } from "../../services/ai/tauriBackend";

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

  const { t } = useI18n();

  const [activeTab, setActiveTab] = useState<
    "general" | "tts" | "dialogue" | "transcription" | "translation" | "dubbing"
  >("general");

  const [localDefaults, setLocalDefaults] = useState<BatchTaskConfigMap>({
    ...globalDefaults,
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

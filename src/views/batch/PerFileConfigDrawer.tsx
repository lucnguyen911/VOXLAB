import React, { useState } from "react";
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
} from "lucide-react";
import {
  BatchJob,
  BatchTaskConfigMap,
  BatchJobOutputSnapshot,
  BatchCollisionPolicy,
  BatchDialogueSnapshot,
} from "../../types/batch";
import { useI18n } from "../../i18n/context";

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

  const { t } = useI18n();

  const [activeTab, setActiveTab] = useState<
    "output" | "tts" | "dialogue" | "transcription" | "translation" | "dubbing"
  >("output");
  const [outputSnapshot, setOutputSnapshot] = useState<BatchJobOutputSnapshot>({
    ...job.outputSnapshot,
  });
  const [configOverrides, setConfigOverrides] = useState<Partial<BatchTaskConfigMap>>({
    ...job.configOverrides,
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
                  Thư mục xuất kết quả
                </label>
                <input
                  type="text"
                  value={outputSnapshot.resolvedOutputDirectory}
                  onChange={(e) =>
                    setOutputSnapshot((prev) => ({
                      ...prev,
                      resolvedOutputDirectory: e.target.value,
                    }))
                  }
                  className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary font-mono focus:border-accent focus:outline-none"
                  placeholder="D:/VoxLabOutput/Batch_Export"
                />
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

          {/* TAB 2: TTS OVERRIDES */}
          {activeTab === "tts" && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-textMuted uppercase mb-1">
                  Tốc độ đọc (Speed)
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.05"
                  value={configOverrides.tts?.speed ?? 1.0}
                  onChange={(e) => {
                    const speed = parseFloat(e.target.value);
                    setConfigOverrides((prev) => ({
                      ...prev,
                      tts: { ...(prev.tts || {}), speed } as any,
                    }));
                  }}
                  className="w-full accent-accent bg-surface3 h-1.5 rounded-full cursor-pointer"
                />
                <span className="font-mono text-accent text-right block">
                  {(configOverrides.tts?.speed ?? 1.0).toFixed(2)}x
                </span>
              </div>
            </div>
          )}

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

            const handleMinChange = (raw: number) => {
              const val = isNaN(raw) ? 0 : Math.max(0, Math.min(2.0, Math.round(raw * 100) / 100));
              let newMax = maxSec;
              if (val > newMax) {
                newMax = val;
              }
              setConfigOverrides((prev) => ({
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
              setConfigOverrides((prev) => ({
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

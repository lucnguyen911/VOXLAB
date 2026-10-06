import React, { useState, useRef, useEffect } from "react";
import { Clock, Check, AlertCircle } from "lucide-react";
import { validatePauseDuration } from "../../services/pause";

interface ManualPausePopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertPause: (durationMs: number) => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export const ManualPausePopover: React.FC<ManualPausePopoverProps> = ({
  isOpen,
  onClose,
  onInsertPause,
}) => {
  const [customSec, setCustomSec] = useState<string>("1.5");
  const [validationError, setValidationError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on Escape or click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const presets = [
    { label: "0.25 s", ms: 250 },
    { label: "0.5 s", ms: 500 },
    { label: "1.0 s", ms: 1000 },
    { label: "2.0 s", ms: 2000 },
  ];

  const handleSelectPreset = (ms: number) => {
    onInsertPause(ms);
    onClose();
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(customSec);
    const check = validatePauseDuration(val);
    if (!check.valid) {
      setValidationError(check.error || "Giá trị không hợp lệ");
      return;
    }
    setValidationError(null);
    onInsertPause(Math.round(val * 1000));
    onClose();
  };

  return (
    <div
      ref={popoverRef}
      className="absolute top-full left-0 mt-1.5 z-50 w-64 bg-surface1 border border-borderDefault rounded-xl shadow-xl p-3 text-xs animate-in fade-in zoom-in-95 duration-100 select-none"
    >
      <div className="flex items-center gap-1.5 font-semibold text-textPrimary mb-2 px-1">
        <Clock className="w-3.5 h-3.5 text-accent" />
        <span>Thêm khoảng dừng (Pause)</span>
      </div>

      <div className="text-[11px] text-textMuted mb-2.5 px-1">
        Chèn điểm ngắt nghỉ tại vị trí con trỏ trong kịch bản.
      </div>

      {/* Presets Grid */}
      <div className="grid grid-cols-2 gap-1.5 mb-3">
        {presets.map((p) => (
          <button
            key={p.ms}
            type="button"
            onClick={() => handleSelectPreset(p.ms)}
            className="flex items-center justify-center py-1.5 px-2 bg-surface2 hover:bg-surface3 text-textPrimary hover:text-accent font-mono font-medium rounded-lg border border-borderDefault transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom Duration Form */}
      <form onSubmit={handleCustomSubmit} className="pt-2 border-t border-borderDefault">
        <label className="block text-[11px] text-textSecondary font-medium mb-1 px-1">
          Tùy chỉnh thời gian:
        </label>
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="10.0"
              value={customSec}
              onChange={(e) => {
                setCustomSec(e.target.value);
                setValidationError(null);
              }}
              className="w-full px-2.5 py-1.5 bg-surface2 border border-borderDefault rounded-lg text-textPrimary font-mono focus:outline-none focus:border-accent text-xs"
              placeholder="1.5"
            />
            <span className="absolute right-2.5 top-1.5 text-textMuted text-xs pointer-events-none">
              giây
            </span>
          </div>
          <button
            type="submit"
            className="flex items-center justify-center px-3 py-1.5 bg-accent hover:bg-accentHover text-white rounded-lg font-medium text-xs shadow-2xs transition-colors shrink-0"
          >
            <Check className="w-3.5 h-3.5 mr-1" />
            <span>Chèn</span>
          </button>
        </div>

        {validationError && (
          <div className="flex items-center gap-1 text-danger text-[10.5px] mt-1.5 px-1">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}
      </form>
    </div>
  );
};

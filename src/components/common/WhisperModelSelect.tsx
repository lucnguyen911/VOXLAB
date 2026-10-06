import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface WhisperModelOption {
  id: string;
  label: string;
  desc: string;
}

interface WhisperModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  models: WhisperModelOption[];
  ariaLabel?: string;
}

export const WhisperModelSelect: React.FC<WhisperModelSelectProps> = ({
  value,
  onChange,
  models,
  ariaLabel = "Mô hình Whisper",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedModel = models.find((m) => m.id === value) || models[0];

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      if (!isOpen) {
        e.preventDefault();
        setIsOpen(true);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        const currentIndex = models.findIndex((m) => m.id === value);
        const nextIndex = (currentIndex + 1) % models.length;
        onChange(models[nextIndex].id);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        const currentIndex = models.findIndex((m) => m.id === value);
        const prevIndex = (currentIndex - 1 + models.length) % models.length;
        onChange(models[prevIndex].id);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger: Shows ONLY clean model name, with tooltip for full details */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        title={`${selectedModel?.label || value} — ${selectedModel?.desc || ""}`}
        className="w-full flex items-center justify-between bg-surface2 border border-borderDefault hover:border-textMuted/60 focus:border-accent rounded-lg px-3 py-2 text-xs text-textPrimary transition-colors cursor-pointer select-none outline-none focus:ring-1 focus:ring-accent"
      >
        <span className="font-semibold truncate">
          {selectedModel?.label || value}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-textMuted transition-transform duration-200 shrink-0 ml-2 ${
            isOpen ? "rotate-180 text-accent" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-40 left-0 right-0 top-full mt-1.5 bg-surface1 border border-borderDefault rounded-xl shadow-2xl p-1.5 space-y-1 animate-in fade-in zoom-in-95 duration-100"
        >
          {models.map((model) => {
            const isSelected = model.id === value;
            return (
              <button
                key={model.id}
                role="option"
                aria-selected={isSelected}
                type="button"
                onClick={() => {
                  onChange(model.id);
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                  isSelected
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "hover:bg-surface2 text-textPrimary border border-transparent"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-xs font-semibold ${
                      isSelected ? "text-accent" : "text-textPrimary"
                    }`}
                  >
                    {model.label}
                  </div>
                  <div className="text-[11px] text-textMuted mt-0.5 line-clamp-1">
                    {model.desc}
                  </div>
                </div>

                {isSelected && (
                  <Check className="w-4 h-4 text-accent shrink-0 ml-2" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

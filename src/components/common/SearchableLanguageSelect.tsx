import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown, Check, Globe, X } from "lucide-react";
import {
  LanguageItem,
  searchLanguages,
  getLocalizedLanguageName,
} from "../../services/subtitle/languages";
import { useI18n } from "../../i18n/context";

interface SearchableLanguageSelectProps {
  value: string;
  onChange: (code: string) => void;
  languages: LanguageItem[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  size?: "sm" | "md";
  dropdownAlign?: "left" | "right";
  showGlobe?: boolean;
  ariaLabel?: string;
}

export const SearchableLanguageSelect: React.FC<SearchableLanguageSelectProps> = ({
  value,
  onChange,
  languages,
  placeholder,
  searchPlaceholder,
  disabled = false,
  className = "",
  triggerClassName = "",
  size = "md",
  dropdownAlign = "left",
  showGlobe = true,
  ariaLabel = "Chọn ngôn ngữ",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Safely get UI language from i18n context
  let uiLang = "vi";
  try {
    const i18n = useI18n();
    if (i18n?.lang) uiLang = i18n.lang;
  } catch {
    uiLang = "vi";
  }

  // Localized fallbacks
  const defaultSearchPlaceholder = useMemo(() => {
    switch (uiLang) {
      case "en":
        return "Search...";
      case "zh":
        return "搜索...";
      case "ja":
        return "検索...";
      default:
        return "Tìm kiếm...";
    }
  }, [uiLang]);

  const defaultSelectPlaceholder = useMemo(() => {
    switch (uiLang) {
      case "en":
        return "Select language...";
      case "zh":
        return "选择语言...";
      case "ja":
        return "言語を選択...";
      default:
        return "Chọn ngôn ngữ...";
    }
  }, [uiLang]);

  const defaultEmptyText = useMemo(() => {
    switch (uiLang) {
      case "en":
        return "No matching language found";
      case "zh":
        return "未找到匹配语言";
      case "ja":
        return "一致する言語が見つかりません";
      default:
        return "Không tìm thấy ngôn ngữ phù hợp";
    }
  }, [uiLang]);

  // Selected language object
  const selectedLang = useMemo(() => {
    return languages.find((l) => l.code.toLowerCase() === value.toLowerCase());
  }, [languages, value]);

  const selectedDisplayName = useMemo(() => {
    if (!selectedLang) return placeholder || defaultSelectPlaceholder;
    return getLocalizedLanguageName(selectedLang, uiLang);
  }, [selectedLang, placeholder, defaultSelectPlaceholder, uiLang]);

  // Filtered languages based on search
  const filteredLanguages = useMemo(() => {
    return searchLanguages(searchQuery, languages, uiLang);
  }, [languages, searchQuery, uiLang]);

  // Handle outside click to close
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isOpen]);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Keyboard support: ESC to close
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const renderLanguageItem = (item: LanguageItem) => {
    const isSelected = item.code.toLowerCase() === value.toLowerCase();
    const displayName = getLocalizedLanguageName(item, uiLang);
    return (
      <button
        key={item.code}
        type="button"
        onClick={() => {
          onChange(item.code);
          setIsOpen(false);
        }}
        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors text-left cursor-pointer ${
          isSelected
            ? "bg-accent/15 text-accent font-semibold"
            : "hover:bg-surface2 text-textPrimary"
        }`}
      >
        <div className="flex items-center gap-1.5 truncate min-w-0 pr-1.5">
          <span className="truncate">{displayName}</span>
          {item.code !== "auto" && (
            <span className="text-[10px] text-textMuted uppercase font-mono px-1 py-0.5 bg-surface2/80 rounded border border-borderDefault/50 shrink-0">
              {item.code}
            </span>
          )}
        </div>
        {isSelected && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
      </button>
    );
  };

  return (
    <div ref={containerRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={ariaLabel}
        className={`w-full flex items-center justify-between gap-1.5 border border-borderDefault rounded-lg text-xs transition-colors cursor-pointer text-left ${
          size === "sm"
            ? "h-[32px] px-2.5 bg-surface2/50 hover:bg-surface2/80"
            : "px-3 py-2 bg-surface2 hover:bg-surface3"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${
          isOpen ? "border-accent ring-1 ring-accent/30" : ""
        } ${triggerClassName}`}
      >
        <div className="flex items-center gap-1.5 truncate min-w-0">
          {showGlobe && <Globe className="w-3.5 h-3.5 text-textMuted flex-shrink-0" />}
          <span className="truncate font-medium text-textPrimary">
            {selectedDisplayName}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-textMuted transition-transform duration-150 flex-shrink-0 ${
            isOpen ? "rotate-180 text-accent" : ""
          }`}
        />
      </button>

      {/* Floating Searchable Menu */}
      {isOpen && (
        <div
          className={`absolute z-50 ${
            dropdownAlign === "right" ? "right-0" : "left-0"
          } top-full mt-1.5 w-full bg-surface1 border border-borderDefault rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 flex flex-col`}
        >
          {/* Search Header */}
          <div className="p-1.5 border-b border-borderDefault bg-surface2/60">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-textMuted absolute left-2 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder || defaultSearchPlaceholder}
                className="w-full bg-surface2 border border-borderDefault rounded-md pl-7 pr-6 py-1 text-xs text-textPrimary placeholder:text-textMuted focus:border-accent focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-1.5 text-textMuted hover:text-textPrimary cursor-pointer p-0.5"
                  title="Xoá tìm kiếm"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Languages List */}
          <div className="max-h-60 overflow-y-auto p-1 text-xs space-y-0.5">
            {filteredLanguages.length === 0 ? (
              <div className="py-4 text-center text-textMuted text-xs">
                {defaultEmptyText}
              </div>
            ) : (
              filteredLanguages.map(renderLanguageItem)
            )}
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  X,
  Search,
  Play,
  Pause,
  Heart,
  Plus,
  Check,
  User,
  Sparkles,
  AlertCircle,
  RotateCcw,
  ChevronDown,
} from "lucide-react";
import { VoiceProfile } from "../../types/ui";
import { useI18n } from "../../i18n/context";
import { providerRegistry } from "../../services/providers";
import { CountryFlag } from "../common/CountryFlag";
import { VoiceProviderBadge } from "../common/VoiceProviderBadge";
import { HiddenTagsBadge } from "../common/HiddenTagsBadge";
import {
  ACCENTS_BY_LANGUAGE,
  LANGUAGE_REGISTRY,
  GENDER_OPTIONS,
  STYLE_OPTIONS,
  AGE_OPTIONS,
  SOURCE_OPTIONS,
  normalizeAccent,
  normalizeStyle,
  normalizeAge,
  getLanguageLabel,
  getAccentLabel,
  getGenderLabel,
  getStyleLabel,
  getAgeLabel,
  getSourceLabel,
  isAccentFilterSupported,
  getVoiceLanguageInfo,
  getVoiceSecondaryTags,
  computeVisibleTags,
} from "../../constants/voiceFilters";

interface VoiceSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  voices: VoiceProfile[];
  activeVoiceId: string;
  onSelectVoice: (voice: VoiceProfile) => void;
  onToggleFavorite?: (voiceId: string) => void;
  onNavigateToClone?: () => void;
  currentModel?: string;
}

// Normalization helper for Vietnamese diacritic-insensitive search
function normalizeVietnamese(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function parseUsageCount(usage?: string): number {
  if (!usage) return 0;
  const num = parseFloat(usage);
  if (usage.includes("M")) return num * 1_000_000;
  if (usage.includes("k") || usage.includes("K")) return num * 1_000;
  return num || 0;
}

export const VoiceSelectionModal: React.FC<VoiceSelectionModalProps> = ({
  isOpen,
  onClose,
  voices,
  activeVoiceId,
  onSelectVoice,
  onToggleFavorite,
  onNavigateToClone,
  currentModel: _currentModel,
}) => {
  const { lang, t } = useI18n();

  // Accessibility refs
  const modalRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);

  // Core Tab State
  const [activeTab, setActiveTab] = useState<"system" | "my_voices" | "favorites">("system");

  // Canonical Filters State (IDs, never translated strings)
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("all");
  const [selectedAccent, setSelectedAccent] = useState<string>("all");
  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [selectedStyle, setSelectedStyle] = useState<string>("all");
  const [selectedGender, setSelectedGender] = useState<string>("all");
  const [selectedAge, setSelectedAge] = useState<string>("all");

  // Active Dropdown state: null | 'lang' | 'accent' | 'source' | 'style' | 'gender' | 'age'
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [langFilterSearch, setLangFilterSearch] = useState("");

  const filteredVoiceLanguages = useMemo(() => {
    const q = langFilterSearch.trim().toLowerCase();
    if (!q) return LANGUAGE_REGISTRY;
    return LANGUAGE_REGISTRY.filter((item) => {
      const codeMatch = item.code.toLowerCase().includes(q);
      const viMatch = item.labels.vi?.toLowerCase().includes(q);
      const enMatch = item.labels.en?.toLowerCase().includes(q);
      const jaMatch = item.labels.ja?.toLowerCase().includes(q);
      const zhMatch = item.labels.zh?.toLowerCase().includes(q);
      return codeMatch || viMatch || enMatch || jaMatch || zhMatch;
    });
  }, [langFilterSearch]);

  // Sorting State
  const [sortOption, setSortOption] = useState<"popular" | "newest" | "name_asc" | "recent">("popular");

  const currentSortLabel = useMemo(() => {
    switch (sortOption) {
      case "popular":
        return t.voiceModal.popular;
      case "newest":
        return t.voiceModal.newest;
      case "name_asc":
        return t.voiceModal.alphabetical;
      case "recent":
        return t.voiceModal.recent;
      default:
        return t.voiceModal.popular;
    }
  }, [sortOption, t]);

  // Audio Preview State & Floating Toast
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 3500);
  };


  // Save trigger element and handle focus entry/containment and restoration
  useEffect(() => {
    if (isOpen) {
      triggerElementRef.current = document.activeElement as HTMLElement | null;
      const timer = setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        } else if (modalRef.current) {
          modalRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    } else {
      if (triggerElementRef.current && typeof triggerElementRef.current.focus === "function") {
        triggerElementRef.current.focus();
      }
    }
  }, [isOpen]);

  // Click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard navigation: Escape to close dropdown or modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (openDropdown) {
          setOpenDropdown(null);
          return;
        }
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);

        if (focusableElements.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, openDropdown, onClose]);

  // Check if any filter is non-default
  const hasActiveFilters =
    selectedLanguage !== "all" ||
    selectedAccent !== "all" ||
    selectedSource !== "all" ||
    selectedStyle !== "all" ||
    selectedGender !== "all" ||
    selectedAge !== "all" ||
    searchQuery.trim() !== "";

  // Reset all active filters
  const handleResetFilters = () => {
    setSelectedLanguage("all");
    setSelectedAccent("all");
    setSelectedSource("all");
    setSelectedStyle("all");
    setSelectedGender("all");
    setSelectedAge("all");
    setSearchQuery("");
    setOpenDropdown(null);
  };

  // Language selection with mandatory child accent reset
  const handleSelectLanguage = (langCode: string) => {
    setSelectedLanguage(langCode);
    // VF-R-019 / VF-R-022: Reset dependent accent to "all" when language changes
    setSelectedAccent("all");
    setOpenDropdown(null);
  };

  // Faceted options derivation (respecting actual dataset without speculative options)
  const availableAccents = useMemo(() => {
    if (selectedLanguage === "all") return [];
    return ACCENTS_BY_LANGUAGE[selectedLanguage] || [];
  }, [selectedLanguage]);

  // Accent availability based on language taxonomy and usability (>= 2 usable accents)
  const isAccentSupported = useMemo(() => {
    return isAccentFilterSupported(selectedLanguage);
  }, [selectedLanguage]);

  const isAccentDisabled = selectedLanguage === "all" || !isAccentSupported;

  const accentDisabledTooltip = useMemo(() => {
    if (selectedLanguage === "all") {
      return t.voiceModal.selectLanguageFirst;
    }
    return t.voiceModal.noAccentFilterForLanguage;
  }, [selectedLanguage, t]);

  const availableGenders = useMemo(() => {
    return GENDER_OPTIONS.filter((g) =>
      voices.some((v) => {
        if (selectedLanguage !== "all" && !v.supportedLanguages.includes(selectedLanguage)) return false;
        return v.gender === g.id;
      })
    );
  }, [selectedLanguage, voices]);

  const availableAges = useMemo(() => {
    return AGE_OPTIONS.filter((a) =>
      voices.some((v) => {
        if (selectedLanguage !== "all" && !v.supportedLanguages.includes(selectedLanguage)) return false;
        return normalizeAge(v.ageGroup) === a.id;
      })
    );
  }, [selectedLanguage, voices]);

  // Canonical filtering logic (NO DISPLAY STRINGS IN LOGIC)
  const filteredVoices = useMemo(() => {
    return voices.filter((voice) => {
      // 1. Tab filter (origin based)
      if (activeTab === "favorites") {
        if (!voice.isFavorite) return false;
      } else if (activeTab === "system") {
        const isSystem =
          voice.origin === "system" ||
          (!voice.origin && voice.source !== "local_clone" && voice.sourceType !== "clone");
        if (!isSystem) return false;
      } else if (activeTab === "my_voices") {
        const isClone =
          voice.origin === "clone" ||
          voice.source === "local_clone" ||
          voice.sourceType === "clone";
        if (!isClone) return false;
      }

      // 2. Search query (matches name, canonical tags, accent, category; diacritic-insensitive)
      if (searchQuery.trim()) {
        const rawQuery = searchQuery.toLowerCase().trim();
        const normQuery = normalizeVietnamese(searchQuery);

        const matchesName =
          voice.name.toLowerCase().includes(rawQuery) ||
          normalizeVietnamese(voice.name).includes(normQuery);

        const secTags = getVoiceSecondaryTags(voice, lang);
        const matchesTags =
          voice.tags.some(
            (tg) =>
              tg.toLowerCase().includes(rawQuery) ||
              normalizeVietnamese(tg).includes(normQuery)
          ) ||
          secTags.some(
            (tg) =>
              tg.toLowerCase().includes(rawQuery) ||
              normalizeVietnamese(tg).includes(normQuery)
          );

        const normAcc = normalizeAccent(voice.accent);
        const matchesAccent =
          (voice.accent &&
            (voice.accent.toLowerCase().includes(rawQuery) ||
              normalizeVietnamese(voice.accent).includes(normQuery))) ||
          (normAcc && getAccentLabel(normAcc, lang).toLowerCase().includes(rawQuery));

        const normSt = normalizeStyle(voice.style || voice.category);
        const matchesStyle =
          (voice.style &&
            (voice.style.toLowerCase().includes(rawQuery) ||
              normalizeVietnamese(voice.style).includes(normQuery))) ||
          (normSt && getStyleLabel(normSt, lang).toLowerCase().includes(rawQuery));

        if (!matchesName && !matchesTags && !matchesAccent && !matchesStyle) {
          return false;
        }
      }

      // 3. Language filter
      if (selectedLanguage !== "all") {
        if (!voice.supportedLanguages.includes(selectedLanguage)) return false;
      }

      // 4. Accent filter
      if (selectedAccent !== "all") {
        const normSelected = normalizeAccent(selectedAccent);
        let matches = normalizeAccent(voice.accent) === normSelected;
        if (!matches && Array.isArray(voice.tags)) {
          matches = voice.tags.some((t) => normalizeAccent(t) === normSelected);
        }
        if (!matches) return false;
      }

      // 5. Source filter
      if (selectedSource !== "all") {
        if (selectedSource === "edge") {
          const isEdge =
            voice.source === "edge" ||
            (voice.sourceType === "online" && voice.provider === "edge");
          if (!isEdge) return false;
        } else if (selectedSource === "google") {
          const isGoogle =
            voice.source === "google" ||
            (voice.sourceType === "online" && voice.provider === "google_translate");
          if (!isGoogle) return false;
        } else if (selectedSource === "local") {
          const isLocal =
            voice.source === "local" ||
            voice.source === "preset_local" ||
            voice.source === "local_clone" ||
            voice.sourceType === "local" ||
            voice.provider === "local";
          if (!isLocal) return false;
        }
      }

      // 6. Style filter
      if (selectedStyle !== "all") {
        const normSelected = normalizeStyle(selectedStyle);
        let matches = false;
        if (Array.isArray(voice.styles) && voice.styles.length > 0) {
          matches = voice.styles.some((s) => normalizeStyle(s) === normSelected);
        } else {
          matches = normalizeStyle(voice.style || voice.category) === normSelected;
        }
        if (!matches && Array.isArray(voice.tags)) {
          matches = voice.tags.some((t) => normalizeStyle(t) === normSelected);
        }
        if (!matches) return false;
      }

      // 7. Gender filter
      if (selectedGender !== "all") {
        let voiceGender = voice.gender;
        if (!voiceGender && Array.isArray(voice.tags)) {
          if (voice.tags.some((t) => ["nữ", "female", "女性", "女声"].includes(t.toLowerCase().trim()))) {
            voiceGender = "female";
          } else if (voice.tags.some((t) => ["nam", "male", "男性", "男声"].includes(t.toLowerCase().trim()))) {
            voiceGender = "male";
          }
        }
        if (voiceGender !== selectedGender) return false;
      }

      // 8. Age filter
      if (selectedAge !== "all") {
        const normSelected = normalizeAge(selectedAge);
        let matches = normalizeAge(voice.ageGroup) === normSelected;
        if (!matches && Array.isArray(voice.tags)) {
          matches = voice.tags.some((t) => normalizeAge(t) === normSelected);
        }
        if (!matches) return false;
      }

      return true;
    });
  }, [
    voices,
    activeTab,
    searchQuery,
    selectedLanguage,
    selectedAccent,
    selectedSource,
    selectedStyle,
    selectedGender,
    selectedAge,
    lang,
  ]);

  // Sort the filtered voices
  const sortedVoices = useMemo(() => {
    const list = [...filteredVoices];
    switch (sortOption) {
      case "popular":
        return list.sort((a, b) => parseUsageCount(b.usageCount) - parseUsageCount(a.usageCount));
      case "newest":
        return list.sort((a, b) => {
          const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tB - tA;
        });
      case "name_asc":
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case "recent":
        return list.sort((a, b) => {
          const tA = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
          const tB = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
          return tB - tA;
        });
      default:
        return list;
    }
  }, [filteredVoices, sortOption]);

  // Unified Audio Preview: Handles play/stop, loading, failure isolation, and unconfigured state
  const handleTogglePlay = async (e: React.MouseEvent, voice: VoiceProfile) => {
    e.stopPropagation();

    if (playingVoiceId === voice.id) {
      providerRegistry.stopPreview();
      setPlayingVoiceId(null);
      setPreviewLoadingId(null);
      return;
    }

    providerRegistry.stopPreview();
    setPlayingVoiceId(null);
    setPreviewLoadingId(voice.id);

    try {
      const onEnded = () => {
        setPlayingVoiceId((prev) => (prev === voice.id ? null : prev));
      };

      const result = await providerRegistry.previewVoice(voice, onEnded);
      setPreviewLoadingId(null);

      if (
        result.unconfigured ||
        result.isNotConfigured ||
        result.error === "not_configured" ||
        result.errorCode === "AUTH_REQUIRED"
      ) {
        const msg =
          voice.provider === "openai"
            ? t.voiceModal.openAiNotConfigured
            : voice.provider === "google_translate"
            ? "Chưa cấu hình Google TTS"
            : t.voiceModal.notConfigured;
        showToast(msg);
        return;
      }

      if (!result.success) {
        const errorPrefix = result.errorCode ? `[${result.errorCode}] ` : "";
        const errorMsg = result.error ? `${errorPrefix}${result.error}` : t.voiceModal.previewError;
        showToast(errorMsg);
        return;
      }

      setPlayingVoiceId(voice.id);
    } catch (err: any) {
      setPreviewLoadingId(null);
      showToast(err?.message || t.voiceModal.previewError);
    }
  };

  // Cleanup audio preview when modal is closed
  useEffect(() => {
    if (!isOpen) {
      providerRegistry.stopPreview();
      setPlayingVoiceId(null);
      setPreviewLoadingId(null);
      setToastMessage(null);
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    }
  }, [isOpen]);

  const handleSelect = (voice: VoiceProfile) => {
    onSelectVoice(voice);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-modal-title"
        tabIndex={-1}
        className="bg-surface1 border border-borderDefault rounded-2xl w-full max-w-4xl h-[85vh] max-h-[760px] flex flex-col shadow-2xl overflow-hidden outline-none animate-scale-up relative"
      >
        {/* 1. Header with Tabs and Actions */}
        <div className="px-5 py-3 border-b border-borderDefault flex items-center justify-between flex-shrink-0 relative">
          {/* Left Title */}
          <h2 id="voice-modal-title" className="text-sm font-bold text-textPrimary tracking-tight">
            {t.voiceModal.title}
          </h2>

          {/* Center Tabs: Khám phá / Giọng của tôi / Yêu thích */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center bg-surface2 rounded-lg p-1 border border-borderDefault text-xs font-medium shadow-xs z-10">
            <button
              onClick={() => setActiveTab("system")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                activeTab === "system"
                  ? "bg-surface3 text-textPrimary font-semibold shadow-xs"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              <span>{t.voiceModal.tabSystem}</span>
            </button>

            <button
              onClick={() => setActiveTab("my_voices")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                activeTab === "my_voices"
                  ? "bg-surface3 text-textPrimary font-semibold shadow-xs"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              <User className="w-3.5 h-3.5 text-accent" />
              <span>{t.voiceModal.tabMyVoices}</span>
            </button>

            <button
              onClick={() => setActiveTab("favorites")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                activeTab === "favorites"
                  ? "bg-surface3 text-textPrimary font-semibold shadow-xs"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-400/30" />
              <span>{t.voiceModal.tabFavorites}</span>
            </button>
          </div>

          {/* Right: "Tạo giọng mới" button & Close X */}
          <div className="flex items-center gap-2.5 z-10">
            {onNavigateToClone && (
              <button
                onClick={() => {
                  onClose();
                  onNavigateToClone();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent/90 text-background rounded-lg text-xs font-semibold shadow-sm transition-colors"
                title={t.voiceModal.cloneNew}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.voiceModal.cloneNew}</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-surface2 text-textMuted hover:text-textPrimary rounded-lg transition-colors"
              title={`${t.voiceModal.close} (Esc)`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2. Main Search & Filter Bar */}
        <div
          ref={filterBarRef}
          className="px-5 py-3 border-b border-borderDefault bg-surface1/80 space-y-2.5 text-xs flex-shrink-0 relative"
        >
          {/* Top Line: Search bar & Sort Dropdown */}
          <div className="flex items-center justify-between gap-3">
            {/* Search Box with icon and clear button */}
            <div className="relative flex-1 max-w-xl">
              <Search className="w-3.5 h-3.5 text-textMuted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.voiceModal.searchPlaceholder}
                className="w-full bg-surface2 border border-borderDefault rounded-lg pl-8 pr-8 py-1.5 text-xs text-textPrimary placeholder:text-textMuted focus:border-accent focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-textMuted hover:text-textPrimary p-0.5"
                  title={t.voiceModal.clearAll}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Sort Dropdown */}
            <div className="relative w-[176px] flex-shrink-0">
              <button
                type="button"
                onClick={() => setOpenDropdown(openDropdown === "sort" ? null : "sort")}
                className={`w-full h-[32px] flex items-center justify-between px-3 rounded-lg border text-xs font-medium transition-all ${
                  openDropdown === "sort"
                    ? "bg-surface2 border-accent text-textPrimary shadow-2xs"
                    : "bg-surface2 hover:bg-surface3/80 border-borderDefault text-textSecondary hover:text-textPrimary"
                }`}
                aria-haspopup="listbox"
                aria-expanded={openDropdown === "sort"}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-textMuted text-xs whitespace-nowrap flex-shrink-0">
                    {t.voiceModal.sortLabel}:
                  </span>
                  <span className="font-semibold text-textPrimary text-xs whitespace-nowrap">
                    {currentSortLabel}
                  </span>
                </div>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-textMuted transition-transform duration-200 flex-shrink-0 ml-1.5 ${
                    openDropdown === "sort" ? "rotate-180 text-accent" : ""
                  }`}
                />
              </button>

              {/* Custom Sort Menu */}
              {openDropdown === "sort" && (
                <div
                  className="absolute top-full right-0 mt-1.5 w-full bg-surface1 border border-borderDefault rounded-xl shadow-xl p-1 z-50 space-y-0.5 text-xs animate-fade-in"
                  role="listbox"
                >
                  {(
                    [
                      { id: "popular", label: t.voiceModal.popular },
                      { id: "newest", label: t.voiceModal.newest },
                      { id: "name_asc", label: t.voiceModal.alphabetical },
                      { id: "recent", label: t.voiceModal.recent },
                    ] as const
                  ).map((option) => {
                    const isSelected = sortOption === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setSortOption(option.id);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                          isSelected
                            ? "bg-accent/15 text-accent font-semibold"
                            : "hover:bg-surface2 text-textPrimary"
                        }`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span>{option.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-accent" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Line: Dependent Filter Buttons & Active Chips */}
          <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              {/* 1. NGÔN NGỮ (LANGUAGE) FILTER */}
              <div className="relative">
                {selectedLanguage === "all" ? (
                  <button
                    onClick={() => setOpenDropdown(openDropdown === "lang" ? null : "lang")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                      openDropdown === "lang"
                        ? "bg-surface3 border-accent text-accent"
                        : "bg-surface2/70 hover:bg-surface2 border-borderDefault text-textSecondary hover:text-textPrimary"
                    }`}
                  >
                    <Plus className="w-3 h-3 text-textMuted" />
                    <span>{t.voiceModal.langLabel.replace(":", "").trim()}</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface3 border border-borderDefault text-xs font-medium text-textPrimary shadow-2xs">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectLanguage("all");
                      }}
                      className="text-textMuted hover:text-rose-400 p-0.5 rounded-full transition-colors"
                      title={t.voiceModal.removeFilter}
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setOpenDropdown(openDropdown === "lang" ? null : "lang")}
                      className="flex items-center gap-1 hover:text-accent transition-colors"
                    >
                      <span className="text-accent font-semibold">{getLanguageLabel(selectedLanguage, lang)}</span>
                    </button>
                  </div>
                )}

                {/* Language Dropdown Menu */}
                {openDropdown === "lang" && (
                  <div className="absolute top-full left-0 mt-1.5 w-64 bg-surface1 border border-borderDefault rounded-xl shadow-xl z-40 overflow-hidden text-xs animate-fade-in flex flex-col">
                    {/* Search Header */}
                    <div className="p-1.5 border-b border-borderDefault bg-surface2/60">
                      <div className="relative flex items-center">
                        <Search className="w-3.5 h-3.5 text-textMuted absolute left-2 pointer-events-none" />
                        <input
                          type="text"
                          value={langFilterSearch}
                          onChange={(e) => setLangFilterSearch(e.target.value)}
                          placeholder={lang === "vi" ? "Tìm ngôn ngữ..." : "Search language..."}
                          className="w-full bg-surface2 border border-borderDefault rounded-md pl-7 pr-6 py-1 text-xs text-textPrimary placeholder:text-textMuted focus:border-accent focus:outline-none"
                          autoFocus
                        />
                        {langFilterSearch && (
                          <button
                            type="button"
                            onClick={() => setLangFilterSearch("")}
                            className="absolute right-1.5 text-textMuted hover:text-textPrimary cursor-pointer p-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Language List */}
                    <div className="max-h-60 overflow-y-auto p-1 space-y-0.5">
                      {!langFilterSearch && (
                        <button
                          onClick={() => {
                            handleSelectLanguage("all");
                            setLangFilterSearch("");
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                            selectedLanguage === "all"
                              ? "bg-accent/15 text-accent font-semibold"
                              : "hover:bg-surface2 text-textPrimary"
                          }`}
                        >
                          <span>{t.voiceModal.allLanguages}</span>
                          {selectedLanguage === "all" && <Check className="w-3.5 h-3.5 text-accent" />}
                        </button>
                      )}
                      {filteredVoiceLanguages.map((l) => (
                        <button
                          key={l.code}
                          onClick={() => {
                            handleSelectLanguage(l.code);
                            setLangFilterSearch("");
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                            selectedLanguage === l.code
                              ? "bg-accent/15 text-accent font-semibold"
                              : "hover:bg-surface2 text-textPrimary"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate min-w-0 pr-1.5">
                            <span className="truncate">{getLanguageLabel(l.code, lang)}</span>
                            <span className="text-[10px] text-textMuted uppercase font-mono px-1 py-0.5 bg-surface2/80 rounded border border-borderDefault/50 shrink-0">
                              {l.code}
                            </span>
                          </div>
                          {selectedLanguage === l.code && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
                        </button>
                      ))}
                      {filteredVoiceLanguages.length === 0 && (
                        <div className="py-3 text-center text-textMuted text-xs">
                          {lang === "vi" ? "Không tìm thấy ngôn ngữ" : "No language found"}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. VÙNG / ACCENT FILTER (DEPENDENT ON LANGUAGE) */}
              <div className="relative">
                {isAccentDisabled ? (
                  /* VF-R-019 / VF-R-020 / LANG-R-012: Disabled state when Language = All or no accent filter supported */
                  <button
                    disabled
                    title={accentDisabledTooltip}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium bg-surface2/40 border-borderDefault/50 text-textMuted/60 cursor-not-allowed select-none"
                  >
                    <Plus className="w-3 h-3 text-textMuted/50" />
                    <span>{t.voiceModal.accentFilterLabel}</span>
                  </button>
                ) : selectedAccent === "all" ? (
                  <button
                    onClick={() => setOpenDropdown(openDropdown === "accent" ? null : "accent")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                      openDropdown === "accent"
                        ? "bg-surface3 border-accent text-accent"
                        : "bg-surface2/70 hover:bg-surface2 border-borderDefault text-textSecondary hover:text-textPrimary"
                    }`}
                  >
                    <Plus className="w-3 h-3 text-textMuted" />
                    <span>{t.voiceModal.accentFilterLabel}</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface3 border border-borderDefault text-xs font-medium text-textPrimary shadow-2xs">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAccent("all");
                      }}
                      className="text-textMuted hover:text-rose-400 p-0.5 rounded-full transition-colors"
                      title={t.voiceModal.removeFilter}
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setOpenDropdown(openDropdown === "accent" ? null : "accent")}
                      className="flex items-center gap-1 hover:text-accent transition-colors"
                    >
                      <span className="text-accent font-semibold">{getAccentLabel(selectedAccent, lang)}</span>
                    </button>
                  </div>
                )}

                {/* Accent Dropdown Menu */}
                {openDropdown === "accent" && !isAccentDisabled && (
                  <div className="absolute top-full left-0 mt-1.5 w-52 bg-surface1 border border-borderDefault rounded-xl shadow-xl p-1.5 z-40 space-y-0.5 text-xs animate-fade-in">
                    <button
                      onClick={() => {
                        setSelectedAccent("all");
                        setOpenDropdown(null);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                        selectedAccent === "all"
                          ? "bg-accent/15 text-accent font-semibold"
                          : "hover:bg-surface2 text-textPrimary"
                      }`}
                    >
                      <span>{t.voiceModal.allAccents}</span>
                      {selectedAccent === "all" && <Check className="w-3.5 h-3.5 text-accent" />}
                    </button>
                    {availableAccents.map((acc) => (
                      <button
                        key={acc.id}
                        onClick={() => {
                          setSelectedAccent(acc.id);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                          selectedAccent === acc.id
                            ? "bg-accent/15 text-accent font-semibold"
                            : "hover:bg-surface2 text-textPrimary"
                        }`}
                      >
                        <span>{getAccentLabel(acc.id, lang)}</span>
                        {selectedAccent === acc.id && <Check className="w-3.5 h-3.5 text-accent" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. NGUỒN (SOURCE) FILTER */}
              <div className="relative">
                {selectedSource === "all" ? (
                  <button
                    onClick={() => setOpenDropdown(openDropdown === "source" ? null : "source")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                      openDropdown === "source"
                        ? "bg-surface3 border-accent text-accent"
                        : "bg-surface2/70 hover:bg-surface2 border-borderDefault text-textSecondary hover:text-textPrimary"
                    }`}
                  >
                    <Plus className="w-3 h-3 text-textMuted" />
                    <span>{t.voiceModal.sourceFilterLabel}</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface3 border border-borderDefault text-xs font-medium text-textPrimary shadow-2xs">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSource("all");
                      }}
                      className="text-textMuted hover:text-rose-400 p-0.5 rounded-full transition-colors"
                      title={t.voiceModal.removeFilter}
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setOpenDropdown(openDropdown === "source" ? null : "source")}
                      className="flex items-center gap-1 hover:text-accent transition-colors"
                    >
                      <span className="text-accent font-semibold">{getSourceLabel(selectedSource, lang)}</span>
                    </button>
                  </div>
                )}

                {/* Source Dropdown Menu - Strictly 4 options: all, edge, google, local */}
                {openDropdown === "source" && (
                  <div className="absolute top-full left-0 mt-1.5 w-48 bg-surface1 border border-borderDefault rounded-xl shadow-xl p-1.5 z-40 space-y-0.5 text-xs animate-fade-in">
                    <button
                      onClick={() => {
                        setSelectedSource("all");
                        setOpenDropdown(null);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                        selectedSource === "all"
                          ? "bg-accent/15 text-accent font-semibold"
                          : "hover:bg-surface2 text-textPrimary"
                      }`}
                    >
                      <span>{t.voiceModal.allSources}</span>
                      {selectedSource === "all" && <Check className="w-3.5 h-3.5 text-accent" />}
                    </button>
                    {SOURCE_OPTIONS.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setSelectedSource(s.id);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                          selectedSource === s.id
                            ? "bg-accent/15 text-accent font-semibold"
                            : "hover:bg-surface2 text-textPrimary"
                        }`}
                      >
                        <span>{getSourceLabel(s.id, lang)}</span>
                        {selectedSource === s.id && <Check className="w-3.5 h-3.5 text-accent" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 4. PHONG CÁCH (STYLE) FILTER */}
              <div className="relative">
                {selectedStyle === "all" ? (
                  <button
                    onClick={() => setOpenDropdown(openDropdown === "style" ? null : "style")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                      openDropdown === "style"
                        ? "bg-surface3 border-accent text-accent"
                        : "bg-surface2/70 hover:bg-surface2 border-borderDefault text-textSecondary hover:text-textPrimary"
                    }`}
                  >
                    <Plus className="w-3 h-3 text-textMuted" />
                    <span>{t.voiceModal.styleFilterLabel}</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface3 border border-borderDefault text-xs font-medium text-textPrimary shadow-2xs">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedStyle("all");
                      }}
                      className="text-textMuted hover:text-rose-400 p-0.5 rounded-full transition-colors"
                      title={t.voiceModal.removeFilter}
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setOpenDropdown(openDropdown === "style" ? null : "style")}
                      className="flex items-center gap-1 hover:text-accent transition-colors"
                    >
                      <span className="text-accent font-semibold">{getStyleLabel(selectedStyle, lang)}</span>
                    </button>
                  </div>
                )}

                {/* Style Dropdown Menu - Compact without search */}
                {openDropdown === "style" && (
                  <div className="absolute top-full left-0 mt-1.5 w-48 bg-surface1 border border-borderDefault rounded-xl shadow-xl p-1.5 z-40 space-y-0.5 text-xs animate-fade-in">
                    <button
                      onClick={() => {
                        setSelectedStyle("all");
                        setOpenDropdown(null);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                        selectedStyle === "all"
                          ? "bg-accent/15 text-accent font-semibold"
                          : "hover:bg-surface2 text-textPrimary"
                      }`}
                    >
                      <span>{t.voiceModal.allStyles}</span>
                      {selectedStyle === "all" && <Check className="w-3.5 h-3.5 text-accent" />}
                    </button>
                    {STYLE_OPTIONS.map((st) => (
                      <button
                        key={st.id}
                        onClick={() => {
                          setSelectedStyle(st.id);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                          selectedStyle === st.id
                            ? "bg-accent/15 text-accent font-semibold"
                            : "hover:bg-surface2 text-textPrimary"
                        }`}
                      >
                        <span>{getStyleLabel(st.id, lang)}</span>
                        {selectedStyle === st.id && <Check className="w-3.5 h-3.5 text-accent" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 4. GIỚI TÍNH (GENDER) FILTER */}
              <div className="relative">
                {selectedGender === "all" ? (
                  <button
                    onClick={() => setOpenDropdown(openDropdown === "gender" ? null : "gender")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                      openDropdown === "gender"
                        ? "bg-surface3 border-accent text-accent"
                        : "bg-surface2/70 hover:bg-surface2 border-borderDefault text-textSecondary hover:text-textPrimary"
                    }`}
                  >
                    <Plus className="w-3 h-3 text-textMuted" />
                    <span>{t.voiceModal.genderLabel}</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface3 border border-borderDefault text-xs font-medium text-textPrimary shadow-2xs">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedGender("all");
                      }}
                      className="text-textMuted hover:text-rose-400 p-0.5 rounded-full transition-colors"
                      title={t.voiceModal.removeFilter}
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setOpenDropdown(openDropdown === "gender" ? null : "gender")}
                      className="flex items-center gap-1 hover:text-accent transition-colors"
                    >
                      <span className="text-accent font-semibold">{getGenderLabel(selectedGender, lang)}</span>
                    </button>
                  </div>
                )}

                {/* Gender Dropdown Menu */}
                {openDropdown === "gender" && (
                  <div className="absolute top-full left-0 mt-1.5 w-44 bg-surface1 border border-borderDefault rounded-xl shadow-xl p-1.5 z-40 space-y-0.5 text-xs animate-fade-in">
                    <button
                      onClick={() => {
                        setSelectedGender("all");
                        setOpenDropdown(null);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                        selectedGender === "all"
                          ? "bg-accent/15 text-accent font-semibold"
                          : "hover:bg-surface2 text-textPrimary"
                      }`}
                    >
                      <span>{t.voiceModal.allGenders}</span>
                      {selectedGender === "all" && <Check className="w-3.5 h-3.5 text-accent" />}
                    </button>
                    {availableGenders.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => {
                          setSelectedGender(g.id);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                          selectedGender === g.id
                            ? "bg-accent/15 text-accent font-semibold"
                            : "hover:bg-surface2 text-textPrimary"
                        }`}
                      >
                        <span>{getGenderLabel(g.id, lang)}</span>
                        {selectedGender === g.id && <Check className="w-3.5 h-3.5 text-accent" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 5. TUỔI (AGE) FILTER */}
              <div className="relative">
                {selectedAge === "all" ? (
                  <button
                    onClick={() => setOpenDropdown(openDropdown === "age" ? null : "age")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                      openDropdown === "age"
                        ? "bg-surface3 border-accent text-accent"
                        : "bg-surface2/70 hover:bg-surface2 border-borderDefault text-textSecondary hover:text-textPrimary"
                    }`}
                  >
                    <Plus className="w-3 h-3 text-textMuted" />
                    <span>{t.voiceModal.ageFilterLabel}</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface3 border border-borderDefault text-xs font-medium text-textPrimary shadow-2xs">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAge("all");
                      }}
                      className="text-textMuted hover:text-rose-400 p-0.5 rounded-full transition-colors"
                      title={t.voiceModal.removeFilter}
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setOpenDropdown(openDropdown === "age" ? null : "age")}
                      className="flex items-center gap-1 hover:text-accent transition-colors"
                    >
                      <span className="text-accent font-semibold">{getAgeLabel(selectedAge, lang)}</span>
                    </button>
                  </div>
                )}

                {/* Age Dropdown Menu */}
                {openDropdown === "age" && (
                  <div className="absolute top-full left-0 mt-1.5 w-44 bg-surface1 border border-borderDefault rounded-xl shadow-xl p-1.5 z-40 space-y-0.5 text-xs animate-fade-in">
                    <button
                      onClick={() => {
                        setSelectedAge("all");
                        setOpenDropdown(null);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                        selectedAge === "all"
                          ? "bg-accent/15 text-accent font-semibold"
                          : "hover:bg-surface2 text-textPrimary"
                      }`}
                    >
                      <span>{t.voiceModal.allAges}</span>
                      {selectedAge === "all" && <Check className="w-3.5 h-3.5 text-accent" />}
                    </button>
                    {availableAges.map((age) => (
                      <button
                        key={age.id}
                        onClick={() => {
                          setSelectedAge(age.id);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                          selectedAge === age.id
                            ? "bg-accent/15 text-accent font-semibold"
                            : "hover:bg-surface2 text-textPrimary"
                        }`}
                      >
                        <span>{getAgeLabel(age.id, lang)}</span>
                        {selectedAge === age.id && <Check className="w-3.5 h-3.5 text-accent" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Clear all filters if any active */}
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="text-xs text-textMuted hover:text-rose-400 font-medium transition-colors flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface2 hover:bg-surface3 border border-borderDefault"
                title={t.voiceModal.clearAllFilters}
              >
                <X className="w-3 h-3" />
                <span>{t.voiceModal.clearAllFilters}</span>
              </button>
            )}
          </div>
        </div>

        {/* 3. Voice Cards Grid (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-5">
          {sortedVoices.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {sortedVoices.map((voice) => {
                const isSelected = voice.id === activeVoiceId;
                const isPlaying = playingVoiceId === voice.id;

                const langInfo = getVoiceLanguageInfo(voice, lang);
                const secondaryTags = getVoiceSecondaryTags(voice, lang);
                const { visibleTags, hiddenTags } = computeVisibleTags(secondaryTags);

                return (
                  <div
                    key={voice.id}
                    onClick={() => handleSelect(voice)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelect(voice);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${voice.name}, ${langInfo.countryName || langInfo.name}, ${secondaryTags.join(", ")}`}
                    className={`relative p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between group outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface1 ${
                      isSelected
                        ? "bg-accent/10 border-accent shadow-sm ring-1 ring-accent"
                        : "bg-surface2/60 hover:bg-surface2 border-borderDefault hover:border-accent/60"
                    }`}
                  >
                    {/* Top Row: Avatar + Info Column */}
                    <div className="flex items-start gap-3">
                      {/* Avatar without Play Button Overlay */}
                      <div
                        className={`w-11 h-11 rounded-full bg-gradient-to-tr ${
                          voice.avatarColor || "from-blue-500 to-indigo-600"
                        } flex items-center justify-center text-white font-bold text-sm shadow-xs flex-shrink-0`}
                      >
                        {voice.name.charAt(0)}
                      </div>

                      {/* Info Column: Name Row, Country Row, Tag Row */}
                      <div className="flex-1 min-w-0">
                        {/* Row 1: Voice Name (Left) + Favorite Heart (Right) */}
                        <div className="flex items-center justify-between gap-1">
                          <h3 className="font-semibold text-xs text-textPrimary truncate" title={voice.name}>
                            {voice.name}
                          </h3>
                          {onToggleFavorite && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleFavorite(voice.id);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.stopPropagation();
                                }
                              }}
                              className="text-textMuted hover:text-rose-400 p-0.5 transition-colors flex-shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              title={t.voiceModal.tabFavorites}
                            >
                              <Heart
                                className={`w-3.5 h-3.5 ${
                                  voice.isFavorite
                                    ? "text-rose-400 fill-rose-400"
                                    : "text-textMuted"
                                }`}
                              />
                            </button>
                          )}
                        </div>

                        {/* Row 2: Country Row - Flag + Localized Country Name (Left), Provider Badge (Right) */}
                        <div className="flex items-center justify-between gap-1.5 mt-1.5 min-h-[18px]">
                          <div className="flex items-center gap-1.5 min-w-0 text-xs text-textSecondary font-medium">
                            <CountryFlag
                              countryCode={langInfo.countryCode || langInfo.code}
                              className="w-4 h-3 rounded-[2px] shadow-xs shrink-0 overflow-hidden inline-flex items-center justify-center align-middle"
                            />
                            <span className="truncate leading-none" title={langInfo.countryName || langInfo.name}>
                              {langInfo.countryName || langInfo.name}
                            </span>
                          </div>
                          <VoiceProviderBadge voice={voice} />
                        </div>

                        {/* Row 3: Tag Row - Strictly single line, max 3 chips total including +N */}
                        <div className="flex items-center gap-1.5 mt-2 flex-nowrap whitespace-nowrap">
                          {visibleTags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center h-5 px-1.5 py-0.5 rounded-md bg-surface3/70 text-textSecondary text-[10px] font-medium border border-borderDefault/50 truncate shrink-0"
                            >
                              {tag}
                            </span>
                          ))}
                          <HiddenTagsBadge hiddenTags={hiddenTags} lang={lang} />
                        </div>
                      </div>
                    </div>

                    {/* Bottom Row: Dedicated Preview Action & Selection state */}
                    <div className="mt-3 pt-2.5 border-t border-borderDefault/50 flex items-center justify-between text-xs h-9">
                      <div className="flex items-center">
                        <button
                          type="button"
                          onClick={(e) => handleTogglePlay(e, voice)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              handleTogglePlay(e as any, voice);
                            }
                          }}
                          disabled={previewLoadingId === voice.id}
                          className={`flex items-center justify-center gap-1.5 h-8 w-[98px] rounded-lg text-xs font-semibold whitespace-nowrap flex-shrink-0 select-none transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            isPlaying
                              ? "bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25"
                              : "bg-surface2 hover:bg-surface3 border border-borderDefault text-textPrimary hover:text-accent hover:border-accent/40"
                          }`}
                          title={isPlaying ? t.voiceModal.stopPreview : t.voiceModal.previewVoice}
                        >
                          {previewLoadingId === voice.id ? (
                            <>
                              <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
                              <span className="truncate">{t.voiceModal.previewLoading}</span>
                            </>
                          ) : isPlaying ? (
                            <>
                              <Pause className="w-3 h-3 fill-current flex-shrink-0" />
                              <span className="truncate">{t.voiceModal.stopPreview}</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-current flex-shrink-0" />
                              <span className="truncate">{t.voiceModal.previewVoice}</span>
                            </>
                          )}
                        </button>
                      </div>

                      {isSelected ? (
                        <span className="flex items-center gap-1 text-accent font-bold text-xs whitespace-nowrap">
                          <Check className="w-3.5 h-3.5" />
                          {t.voiceModal.currentlyUsed}
                        </span>
                      ) : (
                        <div className="w-1" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Empty State: Fully Localized with Reset and Clone CTAs */
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
              <div className="w-16 h-16 rounded-full border border-borderDefault bg-surface2/60 flex items-center justify-center text-textMuted mb-2">
                <AlertCircle className="w-8 h-8 text-textSecondary" />
              </div>
              <h3 className="text-sm font-bold text-textPrimary">
                {t.voiceModal.emptyTitle}
              </h3>
              <p className="text-xs text-textMuted max-w-sm">
                {t.voiceModal.emptyDesc}
              </p>
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={handleResetFilters}
                  className="px-4 py-2 bg-accent hover:bg-accent/90 text-background rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t.voiceModal.resetFiltersBtn}</span>
                </button>
                {onNavigateToClone && (
                  <button
                    onClick={() => {
                      onClose();
                      onNavigateToClone();
                    }}
                    className="px-4 py-2 bg-surface2 hover:bg-surface3 border border-borderDefault rounded-xl text-xs font-semibold text-textPrimary hover:text-accent transition-all shadow-xs flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5 text-accent" />
                    <span>{t.voiceModal.createVoiceCta}</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Floating Toast Notification for unconfigured providers or errors */}
        {toastMessage && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-fade-in">
            <div className="bg-surface1/95 backdrop-blur-md text-amber-400 text-xs font-semibold px-4 py-2 rounded-full border border-amber-500/30 shadow-xl flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <span>{toastMessage}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

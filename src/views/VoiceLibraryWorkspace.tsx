import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  AudioWaveform,
  Search,
  Play,
  Pause,
  ArrowRight,
  Trash2,
  Plus,
  X,
  Check,
  AlertCircle,
  MoreVertical,
  Sparkles,
} from "lucide-react";
import { VoiceProfile, VoiceSource } from "../types/ui";
import { useI18n } from "../i18n/context";
import {
  normalizeAccent,
  normalizeCategory,
  normalizeAge,
  normalizeStyle,
  getVoiceLanguageInfo,
  getVoiceSecondaryTags,
  computeVisibleTags,
  LANGUAGE_REGISTRY,
  ACCENTS_BY_LANGUAGE,
  STYLE_OPTIONS,
  GENDER_OPTIONS,
  AGE_OPTIONS,
  getLanguageLabel,
  getAccentLabel,
  getStyleLabel,
  getGenderLabel,
  getAgeLabel,
  getDeterministicAvatarColor,
} from "../constants/voiceFilters";
import { CountryFlag } from "../components/common/CountryFlag";
import { VoiceProviderBadge } from "../components/common/VoiceProviderBadge";
import { HiddenTagsBadge } from "../components/common/HiddenTagsBadge";
import { DeleteVoiceModal } from "../components/clone/DeleteVoiceModal";
import { EditVoiceModal } from "../components/clone/EditVoiceModal";

interface VoiceLibraryWorkspaceProps {
  voices: VoiceProfile[];
  onSelectForTts: (voice: VoiceProfile) => void;
  onDeleteVoice: (id: string) => void;
  onUpdateVoice?: (voice: VoiceProfile) => void;
  onNavigateToClone?: () => void;
  onPlayTrack?: (track: any) => void;
  activePlayingTrackId?: string | null;
  onStopPlaying?: () => void;
}

function normalizeVietnamese(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

export const VoiceLibraryWorkspace: React.FC<VoiceLibraryWorkspaceProps> = ({
  voices,
  onSelectForTts,
  onDeleteVoice,
  onUpdateVoice,
  onNavigateToClone,
  onPlayTrack,
  activePlayingTrackId,
  onStopPlaying,
}) => {
  const { t, lang } = useI18n();
  const filterBarRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState<"all" | VoiceSource>("all");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("all");
  const [selectedAccent, setSelectedAccent] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedGender, setSelectedGender] = useState<string>("all");
  const [selectedAge, setSelectedAge] = useState<string>("all");

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);
  const [voiceToDelete, setVoiceToDelete] = useState<VoiceProfile | null>(null);
  const [voiceToEdit, setVoiceToEdit] = useState<VoiceProfile | null>(null);
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

  // Synchronize playingVoiceId when activePlayingTrackId changes from global player
  useEffect(() => {
    if (activePlayingTrackId !== undefined) {
      setPlayingVoiceId(activePlayingTrackId);
    }
  }, [activePlayingTrackId]);

  const hasActiveFilters =
    selectedLanguage !== "all" ||
    selectedAccent !== "all" ||
    selectedCategory !== "all" ||
    selectedGender !== "all" ||
    selectedAge !== "all" ||
    searchQuery.trim() !== "";

  const handleResetFilters = () => {
    setSelectedLanguage("all");
    setSelectedAccent("all");
    setSelectedCategory("all");
    setSelectedGender("all");
    setSelectedAge("all");
    setSearchQuery("");
    setOpenDropdown(null);
  };

  // Click outside to close dropdowns and card menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
      setOpenCardMenuId(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter voices
  const filteredVoices = useMemo(() => {
    return voices.filter((v) => {
      // Search
      if (searchQuery.trim()) {
        const q = normalizeVietnamese(searchQuery);
        const rawQ = searchQuery.toLowerCase().trim();
        const nameMatches =
          normalizeVietnamese(v.name).includes(q) ||
          v.name.toLowerCase().includes(rawQ);
        const secTags = getVoiceSecondaryTags(v, lang);
        const tagsMatches =
          v.tags.some(
            (tg) =>
              normalizeVietnamese(tg).includes(q) ||
              tg.toLowerCase().includes(rawQ)
          ) ||
          secTags.some(
            (tg) =>
              normalizeVietnamese(tg).includes(q) ||
              tg.toLowerCase().includes(rawQ)
          );
        const normAcc = normalizeAccent(v.accent);
        const accentLabel = normAcc ? getAccentLabel(normAcc, lang) : "";
        const accentMatches =
          (v.accent
            ? normalizeVietnamese(v.accent).includes(q) ||
              v.accent.toLowerCase().includes(rawQ)
            : false) ||
          (accentLabel
            ? normalizeVietnamese(accentLabel).includes(q) ||
              accentLabel.toLowerCase().includes(rawQ)
            : false);
        const normSt = normalizeStyle(v.style || v.category);
        const styleLabel = normSt ? getStyleLabel(normSt, lang) : "";
        const styleMatches =
          (v.style
            ? normalizeVietnamese(v.style).includes(q) ||
              v.style.toLowerCase().includes(rawQ)
            : false) ||
          (styleLabel
            ? normalizeVietnamese(styleLabel).includes(q) ||
              styleLabel.toLowerCase().includes(rawQ)
            : false);
        if (!nameMatches && !tagsMatches && !accentMatches && !styleMatches) return false;
      }

      // Source
      if (selectedSource !== "all") {
        if (selectedSource === "local_clone") {
          const isClone = v.origin === "clone" || v.source === "local_clone" || v.sourceType === "clone";
          if (!isClone) return false;
        } else if (selectedSource === "preset_local") {
          const isPresetLocal =
            (v.origin === "system" || !v.origin) &&
            (v.source === "local" || v.source === "preset_local" || v.sourceType === "local") &&
            v.source !== "local_clone" &&
            v.sourceType !== "clone";
          if (!isPresetLocal) return false;
        } else if (selectedSource === "online") {
          const isOnline = v.source === "edge" || v.source === "google" || v.source === "online";
          if (!isOnline) return false;
        } else if (v.source !== selectedSource) {
          return false;
        }
      }

      // Language
      if (selectedLanguage !== "all" && !v.supportedLanguages.includes(selectedLanguage)) return false;

      // Accent
      if (selectedAccent !== "all") {
        const normSelected = normalizeAccent(selectedAccent);
        let matches = normalizeAccent(v.accent) === normSelected;
        if (!matches && Array.isArray(v.tags)) {
          matches = v.tags.some((t) => normalizeAccent(t) === normSelected);
        }
        if (!matches) return false;
      }

      // Category / Style (supports multi-style array)
      if (selectedCategory !== "all") {
        const normSelected = normalizeCategory(selectedCategory);
        let matches = false;
        if (Array.isArray(v.styles) && v.styles.length > 0) {
          matches = v.styles.some((s) => normalizeCategory(s) === normSelected);
        } else {
          matches = normalizeCategory(v.category || v.style) === normSelected;
        }
        if (!matches && Array.isArray(v.tags)) {
          matches = v.tags.some((t) => normalizeCategory(t) === normSelected);
        }
        if (!matches) return false;
      }

      // Gender
      if (selectedGender !== "all") {
        let voiceGender = v.gender;
        if (!voiceGender && Array.isArray(v.tags)) {
          if (v.tags.some((t) => ["nữ", "female", "女性", "女声"].includes(t.toLowerCase().trim()))) {
            voiceGender = "female";
          } else if (v.tags.some((t) => ["nam", "male", "男性", "男声"].includes(t.toLowerCase().trim()))) {
            voiceGender = "male";
          }
        }
        if (selectedGender === "neutral") {
          if (voiceGender) return false;
        } else if (voiceGender !== selectedGender) {
          return false;
        }
      }

      // Age
      if (selectedAge !== "all") {
        const normSelected = normalizeAge(selectedAge);
        let matches = normalizeAge(v.ageGroup) === normSelected;
        if (!matches && Array.isArray(v.tags)) {
          matches = v.tags.some((t) => normalizeAge(t) === normSelected);
        }
        if (!matches) return false;
      }

      return true;
    });
  }, [
    voices,
    searchQuery,
    selectedSource,
    selectedLanguage,
    selectedAccent,
    selectedCategory,
    selectedGender,
    selectedAge,
    lang,
  ]);

  const availableAccents = useMemo(() => {
    if (selectedLanguage !== "all" && ACCENTS_BY_LANGUAGE[selectedLanguage]) {
      return ACCENTS_BY_LANGUAGE[selectedLanguage];
    }
    const all = Object.values(ACCENTS_BY_LANGUAGE).flat();
    const seen = new Set<string>();
    return all.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }, [selectedLanguage]);

  const handlePlayVoice = (voice: VoiceProfile) => {
    const isPlayingThisVoice = activePlayingTrackId !== undefined ? activePlayingTrackId === voice.id : playingVoiceId === voice.id;
    if (isPlayingThisVoice) {
      if (onStopPlaying) {
        onStopPlaying();
      }
      setPlayingVoiceId(null);
    } else {
      const cleanVoiceName = voice.name.replace(/\s*\(Clone\)$/i, "");
      if (onPlayTrack) {
        onPlayTrack({
          id: voice.id,
          voiceName: cleanVoiceName,
          title: `Bản thử · ${cleanVoiceName}`,
          durationSec: 18.5,
          audioUrl: voice.sampleAudioPath,
          text: `Bản nghe thử giọng ${cleanVoiceName}`,
        });
      }
      setPlayingVoiceId(voice.id);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      {/* Subheader Toolbar */}
      <div className="p-4 border-b border-borderDefault bg-surface1 space-y-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent flex-shrink-0">
              <AudioWaveform className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-textPrimary">{t.library.title}</h2>
          </div>

          {/* Source Filters */}
          <div className="flex bg-surface2 rounded-md p-0.5 border border-borderDefault text-xs">
            <button
              onClick={() => setSelectedSource("all")}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                selectedSource === "all"
                  ? "bg-accent text-background font-semibold"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              {t.library.filterAll.replace("{count}", String(voices.length))}
            </button>
            <button
              onClick={() => setSelectedSource("local_clone")}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                selectedSource === "local_clone"
                  ? "bg-accent text-background font-semibold"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              {t.library.filterCloned.replace("{count}", String(voices.filter((v) => v.origin === "clone" || v.source === "local_clone" || v.sourceType === "clone").length))}
            </button>
            <button
              onClick={() => setSelectedSource("preset_local")}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                selectedSource === "preset_local"
                  ? "bg-accent text-background font-semibold"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              {t.library.filterPreset.replace("{count}", String(voices.filter((v) => (v.origin === "system" || !v.origin) && (v.source === "local" || v.source === "preset_local" || v.sourceType === "local") && v.source !== "local_clone" && v.sourceType !== "clone").length))}
            </button>
            <button
              onClick={() => setSelectedSource("online")}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                selectedSource === "online"
                  ? "bg-accent text-background font-semibold"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              {t.library.filterOnline.replace("{count}", String(voices.filter((v) => v.source === "edge" || v.source === "google" || v.source === "online").length))}
            </button>
          </div>
        </div>

        {/* Search & Video Filter Bar */}
        <div ref={filterBarRef} className="space-y-2 pt-1 relative">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 text-textMuted absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.library.searchPlaceholder || t.voiceModal.searchPlaceholder}
                className="w-full bg-surface2 border border-borderDefault rounded-lg pl-9 pr-3 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-textMuted hover:text-textPrimary p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Filter Buttons / Chips */}
            <div className="flex items-center gap-2 flex-wrap text-xs">
              {/* Ngôn ngữ */}
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
                    <span>{t.voiceModal.langLabel}</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface3 border border-borderDefault text-xs font-medium text-textPrimary shadow-2xs">
                    <button
                      onClick={() => setSelectedLanguage("all")}
                      className="text-textMuted hover:text-rose-400 p-0.5 rounded-full transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setOpenDropdown(openDropdown === "lang" ? null : "lang")}
                      className="flex items-center gap-1 hover:text-accent"
                    >
                      <span className="text-textSecondary">{t.voiceModal.langLabel}</span>
                      <span className="text-borderDefault">|</span>
                      <span className="text-accent font-semibold">{getLanguageLabel(selectedLanguage, lang)}</span>
                    </button>
                  </div>
                )}

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
                            setSelectedLanguage("all");
                            setOpenDropdown(null);
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
                            setSelectedLanguage(l.code);
                            setOpenDropdown(null);
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

              {/* Giọng */}
              <div className="relative">
                {selectedAccent === "all" ? (
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
                      onClick={() => setSelectedAccent("all")}
                      className="text-textMuted hover:text-rose-400 p-0.5 rounded-full transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setOpenDropdown(openDropdown === "accent" ? null : "accent")}
                      className="flex items-center gap-1 hover:text-accent"
                    >
                      <span className="text-textSecondary">{t.voiceModal.accentFilterLabel}</span>
                      <span className="text-borderDefault">|</span>
                      <span className="text-accent font-semibold">{getAccentLabel(selectedAccent, lang)}</span>
                    </button>
                  </div>
                )}

                {openDropdown === "accent" && (
                  <div className="absolute top-full left-0 mt-1.5 w-44 bg-surface1 border border-borderDefault rounded-xl shadow-xl p-1.5 z-40 animate-fade-in max-h-60 overflow-y-auto">
                    <button
                      onClick={() => {
                        setSelectedAccent("all");
                        setOpenDropdown(null);
                      }}
                      className="w-full text-left px-2.5 py-1 rounded-lg hover:bg-surface2 text-xs flex items-center justify-between"
                    >
                      <span>{t.voiceModal.allAccents}</span>
                      {selectedAccent === "all" && <Check className="w-3 h-3 text-accent" />}
                    </button>
                    {availableAccents.map((acc) => (
                      <button
                        key={acc.id}
                        onClick={() => {
                          setSelectedAccent(acc.id);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-2.5 py-1 rounded-lg text-xs flex items-center justify-between ${
                          selectedAccent === acc.id
                            ? "bg-accent/15 text-accent font-semibold"
                            : "hover:bg-surface2 text-textPrimary"
                        }`}
                      >
                        <span>{getAccentLabel(acc.id, lang)}</span>
                        {selectedAccent === acc.id && <Check className="w-3 h-3 text-accent" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Loại */}
              <div className="relative">
                {selectedCategory === "all" ? (
                  <button
                    onClick={() => setOpenDropdown(openDropdown === "category" ? null : "category")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                      openDropdown === "category"
                        ? "bg-surface3 border-accent text-accent"
                        : "bg-surface2/70 hover:bg-surface2 border-borderDefault text-textSecondary hover:text-textPrimary"
                    }`}
                  >
                    <Plus className="w-3 h-3 text-textMuted" />
                    <span>{t.voiceModal.categoryFilterLabel}</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface3 border border-borderDefault text-xs font-medium text-textPrimary shadow-2xs">
                    <button
                      onClick={() => setSelectedCategory("all")}
                      className="text-textMuted hover:text-rose-400 p-0.5 rounded-full transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setOpenDropdown(openDropdown === "category" ? null : "category")}
                      className="flex items-center gap-1 hover:text-accent"
                    >
                      <span className="text-textSecondary">{t.voiceModal.categoryFilterLabel}</span>
                      <span className="text-borderDefault">|</span>
                      <span className="text-accent font-semibold">{getStyleLabel(selectedCategory, lang)}</span>
                    </button>
                  </div>
                )}

                {openDropdown === "category" && (
                  <div className="absolute top-full left-0 mt-1.5 w-48 bg-surface1 border border-borderDefault rounded-xl shadow-xl p-1.5 z-40 animate-fade-in max-h-60 overflow-y-auto">
                    <button
                      onClick={() => {
                        setSelectedCategory("all");
                        setOpenDropdown(null);
                      }}
                      className="w-full text-left px-2.5 py-1 rounded-lg hover:bg-surface2 text-xs flex items-center justify-between"
                    >
                      <span>{t.voiceModal.allCategories}</span>
                      {selectedCategory === "all" && <Check className="w-3 h-3 text-accent" />}
                    </button>
                    {STYLE_OPTIONS.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => {
                          setSelectedCategory(cat.id);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-2.5 py-1 rounded-lg text-xs flex items-center justify-between ${
                          selectedCategory === cat.id
                            ? "bg-accent/15 text-accent font-semibold"
                            : "hover:bg-surface2 text-textPrimary"
                        }`}
                      >
                        <span>{getStyleLabel(cat.id, lang)}</span>
                        {selectedCategory === cat.id && <Check className="w-3 h-3 text-accent" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Giới tính */}
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
                    <span>{t.voiceModal.genderFilterLabel}</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface3 border border-borderDefault text-xs font-medium text-textPrimary shadow-2xs">
                    <button
                      onClick={() => setSelectedGender("all")}
                      className="text-textMuted hover:text-rose-400 p-0.5 rounded-full transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setOpenDropdown(openDropdown === "gender" ? null : "gender")}
                      className="flex items-center gap-1 hover:text-accent"
                    >
                      <span className="text-textSecondary">{t.voiceModal.genderFilterLabel}</span>
                      <span className="text-borderDefault">|</span>
                      <span className="text-accent font-semibold">{getGenderLabel(selectedGender, lang)}</span>
                    </button>
                  </div>
                )}

                {openDropdown === "gender" && (
                  <div className="absolute top-full left-0 mt-1.5 w-40 bg-surface1 border border-borderDefault rounded-xl shadow-xl p-1.5 z-40 animate-fade-in">
                    <button
                      onClick={() => {
                        setSelectedGender("all");
                        setOpenDropdown(null);
                      }}
                      className="w-full text-left px-2.5 py-1 rounded-lg hover:bg-surface2 text-xs flex items-center justify-between"
                    >
                      <span>{t.voiceModal.allGenders}</span>
                      {selectedGender === "all" && <Check className="w-3 h-3 text-accent" />}
                    </button>
                    {GENDER_OPTIONS.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => {
                          setSelectedGender(g.id);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-2.5 py-1 rounded-lg text-xs flex items-center justify-between ${
                          selectedGender === g.id
                            ? "bg-accent/15 text-accent font-semibold"
                            : "hover:bg-surface2 text-textPrimary"
                        }`}
                      >
                        <span>{getGenderLabel(g.id, lang)}</span>
                        {selectedGender === g.id && <Check className="w-3 h-3 text-accent" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Tuổi */}
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
                      onClick={() => setSelectedAge("all")}
                      className="text-textMuted hover:text-rose-400 p-0.5 rounded-full transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setOpenDropdown(openDropdown === "age" ? null : "age")}
                      className="flex items-center gap-1 hover:text-accent"
                    >
                      <span className="text-textSecondary">{t.voiceModal.ageFilterLabel}</span>
                      <span className="text-borderDefault">|</span>
                      <span className="text-accent font-semibold">{getAgeLabel(selectedAge, lang)}</span>
                    </button>
                  </div>
                )}

                {openDropdown === "age" && (
                  <div className="absolute top-full left-0 mt-1.5 w-40 bg-surface1 border border-borderDefault rounded-xl shadow-xl p-1.5 z-40 animate-fade-in">
                    <button
                      onClick={() => {
                        setSelectedAge("all");
                        setOpenDropdown(null);
                      }}
                      className="w-full text-left px-2.5 py-1 rounded-lg hover:bg-surface2 text-xs flex items-center justify-between"
                    >
                      <span>{t.voiceModal.allAges}</span>
                      {selectedAge === "all" && <Check className="w-3 h-3 text-accent" />}
                    </button>
                    {AGE_OPTIONS.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setSelectedAge(a.id);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-2.5 py-1 rounded-lg text-xs flex items-center justify-between ${
                          selectedAge === a.id
                            ? "bg-accent/15 text-accent font-semibold"
                            : "hover:bg-surface2 text-textPrimary"
                        }`}
                      >
                        <span>{getAgeLabel(a.id, lang)}</span>
                        {selectedAge === a.id && <Check className="w-3 h-3 text-accent" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Clear all filters if any active */}
              {hasActiveFilters && (
                <button
                  onClick={handleResetFilters}
                  className="text-xs text-textMuted hover:text-rose-400 font-medium transition-colors flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface2 hover:bg-surface3 border border-borderDefault ml-auto"
                  title={t.voiceModal.clearAllFilters || t.voiceModal.resetFilters}
                >
                  <X className="w-3 h-3" />
                  <span>{t.voiceModal.clearAllFilters || t.voiceModal.resetFilters}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Voice Cards Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredVoices.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
            {filteredVoices.map((voice) => {
              const isPlayingThisVoice = activePlayingTrackId !== undefined ? activePlayingTrackId === voice.id : playingVoiceId === voice.id;
              const cleanVoiceName = voice.name.replace(/\s*\(Clone\)$/i, "");
              const langInfo = getVoiceLanguageInfo(voice, lang);
              const secondaryTags = getVoiceSecondaryTags(voice, lang);
              const { visibleTags, hiddenTags } = computeVisibleTags(secondaryTags);

              return (
                <div
                  key={voice.id}
                  className={`rounded-xl p-4 transition-all flex flex-col justify-between group relative ${
                    isPlayingThisVoice
                      ? "bg-surface1 border-2 border-accent shadow-md shadow-accent/15 ring-1 ring-accent/30"
                      : "bg-surface1 border border-borderDefault hover:border-accent/50 shadow-2xs hover:shadow-xs"
                  }`}
                >
                  <div>
                    {/* Header: Avatar, Name, Language with Flag, Provider Badge, Preview button */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className={`w-10 h-10 rounded-full bg-gradient-to-tr ${
                            voice.avatarColor || getDeterministicAvatarColor(cleanVoiceName)
                          } flex items-center justify-center text-white font-bold text-sm shadow-xs flex-shrink-0 transition-transform ${
                            isPlayingThisVoice
                              ? "ring-2 ring-accent ring-offset-2 ring-offset-surface1 scale-105"
                              : ""
                          }`}
                        >
                          {cleanVoiceName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3
                            className="text-sm font-semibold text-textPrimary group-hover:text-accent transition-colors truncate"
                            title={cleanVoiceName}
                          >
                            {cleanVoiceName}
                          </h3>
                          {/* Row 2: Prioritized Language with Flag + Provider Badge */}
                          <div className="flex items-center gap-2 mt-1 text-xs text-textSecondary font-medium min-h-[18px]">
                            <div className="flex items-center gap-1.5 min-w-0 truncate">
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
                        </div>
                      </div>

                      {/* Play Preview */}
                      <button
                        onClick={() => handlePlayVoice(voice)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                          isPlayingThisVoice
                            ? "bg-rose-500 text-white shadow-md animate-pulse"
                            : "bg-surface2 hover:bg-accent hover:text-background text-textSecondary"
                        }`}
                        title={
                          isPlayingThisVoice
                            ? t.voiceModal?.stopPreview || (lang === "vi" ? "Dừng nghe" : "Stop preview")
                            : t.voiceModal?.previewVoice || (lang === "vi" ? "Nghe mẫu" : "Preview voice")
                        }
                        aria-label={isPlayingThisVoice ? "Stop preview" : "Preview voice"}
                      >
                        {isPlayingThisVoice ? (
                          <Pause className="w-3.5 h-3.5 fill-current" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        )}
                      </button>
                    </div>

                    {/* Single-line tags placed below */}
                    <div className="flex items-center gap-1.5 mb-4 min-h-[20px] flex-nowrap whitespace-nowrap">
                      {visibleTags.length > 0 ? (
                        visibleTags.map((tag, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center h-5 px-1.5 py-0.5 rounded-md bg-surface3/70 text-textSecondary text-[10px] font-medium border border-borderDefault/50 truncate shrink-0"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="inline-flex items-center h-5 px-1.5 py-0.5 rounded-md bg-surface2 text-textMuted text-[10px] font-medium border border-borderDefault/40 truncate shrink-0">
                          {voice.modelCompatibility?.[0] || voice.engine || (lang === "vi" ? "Tự nhiên" : "Natural")}
                        </span>
                      )}
                      <HiddenTagsBadge hiddenTags={hiddenTags} lang={lang} />
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="pt-3 border-t border-borderDefault flex items-center justify-between">
                    <button
                      onClick={() => onSelectForTts(voice)}
                      className="flex items-center gap-1.5 text-xs text-accent hover:underline font-semibold"
                    >
                      <span>{lang === "vi" ? "Dùng trong TTS" : (t.library.useVoice.replace(/→/g, "").trim() || "Use in TTS")}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    {/* 3-dots more options menu (Test, Edit, Delete) */}
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenCardMenuId(openCardMenuId === voice.id ? null : voice.id);
                        }}
                        className="p-1.5 rounded-lg text-textMuted hover:text-textPrimary hover:bg-surface2 transition-colors"
                        title={lang === "vi" ? "Tùy chọn khác" : "More options"}
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {openCardMenuId === voice.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 bottom-full mb-1 w-44 bg-surface1 border border-borderDefault rounded-xl shadow-xl p-1.5 z-40 animate-fade-in text-xs"
                        >
                          <button
                            onClick={() => {
                              setOpenCardMenuId(null);
                              handlePlayVoice(voice);
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-surface2 text-textPrimary flex items-center gap-2"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-accent" />
                            <span>{lang === "vi" ? "Thử giọng (Test)" : "Test voice"}</span>
                          </button>

                          <button
                            onClick={() => {
                              setOpenCardMenuId(null);
                              onSelectForTts(voice);
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-surface2 text-textPrimary flex items-center gap-2"
                          >
                            <ArrowRight className="w-3.5 h-3.5 text-textSecondary" />
                            <span>{lang === "vi" ? "Dùng trong TTS" : "Use in TTS"}</span>
                          </button>

                          {(voice.source === "local_clone" || voice.origin === "clone") && (
                            <>
                              {onUpdateVoice && (
                                <button
                                  onClick={() => {
                                    setOpenCardMenuId(null);
                                    setVoiceToEdit(voice);
                                  }}
                                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-surface2 text-textPrimary flex items-center gap-2"
                                >
                                  <svg className="w-3.5 h-3.5 text-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                  <span>{lang === "vi" ? "Chỉnh sửa" : "Edit"}</span>
                                </button>
                              )}
                              <div className="my-1 border-t border-borderDefault/50" />
                              <button
                                onClick={() => {
                                  setOpenCardMenuId(null);
                                  setVoiceToDelete(voice);
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 text-rose-500 flex items-center gap-2"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                <span>{lang === "vi" ? "Xóa giọng" : "Delete voice"}</span>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Empty state matching video */
          <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
            <div className="w-16 h-16 rounded-full border border-borderDefault bg-surface2/60 flex items-center justify-center text-textMuted mb-2">
              <AlertCircle className="w-8 h-8 text-textSecondary" />
            </div>
            <h3 className="text-sm font-bold text-textPrimary">
              {t.voiceModal.emptyTitleSearch}
            </h3>
            <p className="text-xs text-textMuted max-w-sm">
              {t.voiceModal.emptyDescSearch}
            </p>
            {onNavigateToClone && (
              <button
                onClick={onNavigateToClone}
                className="mt-3 px-4 py-2 bg-surface2 hover:bg-surface3 border border-borderDefault rounded-xl text-xs font-semibold text-textPrimary hover:text-accent transition-all shadow-xs flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5 text-accent" />
                <span>{t.voiceModal.createCloneNow}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <DeleteVoiceModal
        isOpen={Boolean(voiceToDelete)}
        onClose={() => setVoiceToDelete(null)}
        voice={voiceToDelete}
        onConfirmDelete={(id) => {
          onDeleteVoice(id);
          setVoiceToDelete(null);
        }}
      />

      {/* Edit Voice Modal */}
      {voiceToEdit && onUpdateVoice && (
        <EditVoiceModal
          isOpen={Boolean(voiceToEdit)}
          onClose={() => setVoiceToEdit(null)}
          voice={voiceToEdit}
          onSave={(updated) => {
            onUpdateVoice(updated);
            setVoiceToEdit(null);
          }}
        />
      )}
    </div>
  );
};

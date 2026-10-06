import React, { useState, useEffect, useRef, useMemo } from "react";
import { X, Save, Plus, Tag, FileAudio, CheckCircle2 } from "lucide-react";
import { VoiceProfile } from "../../types/ui";
import { useI18n } from "../../i18n/context";
import {
  ACCENTS_BY_LANGUAGE,
  GENDER_OPTIONS,
  STYLE_OPTIONS,
  AGE_OPTIONS,
  getGenderLabel,
  getAccentLabel,
  getStyleLabel,
  getAgeLabel,
  extractStructuredMetadataFromTags,
} from "../../constants/voiceFilters";
import { SearchableLanguageSelect } from "../common/SearchableLanguageSelect";
import { TRANSLATION_TARGET_LANGUAGES } from "../../services/subtitle/languages";

interface EditVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  voice: VoiceProfile | null;
  onSave: (updatedVoice: VoiceProfile) => void;
}

export const EditVoiceModal: React.FC<EditVoiceModalProps> = ({
  isOpen,
  onClose,
  voice,
  onSave,
}) => {
  const { lang } = useI18n();
  const [name, setName] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("vi");
  const [selectedGender, setSelectedGender] = useState<string>("");
  const [selectedAge, setSelectedAge] = useState<string>("");
  const [selectedAccent, setSelectedAccent] = useState<string>("");
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [unmappedCustomTags, setUnmappedCustomTags] = useState<string[]>([]);
  const [stylePopoverOpen, setStylePopoverOpen] = useState(false);
  const [transcript, setTranscript] = useState("");
  const stylePopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (voice && isOpen) {
      setName(voice.name || "");
      const lang = voice.supportedLanguages?.[0] || "vi";
      setSelectedLanguage(lang);

      // Extract existing structured or legacy metadata
      const extracted = extractStructuredMetadataFromTags(voice.tags || []);
      setSelectedGender(voice.gender || extracted.gender || "");
      setSelectedAccent(voice.accent || extracted.accent || "");
      setSelectedAge(voice.ageGroup || extracted.ageGroup || "");

      const styles =
        Array.isArray(voice.styles) && voice.styles.length > 0
          ? voice.styles
          : voice.style
          ? [voice.style]
          : extracted.styles.length > 0
          ? extracted.styles
          : [];
      setSelectedStyles(styles);
      setUnmappedCustomTags(extracted.unmappedTags);

      setTranscript((voice as any).referenceTranscript || "");
      setStylePopoverOpen(false);
    }
  }, [voice, isOpen]);

  // Dynamic accents linked to language
  const availableAccents = useMemo(() => {
    return ACCENTS_BY_LANGUAGE[selectedLanguage] || [];
  }, [selectedLanguage]);

  useEffect(() => {
    if (selectedAccent && availableAccents.length > 0 && !availableAccents.some((a) => a.id === selectedAccent)) {
      setSelectedAccent(availableAccents[0]?.id || "");
    }
  }, [availableAccents, selectedAccent]);

  // Click outside listener for style popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        stylePopoverRef.current &&
        !stylePopoverRef.current.contains(event.target as Node)
      ) {
        setStylePopoverOpen(false);
      }
    }
    if (stylePopoverOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [stylePopoverOpen]);

  if (!isOpen || !voice) return null;

  const handleToggleStyle = (styleId: string) => {
    setSelectedStyles((prev) =>
      prev.includes(styleId) ? prev.filter((s) => s !== styleId) : [...prev, styleId]
    );
  };

  const handleRemoveStyle = (styleId: string) => {
    setSelectedStyles((prev) => prev.filter((s) => s !== styleId));
  };

  const handleSave = () => {
    if (!name.trim()) return;

    const updated: VoiceProfile = {
      ...voice,
      name: name.trim(),
      supportedLanguages: [selectedLanguage],
      gender: (selectedGender === "male" || selectedGender === "female") ? selectedGender : undefined,
      accent: selectedAccent || undefined,
      styles: selectedStyles.length > 0 ? selectedStyles : ["natural"],
      style: selectedStyles[0] || "natural",
      category: selectedStyles[0] || "natural",
      ageGroup: selectedAge || undefined,
      tags: unmappedCustomTags,
      ...((voice as any).referenceTranscript !== undefined || transcript
        ? { referenceTranscript: transcript.trim() }
        : {}),
    };

    onSave(updated);
    onClose();
  };

  const notSpecifiedLabel = lang === "vi" ? "Chưa chọn" : "Not specified";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-surface1 border border-borderDefault rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-borderDefault flex items-center justify-between bg-surface2/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
              <Tag className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-textPrimary">
                {lang === "vi" ? "Chỉnh sửa thông tin giọng" : "Edit Voice Information"}
              </h3>
              <p className="text-[11px] text-textMuted">
                {lang === "vi" ? "Cập nhật tên, phân loại metadata và văn bản tham chiếu" : "Update name, metadata taxonomy, and reference transcript"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-textMuted hover:text-textPrimary hover:bg-surface3 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          {/* Voice Name */}
          <div className="space-y-1.5">
            <label className="block text-textSecondary font-medium">
              {lang === "vi" ? "Tên hiển thị" : "Display Name"}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs text-textPrimary focus:border-accent focus:outline-none"
              placeholder={lang === "vi" ? "Nhập tên giọng..." : "Enter voice name..."}
            />
          </div>

          {/* Model & Language */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-textSecondary font-medium">
                {lang === "vi" ? "Mô hình nhân bản" : "Clone Model"}
              </label>
              <input
                type="text"
                disabled
                value={voice.modelCompatibility?.[0] || voice.engine || "OmniVoice"}
                className="w-full bg-surface2/60 border border-borderDefault/80 rounded-lg px-3 py-2 text-xs text-textMuted cursor-not-allowed"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-textSecondary font-medium">
                {lang === "vi" ? "Ngôn ngữ chính" : "Primary Language"}
              </label>
              <SearchableLanguageSelect
                value={selectedLanguage}
                onChange={(code) => setSelectedLanguage(code)}
                languages={TRANSLATION_TARGET_LANGUAGES}
                searchPlaceholder={lang === "vi" ? "Tìm ngôn ngữ chính..." : "Search primary language..."}
                size="md"
              />
            </div>
          </div>

          {/* Structured Voice Classification */}
          <div className="space-y-3 p-3.5 rounded-xl border border-borderDefault bg-surface2/30">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-textPrimary flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-accent" />
                <span>{lang === "vi" ? "Phân loại giọng" : "Voice Attributes"}</span>
              </span>
              <span className="text-[10px] text-textMuted">
                {lang === "vi" ? "Đồng bộ Thư viện giọng" : "Synced with Voice Library"}
              </span>
            </div>

            {/* Row 1: Gender & Age (2 columns) */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <label className="block text-[11px] text-textSecondary font-medium">
                  {lang === "vi" ? "Giới tính" : "Gender"}
                </label>
                <select
                  value={selectedGender}
                  onChange={(e) => setSelectedGender(e.target.value)}
                  className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none"
                >
                  <option value="">{notSpecifiedLabel}</option>
                  {GENDER_OPTIONS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {getGenderLabel(g.id, lang)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] text-textSecondary font-medium">
                  {lang === "vi" ? "Độ tuổi" : "Age Group"}
                </label>
                <select
                  value={selectedAge}
                  onChange={(e) => setSelectedAge(e.target.value)}
                  className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none"
                >
                  <option value="">{notSpecifiedLabel}</option>
                  {AGE_OPTIONS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {getAgeLabel(a.id, lang)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: Vùng / Accent */}
            <div className="space-y-1.5">
              <label className="block text-[11px] text-textSecondary font-medium">
                {lang === "vi" ? "Vùng / Accent" : "Accent / Region"}
              </label>
              <select
                value={selectedAccent}
                onChange={(e) => setSelectedAccent(e.target.value)}
                disabled={availableAccents.length === 0}
                className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">{notSpecifiedLabel}</option>
                {availableAccents.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {getAccentLabel(acc.id, lang)}
                  </option>
                ))}
              </select>
            </div>

            {/* Row 3: Styles Multi-Select */}
            <div className="space-y-1.5">
              <label className="block text-[11px] text-textSecondary font-medium">
                {lang === "vi" ? "Phong cách" : "Styles"}
              </label>

              <div className="p-2 bg-surface2/60 rounded-lg border border-borderDefault min-h-[38px] flex flex-wrap items-center gap-1.5 relative">
                {selectedStyles.map((styleId) => (
                  <span
                    key={styleId}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface3 border border-borderDefault text-textPrimary text-[11px] font-medium animate-fade-in"
                  >
                    <span>{getStyleLabel(styleId, lang)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveStyle(styleId)}
                      className="text-textMuted hover:text-rose-400 transition-colors"
                      title="Xóa phong cách"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}

                {/* Popover trigger button */}
                <div className="relative inline-block" ref={stylePopoverRef}>
                  <button
                    type="button"
                    onClick={() => setStylePopoverOpen(!stylePopoverOpen)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-dashed border-borderDefault hover:border-accent/80 text-textMuted hover:text-accent text-[11px] transition-colors bg-surface2/80"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{lang === "vi" ? "Chọn phong cách" : "Add style"}</span>
                  </button>

                  {/* Popover dropdown checklist */}
                  {stylePopoverOpen && (
                    <div className="absolute left-0 top-full mt-1.5 w-64 max-h-52 overflow-y-auto bg-surface1 border border-borderDefault rounded-xl shadow-xl p-2 z-50 animate-fade-in space-y-1">
                      <div className="px-2 py-1 text-[11px] font-bold text-textMuted uppercase tracking-wider border-b border-borderDefault/60 flex items-center justify-between">
                        <span>{lang === "vi" ? "Danh sách phong cách" : "Style List"}</span>
                        <button
                          type="button"
                          onClick={() => setStylePopoverOpen(false)}
                          className="text-textMuted hover:text-textPrimary"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="pt-1 space-y-0.5">
                        {STYLE_OPTIONS.map((st) => {
                          const isSelected = selectedStyles.includes(st.id);
                          return (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => handleToggleStyle(st.id)}
                              className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center justify-between text-xs transition-colors ${
                                isSelected
                                  ? "bg-accent/15 text-accent font-medium"
                                  : "hover:bg-surface2 text-textPrimary"
                              }`}
                            >
                              <span>{getStyleLabel(st.id, lang)}</span>
                              {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-accent" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Reference Transcript Text */}
          <div className="space-y-1.5">
            <label className="block text-textSecondary font-medium">Văn bản tham chiếu (Reference Transcript)</label>
            <textarea
              rows={3}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              className="w-full bg-surface2 border border-borderDefault rounded-lg p-3 text-xs text-textPrimary focus:border-accent focus:outline-none resize-none leading-relaxed cursor-text caret-accent"
              placeholder="Nội dung người nói trong file âm thanh tham chiếu (nếu có)..."
            />
            <p className="text-[11px] text-textMuted">
              Cung cấp văn bản chính xác của audio mẫu giúp các mô hình prompt-based (như Qwen) nhận diện phát âm chuẩn hơn.
            </p>
          </div>

          {/* Reference Audio Info */}
          {voice.sampleAudioPath && (
            <div className="p-3 bg-surface2/40 rounded-lg border border-borderDefault flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileAudio className="w-4 h-4 text-accent" />
                <span className="font-mono text-[11px] text-textSecondary truncate max-w-[280px]">
                  {voice.sampleAudioPath}
                </span>
              </div>
              <span className="text-[10px] text-emerald-400 font-semibold px-2 py-0.5 rounded bg-emerald-950/40 border border-emerald-800/40">
                Đã lưu
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-borderDefault flex items-center justify-end gap-2.5 bg-surface2/40">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-surface2 hover:bg-surface3 border border-borderDefault text-textSecondary hover:text-textPrimary rounded-lg text-xs font-medium transition-colors"
          >
            Hủy
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 px-5 py-2 bg-accent hover:bg-accent/90 text-background rounded-lg text-xs font-bold shadow-xs transition-colors disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Lưu thay đổi</span>
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { createContext, useContext, useState, useEffect } from "react";
import { SupportedLang, Translations, translations } from "./translations";

export interface LanguageOption {
  code: SupportedLang;
  label: string;
  shortCode: string;
  flag: string;
}

export const LANGUAGE_LABELS: Record<SupportedLang, Record<SupportedLang, string>> = {
  vi: {
    vi: "Tiếng Việt",
    en: "Tiếng Anh",
    zh: "Tiếng Trung",
    ja: "Tiếng Nhật",
  },
  en: {
    vi: "Vietnamese",
    en: "English",
    zh: "Chinese",
    ja: "Japanese",
  },
  zh: {
    vi: "越南语",
    en: "英语",
    zh: "中文",
    ja: "日语",
  },
  ja: {
    vi: "ベトナム語",
    en: "英語",
    zh: "中国語",
    ja: "日本語",
  },
};

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "vi", label: "Tiếng Việt", shortCode: "VN", flag: "🇻🇳" },
  { code: "en", label: "Tiếng Anh", shortCode: "EN", flag: "🇺🇸" },
  { code: "zh", label: "Tiếng Trung", shortCode: "ZH", flag: "🇨🇳" },
  { code: "ja", label: "Tiếng Nhật", shortCode: "JA", flag: "🇯🇵" },
];

interface I18nContextType {
  lang: SupportedLang;
  setLang: (lang: SupportedLang) => void;
  t: Translations;
  languages: LanguageOption[];
}

const I18nContext = createContext<I18nContextType | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<SupportedLang>(() => {
    try {
      const saved = localStorage.getItem("voxlab_lang") as SupportedLang | null;
      if (saved && (saved === "vi" || saved === "en" || saved === "ja" || saved === "zh")) {
        return saved;
      }
      localStorage.setItem("voxlab_lang", "vi");
    } catch {
      // ignore
    }
    return "vi";
  });

  const setLang = (newLang: SupportedLang) => {
    const validLang =
      newLang === "vi" || newLang === "en" || newLang === "ja" || newLang === "zh"
        ? newLang
        : "vi";
    setLangState(validLang);
    try {
      localStorage.setItem("voxlab_lang", validLang);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = translations[lang] || translations.vi;

  const localizedLanguages = SUPPORTED_LANGUAGES.map((item) => ({
    ...item,
    label: LANGUAGE_LABELS[lang]?.[item.code] || item.label,
  }));

  return (
    <I18nContext.Provider value={{ lang, setLang, t, languages: localizedLanguages }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
};

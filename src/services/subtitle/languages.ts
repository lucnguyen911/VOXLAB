/**
 * Centralized Language Registry for Whisper ASR, Subtitle Translation, and Voice Clone.
 * Provides normalized language definitions, search matching, and standard mappings.
 */

export interface LanguageItem {
  code: string;
  name: string; // Vietnamese display name
  nativeName?: string; // Native language name
  englishName?: string; // English name
  isPopular?: boolean;
}

/**
 * Complete, standardized list of world languages supported by Whisper, Google Translate,
 * DeepL, and modern LLM translation models.
 */
export const ALL_STANDARD_LANGUAGES: LanguageItem[] = [
  // ==========================================
  // PHỔ BIẾN HÀNG ĐẦU (POPULAR LANGUAGES)
  // ==========================================
  { code: "vi", name: "Tiếng Việt", nativeName: "Tiếng Việt", englishName: "Vietnamese", isPopular: true },
  { code: "en", name: "Tiếng Anh", nativeName: "English", englishName: "English", isPopular: true },
  { code: "zh", name: "Tiếng Trung Giản thể", nativeName: "简体中文", englishName: "Chinese Simplified", isPopular: true },
  { code: "zh-TW", name: "Tiếng Trung Phồn thể", nativeName: "繁體中文", englishName: "Chinese Traditional", isPopular: true },
  { code: "ja", name: "Tiếng Nhật", nativeName: "日本語", englishName: "Japanese", isPopular: true },
  { code: "ko", name: "Tiếng Hàn", nativeName: "한국어", englishName: "Korean", isPopular: true },
  { code: "fr", name: "Tiếng Pháp", nativeName: "Français", englishName: "French", isPopular: true },
  { code: "de", name: "Tiếng Đức", nativeName: "Deutsch", englishName: "German", isPopular: true },
  { code: "es", name: "Tiếng Tây Ban Nha", nativeName: "Español", englishName: "Spanish", isPopular: true },
  { code: "ru", name: "Tiếng Nga", nativeName: "Русский", englishName: "Russian", isPopular: true },
  { code: "pt", name: "Tiếng Bồ Đào Nha", nativeName: "Português", englishName: "Portuguese", isPopular: true },
  { code: "it", name: "Tiếng Ý", nativeName: "Italiano", englishName: "Italian", isPopular: true },
  { code: "th", name: "Tiếng Thái", nativeName: "ไทย", englishName: "Thai", isPopular: true },
  { code: "id", name: "Tiếng Indonesia", nativeName: "Bahasa Indonesia", englishName: "Indonesian", isPopular: true },
  { code: "ar", name: "Tiếng Ả Rập", nativeName: "العربية", englishName: "Arabic", isPopular: true },
  { code: "hi", name: "Tiếng Hindi", nativeName: "हिन्दी", englishName: "Hindi", isPopular: true },

  // ==========================================
  // DANH SÁCH ĐẦY ĐỦ THEO CHỮ CÁI TIẾNG VIỆT (A - Z)
  // ==========================================
  { code: "af", name: "Tiếng Afrikaans", nativeName: "Afrikaans", englishName: "Afrikaans" },
  { code: "sq", name: "Tiếng Albania", nativeName: "Shqip", englishName: "Albanian" },
  { code: "am", name: "Tiếng Amharic", nativeName: "አማርኛ", englishName: "Amharic" },
  { code: "hy", name: "Tiếng Armenia", nativeName: "Հայերեն", englishName: "Armenian" },
  { code: "as", name: "Tiếng Assamese", nativeName: "অসমীয়া", englishName: "Assamese" },
  { code: "az", name: "Tiếng Azerbaijan", nativeName: "Azərbaycan", englishName: "Azerbaijani" },
  { code: "pl", name: "Tiếng Ba Lan", nativeName: "Polski", englishName: "Polish" },
  { code: "fa", name: "Tiếng Ba Tư (Farsi)", nativeName: "فارسی", englishName: "Persian" },
  { code: "ba", name: "Tiếng Bashkir", nativeName: "Башҡортса", englishName: "Bashkir" },
  { code: "eu", name: "Tiếng Basque", nativeName: "Euskara", englishName: "Basque" },
  { code: "be", name: "Tiếng Belarus", nativeName: "Беларуская", englishName: "Belarusian" },
  { code: "bn", name: "Tiếng Bengali", nativeName: "বাংলা", englishName: "Bengali" },
  { code: "bs", name: "Tiếng Bosnia", nativeName: "Bosanski", englishName: "Bosnian" },
  { code: "pt-BR", name: "Tiếng Bồ Đào Nha (Brazil)", nativeName: "Português do Brasil", englishName: "Portuguese (Brazil)" },
  { code: "br", name: "Tiếng Breton", nativeName: "Brezhoneg", englishName: "Breton" },
  { code: "bg", name: "Tiếng Bulgaria", nativeName: "Български", englishName: "Bulgarian" },
  { code: "ca", name: "Tiếng Catalan", nativeName: "Català", englishName: "Catalan" },
  { code: "hr", name: "Tiếng Croatia", nativeName: "Hrvatski", englishName: "Croatian" },
  { code: "da", name: "Tiếng Đan Mạch", nativeName: "Dansk", englishName: "Danish" },
  { code: "he", name: "Tiếng Do Thái (Hebrew)", nativeName: "עברית", englishName: "Hebrew" },
  { code: "eo", name: "Tiếng Esperanto", nativeName: "Esperanto", englishName: "Esperanto" },
  { code: "et", name: "Tiếng Estonia", nativeName: "Eesti", englishName: "Estonian" },
  { code: "fo", name: "Tiếng Faroe", nativeName: "Føroyskt", englishName: "Faroese" },
  { code: "tl", name: "Tiếng Filipino (Tagalog)", nativeName: "Tagalog", englishName: "Filipino" },
  { code: "gl", name: "Tiếng Galicia", nativeName: "Galego", englishName: "Galician" },
  { code: "ka", name: "Tiếng Georgia", nativeName: "ქართული", englishName: "Georgian" },
  { code: "gu", name: "Tiếng Gujarati", nativeName: "ગુજરાતી", englishName: "Gujarati" },
  { code: "nl", name: "Tiếng Hà Lan", nativeName: "Nederlands", englishName: "Dutch" },
  { code: "ht", name: "Tiếng Creole Haiti", nativeName: "Kreyòl ayisyen", englishName: "Haitian Creole" },
  { code: "ha", name: "Tiếng Hausa", nativeName: "Harshen Hausa", englishName: "Hausa" },
  { code: "haw", name: "Tiếng Hawaii", nativeName: "ʻŌlelo Hawaiʻi", englishName: "Hawaiian" },
  { code: "hu", name: "Tiếng Hungary", nativeName: "Magyar", englishName: "Hungarian" },
  { code: "el", name: "Tiếng Hy Lạp", nativeName: "Ελληνικά", englishName: "Greek" },
  { code: "is", name: "Tiếng Iceland", nativeName: "Íslenska", englishName: "Icelandic" },
  { code: "ig", name: "Tiếng Igbo", nativeName: "Ásụ̀sụ́ Ìgbò", englishName: "Igbo" },
  { code: "ga", name: "Tiếng Ireland", nativeName: "Gaeilge", englishName: "Irish" },
  { code: "jw", name: "Tiếng Java", nativeName: "Basa Jawa", englishName: "Javanese" },
  { code: "kn", name: "Tiếng Kannada", nativeName: "ಕನ್ನಡ", englishName: "Kannada" },
  { code: "kk", name: "Tiếng Kazakh", nativeName: "Қазақ", englishName: "Kazakh" },
  { code: "km", name: "Tiếng Khmer (Campuchia)", nativeName: "ភាសាខ្មែរ", englishName: "Khmer" },
  { code: "lo", name: "Tiếng Lào", nativeName: "ພາສາລາວ", englishName: "Lao" },
  { code: "la", name: "Tiếng Latin", nativeName: "Latina", englishName: "Latin" },
  { code: "lv", name: "Tiếng Latvia", nativeName: "Latviešu", englishName: "Latvian" },
  { code: "ln", name: "Tiếng Lingala", nativeName: "Lingála", englishName: "Lingala" },
  { code: "lt", name: "Tiếng Litva", nativeName: "Lietuvių", englishName: "Lithuanian" },
  { code: "lb", name: "Tiếng Luxembourg", nativeName: "Lëtzebuergesch", englishName: "Luxembourgish" },
  { code: "mk", name: "Tiếng Bắc Macedonia", nativeName: "Македонски", englishName: "Macedonian" },
  { code: "mg", name: "Tiếng Malagasy", nativeName: "Malagasy", englishName: "Malagasy" },
  { code: "ms", name: "Tiếng Mã Lai", nativeName: "Bahasa Melayu", englishName: "Malay" },
  { code: "ml", name: "Tiếng Malayalam", nativeName: "മലയാളം", englishName: "Malayalam" },
  { code: "mt", name: "Tiếng Malta", nativeName: "Malti", englishName: "Maltese" },
  { code: "mi", name: "Tiếng Maori", nativeName: "Māori", englishName: "Maori" },
  { code: "mr", name: "Tiếng Marathi", nativeName: "मराठी", englishName: "Marathi" },
  { code: "my", name: "Tiếng Myanmar (Miến Điện)", nativeName: "မြန်မာ", englishName: "Burmese" },
  { code: "mn", name: "Tiếng Mông Cổ", nativeName: "Монгол", englishName: "Mongolian" },
  { code: "no", name: "Tiếng Na Uy", nativeName: "Norsk", englishName: "Norwegian" },
  { code: "nn", name: "Tiếng Na Uy (Nynorsk)", nativeName: "Norsk nynorsk", englishName: "Norwegian Nynorsk" },
  { code: "ne", name: "Tiếng Nepal", nativeName: "नेपाली", englishName: "Nepali" },
  { code: "oc", name: "Tiếng Occitan", nativeName: "Occitan", englishName: "Occitan" },
  { code: "ps", name: "Tiếng Pashto", nativeName: "پښتو", englishName: "Pashto" },
  { code: "fi", name: "Tiếng Phần Lan", nativeName: "Suomi", englishName: "Finnish" },
  { code: "pa", name: "Tiếng Punjabi", nativeName: "ਪੰਜਾਬੀ", englishName: "Punjabi" },
  { code: "ro", name: "Tiếng Romania", nativeName: "Română", englishName: "Romanian" },
  { code: "sa", name: "Tiếng Phạn (Sanskrit)", nativeName: "संस्कृतम्", englishName: "Sanskrit" },
  { code: "cs", name: "Tiếng Séc", nativeName: "Čeština", englishName: "Czech" },
  { code: "sr", name: "Tiếng Serbia", nativeName: "Српски", englishName: "Serbian" },
  { code: "sn", name: "Tiếng Shona", nativeName: "chiShona", englishName: "Shona" },
  { code: "sd", name: "Tiếng Sindhi", nativeName: "سنڌي", englishName: "Sindhi" },
  { code: "si", name: "Tiếng Sinhala", nativeName: "සිංහල", englishName: "Sinhala" },
  { code: "sk", name: "Tiếng Slovak", nativeName: "Slovenčina", englishName: "Slovak" },
  { code: "sl", name: "Tiếng Slovenia", nativeName: "Slovenščina", englishName: "Slovenian" },
  { code: "so", name: "Tiếng Somali", nativeName: "Soomaaliga", englishName: "Somali" },
  { code: "su", name: "Tiếng Sunda", nativeName: "Basa Sunda", englishName: "Sundanese" },
  { code: "sw", name: "Tiếng Swahili", nativeName: "Kiswahili", englishName: "Swahili" },
  { code: "sv", name: "Tiếng Thụy Điển", nativeName: "Svenska", englishName: "Swedish" },
  { code: "tg", name: "Tiếng Tajik", nativeName: "Тоҷикӣ", englishName: "Tajik" },
  { code: "ta", name: "Tiếng Tamil", nativeName: "தமிழ்", englishName: "Tamil" },
  { code: "tt", name: "Tiếng Tatar", nativeName: "Татарча", englishName: "Tatar" },
  { code: "bo", name: "Tiếng Tây Tạng", nativeName: "བོད་སྐད་", englishName: "Tibetan" },
  { code: "te", name: "Tiếng Telugu", nativeName: "తెలుగు", englishName: "Telugu" },
  { code: "tr", name: "Tiếng Thổ Nhĩ Kỳ", nativeName: "Türkçe", englishName: "Turkish" },
  { code: "tk", name: "Tiếng Turkmen", nativeName: "Türkmençe", englishName: "Turkmen" },
  { code: "uk", name: "Tiếng Ukraina", nativeName: "Українська", englishName: "Ukrainian" },
  { code: "ur", name: "Tiếng Urdu", nativeName: "اردو", englishName: "Urdu" },
  { code: "uz", name: "Tiếng Uzbek", nativeName: "Oʻzbek", englishName: "Uzbek" },
  { code: "cy", name: "Tiếng Wales", nativeName: "Cymraeg", englishName: "Welsh" },
  { code: "xh", name: "Tiếng Xhosa", nativeName: "isiXhosa", englishName: "Xhosa" },
  { code: "yi", name: "Tiếng Yiddish", nativeName: "ייִדיש", englishName: "Yiddish" },
  { code: "yo", name: "Tiếng Yoruba", nativeName: "Èdè Yorùbá", englishName: "Yoruba" },
  { code: "zu", name: "Tiếng Zulu", nativeName: "isiZulu", englishName: "Zulu" },
];

/**
 * Audio recognition languages supported by Whisper models.
 * "auto" represents Automatic Language Detection.
 */
export const WHISPER_AUDIO_LANGUAGES: LanguageItem[] = [
  { code: "auto", name: "Tự Động Phát Hiện", englishName: "Auto Detect", isPopular: true },
  ...ALL_STANDARD_LANGUAGES,
];

/**
 * Target languages available for Subtitle Translation.
 */
export const TRANSLATION_TARGET_LANGUAGES: LanguageItem[] = [
  ...ALL_STANDARD_LANGUAGES,
];

/**
 * Source languages available for Subtitle Translation (includes 'auto' detect).
 */
export const TRANSLATION_SOURCE_LANGUAGES: LanguageItem[] = [
  { code: "auto", name: "Tự động phát hiện", englishName: "Auto Detect", isPopular: true },
  ...ALL_STANDARD_LANGUAGES,
];

function stripDiacritics(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * Map of custom translations for non-standard codes or preferred regional terms
 */
const SPECIAL_LANGUAGE_NAMES: Record<string, Record<string, string>> = {
  auto: {
    vi: "Tự động phát hiện",
    en: "Auto Detect",
    zh: "自动检测",
    ja: "自動検出",
  },
  zh: {
    vi: "Tiếng Trung Giản thể",
    en: "Simplified Chinese",
    zh: "简体中文",
    ja: "簡体中国語",
  },
  "zh-TW": {
    vi: "Tiếng Trung Phồn thể",
    en: "Traditional Chinese",
    zh: "繁体中文",
    ja: "繁体中国語",
  },
  "pt-BR": {
    vi: "Tiếng Bồ Đào Nha (Brazil)",
    en: "Portuguese (Brazil)",
    zh: "巴西葡萄牙语",
    ja: "ブラジルポルトガル語",
  },
};

/**
 * Returns the localized single-language display name according to the active UI language.
 */
export function getLocalizedLanguageName(
  itemOrCode: LanguageItem | string,
  uiLang: string = "vi"
): string {
  const code = typeof itemOrCode === "string" ? itemOrCode : itemOrCode.code;
  const targetUiLang = ["vi", "en", "zh", "ja"].includes(uiLang) ? uiLang : "vi";

  // Check special overrides first (auto, zh, zh-TW, pt-BR)
  const specialMatch = SPECIAL_LANGUAGE_NAMES[code] || SPECIAL_LANGUAGE_NAMES[code.toLowerCase()];
  if (specialMatch && specialMatch[targetUiLang]) {
    return specialMatch[targetUiLang];
  }

  // Use standard Intl.DisplayNames
  try {
    const dn = new Intl.DisplayNames([targetUiLang], { type: "language" });
    const localized = dn.of(code);
    if (localized) {
      return localized.charAt(0).toUpperCase() + localized.slice(1);
    }
  } catch {
    // ignore
  }

  // Fallback to item name / english name
  if (typeof itemOrCode !== "string") {
    if (targetUiLang === "en" && itemOrCode.englishName) {
      return itemOrCode.englishName;
    }
    return itemOrCode.name;
  }

  return code;
}

/**
 * Searches and filters languages by query string across name, code, english name, native name, and localized name.
 * Supports both exact and accent-insensitive matching (e.g. 'viet' matches 'Tiếng Việt').
 */
export function searchLanguages(
  query: string,
  list: LanguageItem[],
  uiLang: string = "vi"
): LanguageItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const qClean = stripDiacritics(q);

  return list.filter((item) => {
    const codeMatch = item.code.toLowerCase().includes(q);
    const localized = getLocalizedLanguageName(item, uiLang);
    const localizedMatch =
      localized.toLowerCase().includes(q) || stripDiacritics(localized).includes(qClean);
    const nameMatch =
      item.name.toLowerCase().includes(q) || stripDiacritics(item.name).includes(qClean);
    const nativeMatch = item.nativeName
      ? item.nativeName.toLowerCase().includes(q) ||
        stripDiacritics(item.nativeName).includes(qClean)
      : false;
    const englishMatch = item.englishName
      ? item.englishName.toLowerCase().includes(q) ||
        stripDiacritics(item.englishName).includes(qClean)
      : false;

    return codeMatch || localizedMatch || nameMatch || nativeMatch || englishMatch;
  });
}

/**
 * Finds a language by code or returns a fallback.
 */
export function findLanguage(code: string, list: LanguageItem[]): LanguageItem | undefined {
  return list.find((item) => item.code.toLowerCase() === code.toLowerCase());
}

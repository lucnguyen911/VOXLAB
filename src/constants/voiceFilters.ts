import { SupportedLang } from "../i18n/translations";
import { VoiceProfile } from "../types/ui";

export interface AccentDefinition {
  id: string; // e.g. "vi-north", "vi-central", "vi-south", "en-us", "en-uk", "en-au"
  languageCode: string;
  labels: Record<SupportedLang, string>;
}

export interface LanguageDefinition {
  code: string;
  labels: Record<SupportedLang, string>;
}

export interface OptionDefinition {
  id: string;
  labels: Record<SupportedLang, string>;
}

export const LANGUAGE_REGISTRY: LanguageDefinition[] = [
  { code: "vi", labels: { vi: "Tiếng Việt", en: "Vietnamese", ja: "ベトナム語", zh: "越南语" } },
  { code: "en", labels: { vi: "Tiếng Anh", en: "English", ja: "英語", zh: "英语" } },
  { code: "zh", labels: { vi: "Tiếng Trung", en: "Chinese", ja: "中国語", zh: "中文" } },
  { code: "ja", labels: { vi: "Tiếng Nhật", en: "Japanese", ja: "日本語", zh: "日语" } },
  { code: "ko", labels: { vi: "Tiếng Hàn", en: "Korean", ja: "韓国語", zh: "韩语" } },
  { code: "es", labels: { vi: "Tiếng Tây Ban Nha", en: "Spanish", ja: "スペイン語", zh: "西班牙语" } },
  { code: "fr", labels: { vi: "Tiếng Pháp", en: "French", ja: "フランス語", zh: "法语" } },
  { code: "de", labels: { vi: "Tiếng Đức", en: "German", ja: "ドイツ語", zh: "德语" } },
  { code: "pt", labels: { vi: "Tiếng Bồ Đào Nha", en: "Portuguese", ja: "ポルトガル語", zh: "葡萄牙语" } },
  { code: "ar", labels: { vi: "Tiếng Ả Rập", en: "Arabic", ja: "アラビア語", zh: "阿拉伯语" } },
  { code: "hi", labels: { vi: "Tiếng Hindi", en: "Hindi", ja: "ヒンディー語", zh: "印地语" } },
  { code: "it", labels: { vi: "Tiếng Ý", en: "Italian", ja: "イタリア語", zh: "意大利语" } },
  { code: "id", labels: { vi: "Tiếng Indonesia", en: "Indonesian", ja: "インドネシア語", zh: "印尼语" } },
  { code: "nl", labels: { vi: "Tiếng Hà Lan", en: "Dutch", ja: "オランダ語", zh: "荷兰语" } },
  { code: "tr", labels: { vi: "Tiếng Thổ Nhĩ Kỳ", en: "Turkish", ja: "トルコ語", zh: "土耳其语" } },
  { code: "fil", labels: { vi: "Tiếng Filipino", en: "Filipino", ja: "フィリピン語", zh: "菲律宾语" } },
  { code: "pl", labels: { vi: "Tiếng Ba Lan", en: "Polish", ja: "ポーランド語", zh: "波兰语" } },
  { code: "sv", labels: { vi: "Tiếng Thụy Điển", en: "Swedish", ja: "スウェーデン語", zh: "瑞典语" } },
  { code: "bg", labels: { vi: "Tiếng Bulgaria", en: "Bulgarian", ja: "ブルガリア語", zh: "保加利亚语" } },
  { code: "ro", labels: { vi: "Tiếng Romania", en: "Romanian", ja: "ルーマニア語", zh: "罗马尼亚语" } },
  { code: "cs", labels: { vi: "Tiếng Séc", en: "Czech", ja: "チェコ語", zh: "捷克语" } },
  { code: "el", labels: { vi: "Tiếng Hy Lạp", en: "Greek", ja: "ギリシャ語", zh: "希腊语" } },
  { code: "fi", labels: { vi: "Tiếng Phần Lan", en: "Finnish", ja: "フィンランド語", zh: "芬兰语" } },
  { code: "hr", labels: { vi: "Tiếng Croatia", en: "Croatian", ja: "クロアチア語", zh: "克罗地亚语" } },
  { code: "ms", labels: { vi: "Tiếng Mã Lai", en: "Malay", ja: "マレー語", zh: "马来语" } },
  { code: "sk", labels: { vi: "Tiếng Slovak", en: "Slovak", ja: "スロバキア語", zh: "斯洛伐克语" } },
  { code: "da", labels: { vi: "Tiếng Đan Mạch", en: "Danish", ja: "デンマーク語", zh: "丹麦语" } },
  { code: "ta", labels: { vi: "Tiếng Tamil", en: "Tamil", ja: "タミル語", zh: "泰米尔语" } },
  { code: "uk", labels: { vi: "Tiếng Ukraina", en: "Ukrainian", ja: "ウクライナ語", zh: "乌克兰语" } },
  { code: "ru", labels: { vi: "Tiếng Nga", en: "Russian", ja: "ロシア語", zh: "俄语" } },
  { code: "hu", labels: { vi: "Tiếng Hungary", en: "Hungarian", ja: "ハンガリー語", zh: "匈牙利语" } },
  { code: "no", labels: { vi: "Tiếng Na Uy", en: "Norwegian", ja: "ノルウェー語", zh: "挪威语" } },
  { code: "th", labels: { vi: "Tiếng Thái", en: "Thai", ja: "タイ語", zh: "泰语" } },
  { code: "bn", labels: { vi: "Tiếng Bengali", en: "Bengali", ja: "ベンガル語", zh: "孟加拉语" } },
  { code: "te", labels: { vi: "Tiếng Telugu", en: "Telugu", ja: "テルグ語", zh: "泰卢固语" } },
  { code: "mr", labels: { vi: "Tiếng Marathi", en: "Marathi", ja: "マラーティー語", zh: "马拉地语" } },
  { code: "ur", labels: { vi: "Tiếng Urdu", en: "Urdu", ja: "ウルドゥー語", zh: "乌尔都语" } },
  { code: "gu", labels: { vi: "Tiếng Gujarati", en: "Gujarati", ja: "グジャラート語", zh: "古吉拉特语" } },
  { code: "kn", labels: { vi: "Tiếng Kannada", en: "Kannada", ja: "カンナダ語", zh: "卡纳达语" } },
  { code: "ml", labels: { vi: "Tiếng Malayalam", en: "Malayalam", ja: "マラヤーラム語", zh: "马拉雅拉姆语" } },
  { code: "fa", labels: { vi: "Tiếng Ba Tư", en: "Persian", ja: "ペルシア語", zh: "波斯语" } },
  { code: "he", labels: { vi: "Tiếng Do Thái", en: "Hebrew", ja: "ヘブライ語", zh: "希伯来语" } },
  { code: "ca", labels: { vi: "Tiếng Catalan", en: "Catalan", ja: "カタルーニャ語", zh: "加泰罗尼亚语" } },
  { code: "sr", labels: { vi: "Tiếng Serbia", en: "Serbian", ja: "セルビア語", zh: "塞尔维亚语" } },
  { code: "sl", labels: { vi: "Tiếng Slovenia", en: "Slovenian", ja: "スロベニア語", zh: "斯洛文尼亚语" } },
  { code: "lt", labels: { vi: "Tiếng Litva", en: "Lithuanian", ja: "リトアニア語", zh: "立陶宛语" } },
  { code: "lv", labels: { vi: "Tiếng Latvia", en: "Latvian", ja: "ラトビア語", zh: "拉脱维亚语" } },
  { code: "et", labels: { vi: "Tiếng Estonia", en: "Estonian", ja: "エストニア語", zh: "爱沙尼亚语" } },
  { code: "is", labels: { vi: "Tiếng Iceland", en: "Icelandic", ja: "アイスランド語", zh: "冰岛语" } },
  { code: "ga", labels: { vi: "Tiếng Ireland", en: "Irish", ja: "アイルランド語", zh: "爱尔兰语" } },
  { code: "af", labels: { vi: "Tiếng Afrikaans", en: "Afrikaans", ja: "アフリカーンス語", zh: "南非荷兰语" } },
  { code: "sw", labels: { vi: "Tiếng Swahili", en: "Swahili", ja: "スワヒリ語", zh: "斯瓦希里语" } },
  { code: "km", labels: { vi: "Tiếng Khmer", en: "Khmer", ja: "クメール語", zh: "高棉语" } },
  { code: "my", labels: { vi: "Tiếng Miến Điện", en: "Burmese", ja: "ビルマ語", zh: "缅甸语" } },
  { code: "lo", labels: { vi: "Tiếng Lào", en: "Lao", ja: "ラオス語", zh: "老挝语" } },
  { code: "mn", labels: { vi: "Tiếng Mông Cổ", en: "Mongolian", ja: "モンゴル語", zh: "蒙古语" } },
  { code: "ne", labels: { vi: "Tiếng Nepal", en: "Nepali", ja: "ネパール語", zh: "尼泊尔语" } },
  { code: "az", labels: { vi: "Tiếng Azerbaijan", en: "Azerbaijani", ja: "アゼルバイジャン語", zh: "阿塞拜疆语" } },
  { code: "kk", labels: { vi: "Tiếng Kazakh", en: "Kazakh", ja: "カザフ語", zh: "哈萨克语" } },
  { code: "uz", labels: { vi: "Tiếng Uzbek", en: "Uzbek", ja: "ウズベク語", zh: "乌兹别克语" } },
  { code: "cy", labels: { vi: "Tiếng Wales", en: "Welsh", ja: "ウェールズ語", zh: "威尔士语" } },
  { code: "gl", labels: { vi: "Tiếng Galicia", en: "Galician", ja: "ガリシア語", zh: "加利西亚语" } },
  { code: "hy", labels: { vi: "Tiếng Armenia", en: "Armenian", ja: "アルメニア語", zh: "亚美尼亚语" } },
  { code: "ka", labels: { vi: "Tiếng Georgia", en: "Georgian", ja: "ジョージア語", zh: "格鲁吉亚语" } },
  { code: "eu", labels: { vi: "Tiếng Basque", en: "Basque", ja: "バスク語", zh: "巴斯克语" } },
  { code: "zh-TW", labels: { vi: "Tiếng Trung Phồn thể", en: "Chinese Traditional", ja: "中国語（繁体字）", zh: "繁体中文" } },
  { code: "sq", labels: { vi: "Tiếng Albania", en: "Albanian", ja: "アルバニア語", zh: "阿尔巴尼亚语" } },
  { code: "am", labels: { vi: "Tiếng Amharic", en: "Amharic", ja: "アムハラ語", zh: "阿姆哈拉语" } },
  { code: "as", labels: { vi: "Tiếng Assamese", en: "Assamese", ja: "アッサム語", zh: "阿萨姆语" } },
  { code: "ba", labels: { vi: "Tiếng Bashkir", en: "Bashkir", ja: "バシキール語", zh: "巴什基尔语" } },
  { code: "be", labels: { vi: "Tiếng Belarus", en: "Belarusian", ja: "ベラルーシ語", zh: "白俄罗斯语" } },
  { code: "bs", labels: { vi: "Tiếng Bosnia", en: "Bosnian", ja: "ボスニア語", zh: "波斯尼亚语" } },
  { code: "pt-BR", labels: { vi: "Tiếng Bồ Đào Nha (Brazil)", en: "Portuguese (Brazil)", ja: "ポルトガル語（ブラジル）", zh: "葡萄牙语（巴西）" } },
  { code: "br", labels: { vi: "Tiếng Breton", en: "Breton", ja: "ブルトン語", zh: "布列塔尼语" } },
  { code: "eo", labels: { vi: "Tiếng Esperanto", en: "Esperanto", ja: "エスペラント語", zh: "世界语" } },
  { code: "fo", labels: { vi: "Tiếng Faroe", en: "Faroese", ja: "フェロー語", zh: "法罗语" } },
  { code: "tl", labels: { vi: "Tiếng Filipino (Tagalog)", en: "Filipino", ja: "タガログ語", zh: "塔加洛语" } },
  { code: "ht", labels: { vi: "Tiếng Creole Haiti", en: "Haitian Creole", ja: "ハイチ語", zh: "海地克里奥尔语" } },
  { code: "ha", labels: { vi: "Tiếng Hausa", en: "Hausa", ja: "ハウサ語", zh: "豪萨语" } },
  { code: "haw", labels: { vi: "Tiếng Hawaii", en: "Hawaiian", ja: "ハワイ語", zh: "夏威夷语" } },
  { code: "ig", labels: { vi: "Tiếng Igbo", en: "Igbo", ja: "イボ語", zh: "伊博语" } },
  { code: "jw", labels: { vi: "Tiếng Java", en: "Javanese", ja: "ジャワ語", zh: "爪哇语" } },
  { code: "la", labels: { vi: "Tiếng Latin", en: "Latin", ja: "ラテン語", zh: "拉丁语" } },
  { code: "ln", labels: { vi: "Tiếng Lingala", en: "Lingala", ja: "リンガラ語", zh: "林加拉语" } },
  { code: "lb", labels: { vi: "Tiếng Luxembourg", en: "Luxembourgish", ja: "ルクセンブルク語", zh: "卢森堡语" } },
  { code: "mk", labels: { vi: "Tiếng Bắc Macedonia", en: "Macedonian", ja: "マケドニア語", zh: "马其顿语" } },
  { code: "mg", labels: { vi: "Tiếng Malagasy", en: "Malagasy", ja: "マダガスカル語", zh: "马达加斯加语" } },
  { code: "mt", labels: { vi: "Tiếng Malta", en: "Maltese", ja: "マルタ語", zh: "马耳他语" } },
  { code: "mi", labels: { vi: "Tiếng Maori", en: "Maori", ja: "マオリ語", zh: "毛利语" } },
  { code: "nn", labels: { vi: "Tiếng Na Uy (Nynorsk)", en: "Norwegian Nynorsk", ja: "新ノルウェー語", zh: "新挪威语" } },
  { code: "oc", labels: { vi: "Tiếng Occitan", en: "Occitan", ja: "オック語", zh: "奥克语" } },
  { code: "ps", labels: { vi: "Tiếng Pashto", en: "Pashto", ja: "パシュトー語", zh: "普什图语" } },
  { code: "pa", labels: { vi: "Tiếng Punjabi", en: "Punjabi", ja: "パンジャブ語", zh: "旁遮普语" } },
  { code: "sa", labels: { vi: "Tiếng Phạn (Sanskrit)", en: "Sanskrit", ja: "サンスクリット語", zh: "梵语" } },
  { code: "sn", labels: { vi: "Tiếng Shona", en: "Shona", ja: "ショナ語", zh: "绍纳语" } },
  { code: "sd", labels: { vi: "Tiếng Sindhi", en: "Sindhi", ja: "シンド語", zh: "信德语" } },
  { code: "si", labels: { vi: "Tiếng Sinhala", en: "Sinhala", ja: "シンハラ語", zh: "僧伽罗语" } },
  { code: "so", labels: { vi: "Tiếng Somali", en: "Somali", ja: "ソマリ語", zh: "索马里语" } },
  { code: "su", labels: { vi: "Tiếng Sunda", en: "Sundanese", ja: "スンダ語", zh: "巽他语" } },
  { code: "tg", labels: { vi: "Tiếng Tajik", en: "Tajik", ja: "タジク語", zh: "塔吉克语" } },
  { code: "tt", labels: { vi: "Tiếng Tatar", en: "Tatar", ja: "タタール語", zh: "鞑靼语" } },
  { code: "bo", labels: { vi: "Tiếng Tây Tạng", en: "Tibetan", ja: "チベット語", zh: "藏语" } },
  { code: "tk", labels: { vi: "Tiếng Turkmen", en: "Turkmen", ja: "トルクメン語", zh: "土库曼语" } },
  { code: "xh", labels: { vi: "Tiếng Xhosa", en: "Xhosa", ja: "コサ語", zh: "科萨语" } },
  { code: "yi", labels: { vi: "Tiếng Yiddish", en: "Yiddish", ja: "イディッシュ語", zh: "意第绪语" } },
  { code: "yo", labels: { vi: "Tiếng Yoruba", en: "Yoruba", ja: "ヨルバ語", zh: "约鲁巴语" } },
  { code: "zu", labels: { vi: "Tiếng Zulu", en: "Zulu", ja: "ズールー語", zh: "祖鲁语" } },
];

export const ORDERED_VISIBLE_LANGUAGE_CODES = [
  "vi",
  "en",
  "zh",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pt",
  "ar",
];

export const LANGUAGE_OPTIONS: LanguageDefinition[] = ORDERED_VISIBLE_LANGUAGE_CODES.map(
  (code) => LANGUAGE_REGISTRY.find((l) => l.code === code)!
).filter(Boolean);

export const ACCENTS_BY_LANGUAGE: Record<string, AccentDefinition[]> = {
  vi: [
    {
      id: "vi-north",
      languageCode: "vi",
      labels: {
        vi: "Miền Bắc",
        en: "Northern",
        ja: "北部方言",
        zh: "北部口音",
      },
    },
    {
      id: "vi-central",
      languageCode: "vi",
      labels: {
        vi: "Miền Trung",
        en: "Central",
        ja: "中部方言",
        zh: "中部口音",
      },
    },
    {
      id: "vi-south",
      languageCode: "vi",
      labels: {
        vi: "Miền Nam",
        en: "Southern",
        ja: "南部方言",
        zh: "南部口音",
      },
    },
  ],
  en: [
    {
      id: "en-us",
      languageCode: "en",
      labels: {
        vi: "Mỹ",
        en: "US",
        ja: "アメリカ",
        zh: "美国",
      },
    },
    {
      id: "en-gb",
      languageCode: "en",
      labels: {
        vi: "Anh",
        en: "UK",
        ja: "イギリス",
        zh: "英国",
      },
    },
    {
      id: "en-au",
      languageCode: "en",
      labels: {
        vi: "Úc",
        en: "Australian",
        ja: "オーストラリア",
        zh: "澳大利亚",
      },
    },
    {
      id: "en-ca",
      languageCode: "en",
      labels: {
        vi: "Canada",
        en: "Canadian",
        ja: "カナダ",
        zh: "加拿大",
      },
    },
    {
      id: "en-in",
      languageCode: "en",
      labels: {
        vi: "Ấn Độ",
        en: "Indian",
        ja: "インド",
        zh: "印度",
      },
    },
  ],
  es: [
    {
      id: "es-es",
      languageCode: "es",
      labels: {
        vi: "Tây Ban Nha",
        en: "Spain",
        ja: "スペイン",
        zh: "西班牙",
      },
    },
    {
      id: "es-mx",
      languageCode: "es",
      labels: {
        vi: "Mexico",
        en: "Mexican",
        ja: "メキシコ",
        zh: "墨西哥",
      },
    },
    {
      id: "es-ar",
      languageCode: "es",
      labels: {
        vi: "Argentina",
        en: "Argentinian",
        ja: "アルゼンチン",
        zh: "阿根廷",
      },
    },
    {
      id: "es-co",
      languageCode: "es",
      labels: {
        vi: "Colombia",
        en: "Colombian",
        ja: "コロンビア",
        zh: "哥伦比亚",
      },
    },
  ],
  pt: [
    {
      id: "pt-br",
      languageCode: "pt",
      labels: {
        vi: "Brazil",
        en: "Brazilian",
        ja: "ブラジル",
        zh: "巴西",
      },
    },
    {
      id: "pt-pt",
      languageCode: "pt",
      labels: {
        vi: "Bồ Đào Nha",
        en: "European Portuguese",
        ja: "ポルトガル",
        zh: "葡萄牙",
      },
    },
  ],
  fr: [
    {
      id: "fr-fr",
      languageCode: "fr",
      labels: {
        vi: "Pháp",
        en: "France",
        ja: "フランス",
        zh: "法国",
      },
    },
    {
      id: "fr-ca",
      languageCode: "fr",
      labels: {
        vi: "Canada",
        en: "Canadian French",
        ja: "カナダ",
        zh: "加拿大",
      },
    },
    {
      id: "fr-be",
      languageCode: "fr",
      labels: {
        vi: "Bỉ",
        en: "Belgian French",
        ja: "ベルギー",
        zh: "比利时",
      },
    },
    {
      id: "fr-ch",
      languageCode: "fr",
      labels: {
        vi: "Thụy Sĩ",
        en: "Swiss French",
        ja: "スイス",
        zh: "瑞士",
      },
    },
  ],
  de: [
    {
      id: "de-de",
      languageCode: "de",
      labels: {
        vi: "Đức",
        en: "Germany",
        ja: "ドイツ",
        zh: "德国",
      },
    },
    {
      id: "de-at",
      languageCode: "de",
      labels: {
        vi: "Áo",
        en: "Austrian German",
        ja: "オーストリア",
        zh: "奥地利",
      },
    },
    {
      id: "de-ch",
      languageCode: "de",
      labels: {
        vi: "Thụy Sĩ",
        en: "Swiss German",
        ja: "スイス",
        zh: "瑞士",
      },
    },
  ],
  ar: [
    {
      id: "ar-msa",
      languageCode: "ar",
      labels: {
        vi: "Ả Rập chuẩn",
        en: "Modern Standard Arabic",
        ja: "現代標準アラビア語",
        zh: "现代标准阿拉伯语",
      },
    },
    {
      id: "ar-egyptian",
      languageCode: "ar",
      labels: {
        vi: "Ai Cập",
        en: "Egyptian",
        ja: "エジプト",
        zh: "埃及",
      },
    },
    {
      id: "ar-gulf",
      languageCode: "ar",
      labels: {
        vi: "Vùng Vịnh",
        en: "Gulf",
        ja: "湾岸",
        zh: "海湾",
      },
    },
    {
      id: "ar-levantine",
      languageCode: "ar",
      labels: {
        vi: "Levant",
        en: "Levantine",
        ja: "レバント",
        zh: "黎凡特",
      },
    },
    {
      id: "ar-maghrebi",
      languageCode: "ar",
      labels: {
        vi: "Maghreb",
        en: "Maghrebi",
        ja: "マグレブ",
        zh: "马格里布",
      },
    },
  ],
};

export const SOURCE_OPTIONS: OptionDefinition[] = [
  {
    id: "edge",
    labels: { vi: "Edge TTS", en: "Edge TTS", ja: "Edge TTS", zh: "Edge TTS" },
  },
  {
    id: "google",
    labels: { vi: "Google TTS", en: "Google TTS", ja: "Google TTS", zh: "Google TTS" },
  },
  {
    id: "local",
    labels: { vi: "Local AI", en: "Local AI", ja: "Local AI", zh: "Local AI" },
  },
];

export const GENDER_OPTIONS: OptionDefinition[] = [
  {
    id: "male",
    labels: { vi: "Nam", en: "Male", ja: "男性", zh: "男声" },
  },
  {
    id: "female",
    labels: { vi: "Nữ", en: "Female", ja: "女性", zh: "女声" },
  },
];

export const STYLE_OPTIONS: OptionDefinition[] = [
  {
    id: "natural",
    labels: { vi: "Tự nhiên", en: "Natural", ja: "自然", zh: "自然" },
  },
  {
    id: "storytelling",
    labels: { vi: "Kể chuyện", en: "Storytelling", ja: "ストーリーテリング", zh: "讲故事" },
  },
  {
    id: "conversational",
    labels: { vi: "Đàm thoại", en: "Conversational", ja: "対話", zh: "对话" },
  },
  {
    id: "narration",
    labels: { vi: "Thuyết minh", en: "Narration", ja: "ナレーション", zh: "旁白" },
  },
  {
    id: "podcast",
    labels: { vi: "Podcast", en: "Podcast", ja: "ポッドキャスト", zh: "播客" },
  },
  {
    id: "advertising",
    labels: { vi: "Quảng cáo", en: "Commercial", ja: "広告", zh: "广告" },
  },
  {
    id: "news",
    labels: { vi: "Thời sự", en: "News", ja: "ニュース", zh: "新闻" },
  },
  {
    id: "warm",
    labels: { vi: "Ấm áp", en: "Warm", ja: "温かい", zh: "温暖" },
  },
  {
    id: "clear",
    labels: { vi: "Trong trẻo", en: "Clear", ja: "クリア", zh: "清澈" },
  },
  {
    id: "calm",
    labels: { vi: "Điềm đạm", en: "Calm", ja: "穏やか", zh: "沉稳" },
  },
  {
    id: "energetic",
    labels: { vi: "Năng động", en: "Energetic", ja: "元気", zh: "活力" },
  },
  {
    id: "balanced",
    labels: { vi: "Cân bằng", en: "Balanced", ja: "バランス", zh: "平衡" },
  },
  {
    id: "deep",
    labels: { vi: "Trầm", en: "Deep", ja: "低音", zh: "深沉" },
  },
  {
    id: "expressive",
    labels: { vi: "Truyền cảm", en: "Expressive", ja: "感情豊か", zh: "深情" },
  },
  {
    id: "gentle",
    labels: { vi: "Nhẹ nhàng", en: "Gentle", ja: "優しい", zh: "温柔" },
  },
];

export const CATEGORY_OPTIONS: OptionDefinition[] = STYLE_OPTIONS;

export const AGE_OPTIONS: OptionDefinition[] = [
  {
    id: "young",
    labels: { vi: "Trẻ", en: "Young", ja: "若年", zh: "青年" },
  },
  {
    id: "middle_aged",
    labels: { vi: "Trung niên", en: "Middle-aged", ja: "中年", zh: "中年" },
  },
  {
    id: "senior",
    labels: { vi: "Lớn tuổi", en: "Senior", ja: "高齢", zh: "老年" },
  },
];

// Helper functions for normalization (supporting both canonical IDs and historical strings)
export function normalizeAccent(accent?: string | null): string {
  if (!accent) return "";
  const lower = accent.toLowerCase().trim();
  // Vietnamese
  if (
    lower === "vi-north" ||
    lower === "miền bắc" ||
    lower === "bắc bộ" ||
    lower === "tiếng bắc" ||
    lower === "northern" ||
    lower === "northern vietnamese"
  )
    return "vi-north";
  if (
    lower === "vi-central" ||
    lower === "miền trung" ||
    lower === "trung bộ" ||
    lower === "tiếng trung" ||
    lower === "central" ||
    lower === "central vietnamese"
  )
    return "vi-central";
  if (
    lower === "vi-south" ||
    lower === "miền nam" ||
    lower === "nam bộ" ||
    lower === "tiếng nam" ||
    lower === "southern" ||
    lower === "southern vietnamese"
  )
    return "vi-south";
  // English
  if (lower === "en-us" || lower === "us" || lower === "mỹ" || lower === "tiêu chuẩn" || lower === "standard") return "en-us";
  if (lower === "en-gb" || lower === "en-uk" || lower === "uk" || lower === "anh") return "en-gb";
  if (lower === "en-au" || lower === "au" || lower === "úc" || lower === "australian") return "en-au";
  if (lower === "en-ca" || lower === "ca" || lower === "canada" || lower === "canadian") return "en-ca";
  if (lower === "en-in" || lower === "in" || lower === "ấn độ" || lower === "indian") return "en-in";
  // Spanish
  if (lower === "es-es" || lower === "spain" || lower === "tây ban nha") return "es-es";
  if (lower === "es-mx" || lower === "mexico" || lower === "mexican") return "es-mx";
  if (lower === "es-ar" || lower === "argentina" || lower === "argentinian") return "es-ar";
  if (lower === "es-co" || lower === "colombia" || lower === "colombian") return "es-co";
  // Portuguese
  if (lower === "pt-br" || lower === "brazil" || lower === "brazilian") return "pt-br";
  if (lower === "pt-pt" || lower === "portugal" || lower === "bồ đào nha" || lower === "european portuguese") return "pt-pt";
  // French
  if (lower === "fr-fr" || lower === "france" || lower === "pháp") return "fr-fr";
  if (lower === "fr-ca" || lower === "canadian french") return "fr-ca";
  if (lower === "fr-be" || lower === "belgium" || lower === "bỉ" || lower === "belgian french") return "fr-be";
  if (lower === "fr-ch" || lower === "swiss french") return "fr-ch";
  // German
  if (lower === "de-de" || lower === "germany" || lower === "đức") return "de-de";
  if (lower === "de-at" || lower === "austria" || lower === "áo" || lower === "austrian german") return "de-at";
  if (lower === "de-ch" || lower === "swiss german") return "de-ch";
  // Arabic
  if (lower === "ar-msa" || lower === "modern standard arabic" || lower === "ả rập chuẩn") return "ar-msa";
  if (lower === "ar-egyptian" || lower === "egypt" || lower === "ai cập" || lower === "egyptian") return "ar-egyptian";
  if (lower === "ar-gulf" || lower === "gulf" || lower === "vùng vịnh") return "ar-gulf";
  if (lower === "ar-levantine" || lower === "levant" || lower === "levantine") return "ar-levantine";
  if (lower === "ar-maghrebi" || lower === "maghreb" || lower === "maghrebi") return "ar-maghrebi";
  return "";
}

export function normalizeStyle(style?: string | null): string {
  if (!style) return "";
  const lower = style.toLowerCase().trim();
  if (lower === "natural" || lower === "tự nhiên") return "natural";
  if (lower === "storytelling" || lower === "story" || lower === "kể chuyện" || lower === "truyện") return "storytelling";
  if (lower === "conversational" || lower === "conversation" || lower === "đàm thoại") return "conversational";
  if (lower === "narration" || lower === "thuyết minh" || lower === "lời kể") return "narration";
  if (lower === "podcast") return "podcast";
  if (lower === "advertising" || lower === "ad" || lower === "commercial" || lower === "quảng cáo") return "advertising";
  if (lower === "news" || lower === "formal" || lower === "thời sự" || lower === "tin tức") return "news";
  if (lower === "warm" || lower === "ấm áp") return "warm";
  if (lower === "clear" || lower === "trong trẻo") return "clear";
  if (lower === "calm" || lower === "điềm đạm") return "calm";
  if (lower === "energetic" || lower === "năng động" || lower === "sôi nổi") return "energetic";
  if (lower === "balanced" || lower === "cân bằng") return "balanced";
  if (lower === "deep" || lower === "trầm") return "deep";
  if (lower === "expressive" || lower === "truyền cảm") return "expressive";
  if (lower === "gentle" || lower === "nhẹ nhàng" || lower === "dịu dàng") return "gentle";
  return "";
}

export const normalizeCategory = normalizeStyle;

export function normalizeAge(age?: string | null): string {
  if (!age) return "";
  const lower = age.toLowerCase().trim();
  if (lower === "young" || lower === "trẻ") return "young";
  if (lower === "middle_aged" || lower === "middle aged" || lower === "trung niên") return "middle_aged";
  if (lower === "senior" || lower === "lớn tuổi" || lower === "cao tuổi" || lower === "già") return "senior";
  return "";
}

export function isAccentFilterSupported(langCode?: string): boolean {
  if (!langCode || langCode === "all") return false;
  const accents = ACCENTS_BY_LANGUAGE[langCode];
  return Array.isArray(accents) && accents.length >= 2;
}

export function getLanguageLabel(code: string, lang: SupportedLang): string {
  const found = LANGUAGE_REGISTRY.find((l) => l.code === code) || LANGUAGE_OPTIONS.find((l) => l.code === code);
  return found ? (found.labels[lang] || found.labels.en || code) : code;
}

export function getAccentLabel(accentId: string, lang: SupportedLang): string {
  for (const list of Object.values(ACCENTS_BY_LANGUAGE)) {
    const found = list.find((a) => a.id === accentId);
    if (found) {
      return found.labels[lang] || found.labels.en || accentId;
    }
  }
  return accentId;
}

export function getGenderLabel(genderId: string, lang: SupportedLang): string {
  const found = GENDER_OPTIONS.find((g) => g.id === genderId);
  return found ? (found.labels[lang] || found.labels.en || genderId) : genderId;
}

export function getStyleLabel(styleId: string, lang: SupportedLang): string {
  const found = STYLE_OPTIONS.find((s) => s.id === styleId);
  return found ? (found.labels[lang] || found.labels.en || styleId) : styleId;
}

export const getCategoryLabel = getStyleLabel;

export function getAgeLabel(ageId: string, lang: SupportedLang): string {
  const found = AGE_OPTIONS.find((a) => a.id === ageId);
  return found ? (found.labels[lang] || found.labels.en || ageId) : ageId;
}

export function getSourceLabel(sourceId: string, lang: SupportedLang): string {
  if (sourceId === "all") {
    return lang === "vi" ? "Tất cả" : lang === "ja" ? "すべて" : lang === "zh" ? "全部" : "All";
  }
  const found = SOURCE_OPTIONS.find((s) => s.id === sourceId);
  return found ? (found.labels[lang] || found.labels.en || sourceId) : sourceId;
}

export const COUNTRY_NAMES: Record<string, Record<SupportedLang, string>> = {
  vn: { vi: "Việt Nam", en: "Vietnam", ja: "ベトナム", zh: "越南" },
  us: { vi: "Hoa Kỳ", en: "United States", ja: "アメリカ", zh: "美国" },
  gb: { vi: "Vương quốc Anh", en: "United Kingdom", ja: "イギリス", zh: "英国" },
  au: { vi: "Úc", en: "Australia", ja: "オーストラリア", zh: "澳大利亚" },
  ca: { vi: "Canada", en: "Canada", ja: "カナダ", zh: "加拿大" },
  es: { vi: "Tây Ban Nha", en: "Spain", ja: "スペイン", zh: "西班牙" },
  fr: { vi: "Pháp", en: "France", ja: "フランス", zh: "法国" },
  de: { vi: "Đức", en: "Germany", ja: "ドイツ", zh: "德国" },
  jp: { vi: "Nhật Bản", en: "Japan", ja: "日本", zh: "日本" },
  cn: { vi: "Trung Quốc", en: "China", ja: "中国", zh: "中国" },
  kr: { vi: "Hàn Quốc", en: "South Korea", ja: "韓国", zh: "韩国" },
  it: { vi: "Ý", en: "Italy", ja: "イタリア", zh: "意大利" },
  ru: { vi: "Nga", en: "Russia", ja: "ロシア", zh: "俄罗斯" },
  br: { vi: "Brazil", en: "Brazil", ja: "ブラジル", zh: "巴西" },
  pt: { vi: "Bồ Đào Nha", en: "Portugal", ja: "ポルトガル", zh: "葡萄牙" },
  in: { vi: "Ấn Độ", en: "India", ja: "インド", zh: "印度" },
  id: { vi: "Indonesia", en: "Indonesia", ja: "インドネシア", zh: "印度尼西亚" },
  th: { vi: "Thái Lan", en: "Thailand", ja: "タイ", zh: "泰国" },
  nl: { vi: "Hà Lan", en: "Netherlands", ja: "オランダ", zh: "荷兰" },
  tr: { vi: "Thổ Nhĩ Kỳ", en: "Turkey", ja: "トルコ", zh: "土耳其" },
  pl: { vi: "Ba Lan", en: "Poland", ja: "ポーランド", zh: "波兰" },
  se: { vi: "Thụy Điển", en: "Sweden", ja: "スウェーデン", zh: "瑞典" },
  sa: { vi: "Ả Rập Xê Út", en: "Saudi Arabia", ja: "サウジアラビア", zh: "沙特阿拉伯" },
  eg: { vi: "Ai Cập", en: "Egypt", ja: "エジプト", zh: "埃及" },
  mx: { vi: "Mexico", en: "Mexico", ja: "メキシコ", zh: "墨西哥" },
};

export function getCountryLabel(countryCode: string, lang: SupportedLang = "vi"): string {
  const c = (countryCode || "").toLowerCase().trim();
  const entry = COUNTRY_NAMES[c];
  if (entry) {
    return entry[lang] || entry.en || entry.vi || countryCode.toUpperCase();
  }
  return countryCode.toUpperCase();
}

export function computeVisibleTags(secondaryTags: string[]): {
  visibleTags: string[];
  hiddenTags: string[];
} {
  if (secondaryTags.length <= 2) {
    return { visibleTags: secondaryTags, hiddenTags: [] };
  }

  if (secondaryTags.length === 3) {
    // If 3 tags are short (total chars <= 18 and max single tag <= 9), all 3 fit in one row without wrapping
    const totalChars = secondaryTags.reduce((sum, t) => sum + t.length, 0);
    const maxSingleChar = Math.max(...secondaryTags.map((t) => t.length));

    if (totalChars <= 18 && maxSingleChar <= 9) {
      return { visibleTags: secondaryTags, hiddenTags: [] };
    } else {
      return {
        visibleTags: secondaryTags.slice(0, 2),
        hiddenTags: secondaryTags.slice(2),
      };
    }
  }

  // If > 3 tags: strictly max 3 chips total (2 tags + 1 [+N] chip)
  return {
    visibleTags: secondaryTags.slice(0, 2),
    hiddenTags: secondaryTags.slice(2),
  };
}

export interface VoiceLanguageInfo {
  code: string;
  countryCode: string;
  flag: string;
  name: string;
  countryName: string;
}

export function getVoiceLanguageInfo(
  voice: { supportedLanguages?: string[]; accent?: string | null; id?: string; country?: string | null },
  uiLang: SupportedLang
): VoiceLanguageInfo {
  let code = "vi";
  if (Array.isArray(voice.supportedLanguages) && voice.supportedLanguages.length > 0) {
    code = voice.supportedLanguages[0].toLowerCase();
  } else if (voice.accent) {
    const acc = voice.accent.toLowerCase();
    if (acc.startsWith("vi")) code = "vi";
    else if (acc.startsWith("en")) code = "en";
    else if (acc.startsWith("es")) code = "es";
    else if (acc.startsWith("fr")) code = "fr";
    else if (acc.startsWith("de")) code = "de";
    else if (acc.startsWith("ja")) code = "ja";
    else if (acc.startsWith("zh")) code = "zh";
    else if (acc.startsWith("ko")) code = "ko";
  }

  // Country Flag & CountryCode resolution
  let countryCode = "vn";
  let flag = "🌐";
  const acc = (voice.accent || "").toLowerCase();
  if (code === "vi" || acc.startsWith("vi")) {
    countryCode = "vn";
    flag = "🇻🇳";
  } else if (code === "en") {
    if (acc.includes("uk") || acc.includes("anh") || acc.includes("british")) {
      countryCode = "gb";
      flag = "🇬🇧";
    } else if (acc.includes("au") || acc.includes("úc") || acc.includes("australian")) {
      countryCode = "au";
      flag = "🇦🇺";
    } else {
      countryCode = "us";
      flag = "🇺🇸";
    }
  } else if (code === "ja") {
    countryCode = "jp";
    flag = "🇯🇵";
  } else if (code === "zh") {
    countryCode = "cn";
    flag = "🇨🇳";
  } else if (code === "ko") {
    countryCode = "kr";
    flag = "🇰🇷";
  } else if (code === "es") {
    countryCode = "es";
    flag = "🇪🇸";
  } else if (code === "fr") {
    countryCode = "fr";
    flag = "🇫🇷";
  } else if (code === "de") {
    countryCode = "de";
    flag = "🇩🇪";
  } else if (code === "pt") {
    countryCode = "pt";
    flag = "🇵🇹";
  } else if (code === "ar") {
    countryCode = "sa";
    flag = "🇸🇦";
  } else if (code === "it") {
    countryCode = "it";
    flag = "🇮🇹";
  } else if (code === "ru") {
    countryCode = "ru";
    flag = "🇷🇺";
  } else if (code === "id") {
    countryCode = "id";
    flag = "🇮🇩";
  } else if (code === "nl") {
    countryCode = "nl";
    flag = "🇳🇱";
  } else if (code === "tr") {
    countryCode = "tr";
    flag = "🇹🇷";
  } else if (code === "pl") {
    countryCode = "pl";
    flag = "🇵🇱";
  } else if (code === "sv") {
    countryCode = "se";
    flag = "🇸🇪";
  } else if (code === "th") {
    countryCode = "th";
    flag = "🇹🇭";
  } else {
    const metaMap: Record<string, { country: string; flag: string }> = {
      hi: { country: "in", flag: "🇮🇳" },
      fil: { country: "ph", flag: "🇵🇭" },
      bg: { country: "bg", flag: "🇧🇬" },
      ro: { country: "ro", flag: "🇷🇴" },
      cs: { country: "cz", flag: "🇨🇿" },
      el: { country: "gr", flag: "🇬🇷" },
      fi: { country: "fi", flag: "🇫🇮" },
      hr: { country: "hr", flag: "🇭🇷" },
      ms: { country: "my", flag: "🇲🇾" },
      sk: { country: "sk", flag: "🇸🇰" },
      da: { country: "dk", flag: "🇩🇰" },
      ta: { country: "in", flag: "🇮🇳" },
      uk: { country: "ua", flag: "🇺🇦" },
      hu: { country: "hu", flag: "🇭🇺" },
      no: { country: "no", flag: "🇳🇴" },
    };
    if (metaMap[code]) {
      countryCode = metaMap[code].country;
      flag = metaMap[code].flag;
    } else {
      countryCode = code;
    }
  }

  // If voice explicitly specifies country (e.g. "VN", "US", "GB"), use that authoritative countryCode
  if (voice.country) {
    countryCode = voice.country.toLowerCase().trim();
  }

  const name = getLanguageLabel(code, uiLang);
  const countryName = getCountryLabel(countryCode, uiLang);

  return { code, countryCode, flag, name, countryName };
}

export function isAccentRedundantWithCountry(accent?: string | null, countryCode?: string | null): boolean {
  if (!accent) return true;
  const normAcc = normalizeAccent(accent);
  if (!normAcc) return true;

  const country = (countryCode || "").toLowerCase();

  // Sub-national regional accents are informative and never redundant
  if (normAcc === "vi-north" || normAcc === "vi-central" || normAcc === "vi-south") {
    return false;
  }
  if (normAcc.includes("gulf") || normAcc.includes("levant") || normAcc.includes("maghreb")) {
    return false;
  }

  // Country-level regional accents redundant with country
  if (normAcc === "en-us" && (country === "us" || country === "usa")) return true;
  if (normAcc === "en-gb" && (country === "gb" || country === "uk")) return true;
  if (normAcc === "en-au" && country === "au") return true;
  if (normAcc === "en-ca" && country === "ca") return true;
  if (normAcc === "en-in" && country === "in") return true;
  if (normAcc === "es-es" && country === "es") return true;
  if (normAcc === "es-mx" && country === "mx") return true;
  if (normAcc === "es-ar" && country === "ar") return true;
  if (normAcc === "es-co" && country === "co") return true;
  if (normAcc === "pt-br" && country === "br") return true;
  if (normAcc === "pt-pt" && country === "pt") return true;
  if (normAcc === "fr-fr" && country === "fr") return true;
  if (normAcc === "fr-ca" && country === "ca") return true;
  if (normAcc === "fr-be" && country === "be") return true;
  if (normAcc === "de-de" && country === "de") return true;
  if (normAcc === "de-at" && country === "at") return true;

  // General check
  if (country && normAcc.endsWith("-" + country)) return true;

  return false;
}

export function localizeVoiceTag(rawTag: string, uiLang: SupportedLang): string {
  if (!rawTag) return "";
  const clean = rawTag.replace(/^#/, "").trim();
  const lower = clean.toLowerCase();

  // Gender
  if (lower === "nam" || lower === "male" || lower === "男性" || lower === "男声") {
    return getGenderLabel("male", uiLang);
  }
  if (lower === "nữ" || lower === "female" || lower === "女性" || lower === "女声") {
    return getGenderLabel("female", uiLang);
  }

  // Accent
  const normAcc = normalizeAccent(clean);
  if (normAcc) {
    const accLabel = getAccentLabel(normAcc, uiLang);
    if (accLabel) {
      return accLabel;
    }
  }

  // Style
  const normStyle = normalizeStyle(clean);
  if (normStyle) {
    const styleLabel = getStyleLabel(normStyle, uiLang);
    if (styleLabel) {
      return styleLabel;
    }
  }

  // Age
  const normAge = normalizeAge(clean);
  if (normAge) {
    const ageLabel = getAgeLabel(normAge, uiLang);
    if (ageLabel) {
      return ageLabel;
    }
  }

  // Common tags / attributes
  if (lower === "phòng thu" || lower === "studio" || lower === "studio quality") {
    return { vi: "Phòng thu", en: "Studio", ja: "スタジオ", zh: "录音室" }[uiLang];
  }
  if (lower === "tiêu chuẩn" || lower === "chuẩn" || lower === "standard") {
    return { vi: "Tiêu chuẩn", en: "Standard", ja: "標準", zh: "标准" }[uiLang];
  }
  if (lower === "cục bộ" || lower === "local") {
    return { vi: "Cục bộ", en: "Local", ja: "ローカル", zh: "本地" }[uiLang];
  }
  if (lower === "nhân bản" || lower === "clone" || lower === "cloned") {
    return { vi: "Nhân bản", en: "Cloned", ja: "クローン", zh: "克隆" }[uiLang];
  }
  if (lower === "chuyên nghiệp" || lower === "professional" || lower === "pro") {
    return { vi: "Chuyên nghiệp", en: "Professional", ja: "プロ", zh: "专业" }[uiLang];
  }

  return clean;
}

export function getVoiceSecondaryTags(
  voice: VoiceProfile,
  uiLang: SupportedLang
): string[] {
  const tags: string[] = [];

  const addTag = (raw?: string | null) => {
    if (!raw) return;
    const localized = localizeVoiceTag(raw, uiLang);
    if (localized && !tags.some((existing) => existing.toLowerCase() === localized.toLowerCase())) {
      tags.push(localized);
    }
  };

  // 1. Gender (e.g. Nữ / Female or Nam / Male)
  if (voice.gender) {
    addTag(getGenderLabel(voice.gender, uiLang));
  }

  // 2. Accent / Region (if informative and NOT redundant with country per VOICE-R-021)
  const langInfo = getVoiceLanguageInfo(voice, uiLang);
  const voiceCountry = voice.country || langInfo.countryCode;
  if (voice.accent && !isAccentRedundantWithCountry(voice.accent, voiceCountry)) {
    const normAcc = normalizeAccent(voice.accent);
    const accLabel = getAccentLabel(normAcc, uiLang);
    addTag(accLabel);
  }

  // 3. Style / Category (VOICE-R-022)
  if (Array.isArray(voice.styles) && voice.styles.length > 0) {
    for (const st of voice.styles) {
      const normStyle = normalizeStyle(st);
      if (normStyle) {
        const styleLabel = getStyleLabel(normStyle, uiLang);
        addTag(styleLabel);
      }
    }
  } else {
    const normStyle = normalizeStyle(voice.style || voice.category);
    if (normStyle) {
      const styleLabel = getStyleLabel(normStyle, uiLang);
      addTag(styleLabel);
    }
  }

  // 4. Age group (VOICE-R-022)
  const normAge = normalizeAge(voice.ageGroup);
  if (normAge) {
    const ageLabel = getAgeLabel(normAge, uiLang);
    addTag(ageLabel);
  }

  // 5. Custom tags from voice.tags (excluding provider words, clone keywords, etc.)
  if (Array.isArray(voice.tags)) {
    for (const rawTag of voice.tags) {
      const clean = rawTag.replace(/^#/, "").trim();
      const lower = clean.toLowerCase();
      // Skip if this raw tag is already parsed as gender, accent, style, or age
      if (
        lower === "nam" ||
        lower === "male" ||
        lower === "nữ" ||
        lower === "female" ||
        normalizeAccent(clean) ||
        normalizeStyle(clean) ||
        normalizeAge(clean)
      ) {
        continue;
      }

      if (
        clean &&
        ![
          "edge",
          "edge tts",
          "openai",
          "google",
          "google tts",
          "local",
          "local ai",
          "clone",
          "vietnam",
          "tiếng việt",
          "english",
          "us",
          "uk",
          "pháp",
          "đức",
          "spain",
          "france",
          "germany",
          "japan",
          "china",
        ].includes(lower)
      ) {
        addTag(clean);
      }
    }
  }

  return tags;
}

export interface ExtractedStructuredMetadata {
  gender?: "male" | "female";
  accent?: string;
  styles: string[];
  style?: string;
  ageGroup?: string;
  unmappedTags: string[];
}

export function extractStructuredMetadataFromTags(tags: string[]): ExtractedStructuredMetadata {
  let gender: "male" | "female" | undefined;
  let accent: string | undefined;
  const styles: string[] = [];
  let ageGroup: string | undefined;
  const unmappedTags: string[] = [];

  for (const rawTag of tags) {
    const clean = rawTag.replace(/^#/, "").trim();
    if (!clean) continue;
    const lower = clean.toLowerCase();

    // Check gender
    if (!gender && (lower === "nam" || lower === "male" || lower === "男性" || lower === "男声")) {
      gender = "male";
      continue;
    }
    if (!gender && (lower === "nữ" || lower === "female" || lower === "女性" || lower === "女声")) {
      gender = "female";
      continue;
    }

    // Check accent
    const normAcc = normalizeAccent(clean);
    if (normAcc) {
      if (!accent) accent = normAcc;
      continue;
    }

    // Check age
    const normAge = normalizeAge(clean);
    if (normAge) {
      if (!ageGroup) ageGroup = normAge;
      continue;
    }

    // Check style
    const normSt = normalizeStyle(clean);
    if (normSt) {
      if (!styles.includes(normSt)) styles.push(normSt);
      continue;
    }

    // Otherwise keep unmapped tag
    unmappedTags.push(clean);
  }

  return {
    gender,
    accent,
    styles,
    style: styles[0],
    ageGroup,
    unmappedTags,
  };
}

export function migrateLegacyVoice(voice: VoiceProfile): VoiceProfile {
  // Extract metadata from legacy tags
  const extracted = extractStructuredMetadataFromTags(voice.tags || []);

  const gender = voice.gender || extracted.gender || undefined;
  const accent = voice.accent ? normalizeAccent(voice.accent) : (extracted.accent || undefined);

  // Combine and deduplicate styles
  const existingStyles = Array.isArray(voice.styles)
    ? voice.styles
    : (voice.style ? [voice.style] : []);
  const allStyleCandidates = [...existingStyles, ...extracted.styles];
  const normalizedStyles: string[] = [];
  for (const s of allStyleCandidates) {
    const norm = normalizeStyle(s);
    if (norm && !normalizedStyles.includes(norm)) {
      normalizedStyles.push(norm);
    }
  }

  const style = normalizedStyles[0] || (voice.style ? normalizeStyle(voice.style) : undefined) || extracted.style || undefined;
  const ageGroup = voice.ageGroup ? normalizeAge(voice.ageGroup) : (extracted.ageGroup || undefined);

  // Keep unmapped tags + canonical representations
  const finalTags = extracted.unmappedTags.length > 0 ? extracted.unmappedTags : (voice.tags || []);

  return {
    ...voice,
    gender: (gender === "male" || gender === "female") ? gender : undefined,
    accent: accent || undefined,
    styles: normalizedStyles.length > 0 ? normalizedStyles : (style ? [style] : []),
    style: style || undefined,
    category: style || voice.category || undefined,
    ageGroup: ageGroup || undefined,
    tags: finalTags,
  };
}

export const AVATAR_PALETTES = [
  "from-pink-500 to-rose-600",
  "from-teal-500 to-emerald-600",
  "from-amber-500 to-orange-600",
  "from-violet-500 to-purple-600",
  "from-sky-500 to-blue-600",
  "from-indigo-500 to-cyan-600",
  "from-emerald-500 to-teal-600",
  "from-fuchsia-500 to-pink-600",
];

export function getDeterministicAvatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}


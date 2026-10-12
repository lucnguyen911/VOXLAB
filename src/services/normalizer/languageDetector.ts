/**
 * Language detection and resolution for Text Normalization.
 * 
 * Rules:
 * 1. Normalized numbers/currencies/data MUST follow the language of the input script.
 * 2. If the input script has clear, unambiguous language characteristics (e.g. English words without Vietnamese markers,
 *    or Vietnamese diacritics/words), the script's detected language takes precedence over conflicting caller hints
 *    (preventing UI language leakage or default settings from corrupting English text with Vietnamese numbers or vice versa).
 * 3. NEVER take language from UI language or target translation language.
 * 4. If text language cannot be determined from content (e.g. pure numbers "10:30", "$2,200", units "20 km/h"),
 *    explicit caller options (vi or en) disambiguate the language.
 * 5. If still undetermined, returns undefined (caller MUST NOT silently assume English or Vietnamese).
 */

// Uniquely Vietnamese characters that do not exist in English / Romance loanwords
const VIETNAMESE_UNIQUE_DIACRITICS_REGEX =
  /[ăắằẳẵặâấầẩẫậđêếềểễệôốồổỗộơớờởỡợưứừửữựỳýỵỷỹĂẮẰẲẴẶÂẤẦẨẪẬĐÊẾỀỂỄỆÔỐỒỔỖỘƠỚỜỞỠỢƯỨỪỬỮỰỲÝỴỶỸạẹịọụẢẺỈỎỦãẽĩõũẠẸỊỌỤẢẺỈỎỦÃẼĨÕŨ]/u;

// General accents that could rarely appear in loanwords (e.g. café, résumé)
const GENERAL_ACCENTS_REGEX =
  /[àáèéìíòóùúÀÁÈÉÌÍÒÓÙÚ]/u;

const VIETNAMESE_WORDS_REGEX =
  /\b(và|có|là|trong|không|cho|được|với|của|các|tại|việc|tạo|ra|giọng|nói|tự|nhiên|hệ|thống|xử|lý|thời|gian|lúc|ngày|tháng|năm|tỷ|tỉ|lệ|khung|hình|màn|chú|ý|kết|quả|bắt|đầu|phần|trăm|đồng|phút|giờ|giây|chia|bằng|phép|cộng|trừ|nhân|người|những|khi|này|đó|đã|sẽ|đang|đến|từ|về|như|thì|nếu|để)\b/iu;

const ENGLISH_WORDS_REGEX =
  /\b(a|an|the|and|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|shall|should|can|could|may|might|must|in|on|at|to|for|with|by|about|against|between|into|through|during|before|after|above|below|from|up|down|out|off|over|under|again|further|then|once|here|there|when|where|why|how|all|any|both|each|few|more|most|other|some|such|no|nor|not|only|own|same|so|than|too|very|just|now|this|that|these|those|of|it|its|as|or|if|we|you|they|their|them|our|us|he|she|his|her|him|my|me|which|what|who|whom|whose|but|because|while|also|even|project|projects|system|systems|consumes|costs|cost|increased|range|units|unit|supplier|remains|report|ratio|use|using|run|running|per|hour|hours|dollars|dollar|percent|megawatt|megawatts|kilometers|price|prices|money|market|markets|world|car|cars|vehicle|vehicles|autonomous|autonomy|sensor|sensors|computer|computers|robot|robots|humanoid|optimus|reality|engineering|brutal|strip|away|science|fiction|examine|ledger|economics|built|build|war|commercial|public|roads|hardware|engineers|mechanical|cluster|payload|luxury|sedan|exclusively|eliminate|driver|retail|production|threshold|appliance|warehouses|power|tools)\b/giu;

/**
 * Detects whether the text is Vietnamese ("vi"), English ("en"), or undetermined (undefined).
 */
export function detectLanguage(text: string): "vi" | "en" | undefined {
  if (!text || !text.trim()) {
    return undefined;
  }

  // 1. Uniquely Vietnamese letters/marks (ă, â, đ, ê, ô, ơ, ư, dot-below, hook-above, tilde)
  const hasUniqueViDiacritics = VIETNAMESE_UNIQUE_DIACRITICS_REGEX.test(text);

  // 2. Distinctive Vietnamese words check
  const viWordMatches = text.match(VIETNAMESE_WORDS_REGEX);
  const viScore = viWordMatches ? viWordMatches.length : 0;

  // 3. English words check
  const enWordMatches = text.match(ENGLISH_WORDS_REGEX);
  const enScore = enWordMatches ? enWordMatches.length : 0;

  // 4. General accents check (acute / grave on standard vowels)
  const hasGeneralAccents = GENERAL_ACCENTS_REGEX.test(text);

  // If text has uniquely Vietnamese characters or distinctive Vietnamese words:
  if (hasUniqueViDiacritics || viScore > 0) {
    // If English words vastly outnumber (e.g. 50 English words and 1 accidental Vietnamese diacritic)
    if (enScore > 0 && enScore >= 3 * (viScore + (hasUniqueViDiacritics ? 1 : 0))) {
      return "en";
    }
    return "vi";
  }

  // If text only has general accents (e.g. café, résumé):
  if (hasGeneralAccents) {
    if (enScore > 0 && enScore >= 2) {
      return "en";
    }
    return "vi";
  }

  // If text has no diacritics:
  if (viScore > 0 && viScore >= enScore) {
    return "vi";
  }

  if (enScore > 0 && enScore > viScore) {
    return "en";
  }

  // Cannot determine with confidence (pure numbers, codes, symbols)
  return undefined;
}

/**
 * Resolves effective language from explicit options or text detection.
 * 
 * Rules:
 * 1. Normalized numbers/currencies/data MUST follow the language of the input script.
 * 2. If the input script has clear, unambiguous language characteristics (e.g. English words without Vietnamese markers,
 *    or Vietnamese diacritics/words), the script's detected language takes precedence over conflicting caller hints
 *    (preventing UI language leakage or default settings from corrupting English text with Vietnamese numbers or vice versa).
 * 3. If text language cannot be determined from content (e.g. pure numbers "10:30", "$2,200", units "20 km/h"),
 *    explicit caller options (vi or en) disambiguate the language.
 * 4. If still undetermined, returns undefined (caller MUST NOT silently assume English or Vietnamese).
 */
export function resolveLanguage(
  text: string,
  options?: { language?: string }
): "vi" | "en" | undefined {
  let optionLang: "vi" | "en" | undefined;
  if (options?.language) {
    const raw = options.language.toLowerCase().trim();
    if (raw === "vi" || raw.startsWith("vi-")) {
      optionLang = "vi";
    } else if (raw === "en" || raw.startsWith("en-")) {
      optionLang = "en";
    } else if (raw !== "auto" && raw !== "default" && raw !== "") {
      return undefined;
    }
  }

  const detected = detectLanguage(text);

  // If text content provides clear language detection:
  if (detected) {
    // If no option or option agrees or option is "auto", return detected
    if (!optionLang || optionLang === detected) {
      return detected;
    }

    // If caller option conflicts with detected language:
    // Determine whether text is an unequivocal, substantial script of 'detected' language
    // vs a short loan phrase (e.g. "aspect ratio 16:9" where caller explicitly requested "vi").
    if (detected === "en") {
      const enWordMatches = text.match(ENGLISH_WORDS_REGEX);
      const enScore = enWordMatches ? enWordMatches.length : 0;
      // Strong English script: 3+ English words, or text contains English function words and NO Vietnamese markers
      if (enScore >= 3 || /\b(the|and|is|are|of|in|to|for|with|by|from|between|below|per)\b/i.test(text)) {
        return "en";
      }
    } else if (detected === "vi") {
      // Strong Vietnamese script: has Vietnamese diacritics or multiple Vietnamese words
      if (VIETNAMESE_UNIQUE_DIACRITICS_REGEX.test(text) || (text.match(VIETNAMESE_WORDS_REGEX)?.length ?? 0) >= 2) {
        return "vi";
      }
    }

    // For short isolated loan phrases (e.g. "aspect ratio 16:9"), respect caller's explicit option
    return optionLang;
  }

  // If text content alone cannot determine language (pure numbers / codes like "10:30"):
  if (optionLang) {
    return optionLang;
  }

  return undefined;
}

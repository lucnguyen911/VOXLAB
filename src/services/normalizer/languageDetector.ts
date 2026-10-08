/**
 * Language detection and resolution for Text Normalization.
 * 
 * Rules:
 * 1. Source language of project / caller takes precedence.
 * 2. If not specified or "auto", detect language from text content.
 * 3. NEVER take language from UI language or target translation language.
 * 4. NEVER hard-code an English default.
 * 5. If language cannot be determined with confidence, return undefined (do NOT silently fall back to English).
 */

const VIETNAMESE_DIACRITICS_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/u;

const VIETNAMESE_WORDS_REGEX =
  /\b(và|có|là|trong|không|cho|được|với|của|các|tại|việc|tạo|ra|giọng|nói|tự|nhiên|hệ|thống|xử|lý|thời|gian|lúc|ngày|tháng|năm|tỷ|tỉ|lệ|khung|hình|màn|chú|ý|kết|quả|bắt|đầu|phần|trăm|đồng|phút|giờ|giây|chia|bằng|phép|cộng|trừ|nhân)\b/iu;

const ENGLISH_WORDS_REGEX =
  /\b(a|an|the|and|is|are|was|were|be|been|have|has|had|do|does|did|will|would|shall|should|can|could|may|might|must|in|on|at|to|for|with|by|about|against|between|into|through|during|before|after|above|below|from|up|down|out|off|over|under|again|further|then|once|here|there|when|where|why|how|all|any|both|each|few|more|most|other|some|such|no|nor|not|only|own|same|so|than|too|very|just|now|this|that|these|those|project|projects|system|systems|consumes|costs|cost|increased|range|units|unit|supplier|remains|report|ratio|use|using|run|running|per|hour|hours|dollars|dollar|percent|megawatt|megawatts|kilometers)\b/giu;

/**
 * Detects whether the text is Vietnamese ("vi"), English ("en"), or undetermined (undefined).
 */
export function detectLanguage(text: string): "vi" | "en" | undefined {
  if (!text || !text.trim()) {
    return undefined;
  }

  // 1. Vietnamese diacritics check: unequivocal marker of Vietnamese text
  if (VIETNAMESE_DIACRITICS_REGEX.test(text)) {
    return "vi";
  }

  // 2. Distinctive Vietnamese words check
  const viWordMatches = text.match(VIETNAMESE_WORDS_REGEX);
  const viScore = viWordMatches ? viWordMatches.length : 0;

  // 3. English words check
  const enWordMatches = text.match(ENGLISH_WORDS_REGEX);
  const enScore = enWordMatches ? enWordMatches.length : 0;

  if (viScore > 0 && viScore >= enScore) {
    return "vi";
  }

  if (enScore > 0 && enScore > viScore) {
    return "en";
  }

  // 4. Cannot determine with confidence (e.g. only numbers, technical symbols, or unknown script)
  return undefined;
}

/**
 * Resolves effective language from explicit options or text detection.
 * If explicit language is "auto" or undefined, falls back to text detection.
 * If still undetermined, returns undefined (caller MUST NOT silently assume English).
 */
export function resolveLanguage(
  text: string,
  options?: { language?: string }
): "vi" | "en" | undefined {
  if (options?.language) {
    const raw = options.language.toLowerCase().trim();
    if (raw === "vi" || raw.startsWith("vi-")) {
      return "vi";
    }
    if (raw === "en" || raw.startsWith("en-")) {
      return "en";
    }
    if (raw !== "auto" && raw !== "default" && raw !== "") {
      // If a non-standard code is passed, check if it's explicitly vi or en
      return undefined;
    }
  }

  // Fallback to text content detection
  return detectLanguage(text);
}

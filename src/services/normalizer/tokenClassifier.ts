/**
 * Tokenizer & Classifier for Text Normalization.
 * 
 * Strict priority order for span classification:
 * 1. URL / Email
 * 2. IP address
 * 3. TIME (valid HH:MM, HH:MM:SS)
 * 4. DATE
 * 5. VERSION
 * 6. RATIO (context-validated)
 * 7. CURRENCY
 * 8. PERCENTAGE
 * 9. NUMBER + UNIT
 * 10. DECIMAL
 * 11. INTEGER
 * 12. PUNCTUATION
 * 
 * Once a span is classified, downstream rules MUST NOT re-normalize or split that span.
 */

export type TokenType =
  | "technical" // e.g. pronunciation markers VOX_PRON_P...XOV or [PAUSE ...]
  | "url"
  | "email"
  | "ip"
  | "time"
  | "date"
  | "version"
  | "ratio"
  | "division"
  | "range"
  | "year"
  | "currency"
  | "percentage"
  | "unit"
  | "decimal"
  | "integer"
  | "punctuation"
  | "text";

export interface ClassifiedToken {
  type: TokenType;
  raw: string;
  startIndex: number;
  endIndex: number;
  metadata?: Record<string, any>;
}

interface SpanCandidate {
  type: TokenType;
  raw: string;
  startIndex: number;
  endIndex: number;
  priority: number; // Lower number = higher priority
  metadata?: Record<string, any>;
}

// Regex definitions
const URL_REGEX = /(?:https?:\/\/[^\s]+|www\.[^\s]+)/giu;
const EMAIL_REGEX = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/gu;
const IP_REGEX = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/gu;

// Internal placeholders (Priority 0)
const PLACEHOLDER_REGEX =
  /(?:VOX_PRON_P\d+_XOV|\[(?:PAUSE|pause)\s+\d+(?:\.\d+)?\s*(?:ms|s)?\]|VOX[a-z0-9]+P\d+XOV)/gu;

// Technical patterns, filenames, model names (Priority 6.1, after URL/Email/IP/Time/Date/Version/Ratio)
const TECHNICAL_PATTERNS_REGEX =
  /(?:\b[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.(?:com|net|org|io|ai|dev|app|edu|gov|vn|info|biz|me|co|tech|online|site|xyz|js|ts|json|html|css|py|rs|go|cpp|c|h|md|txt|wav|mp3|ogg|flac|png|jpg|jpeg|gif|svg|webp|pdf)\b|\b(?:Dr|Mr|Mrs|Ms|Prof|Rev|Gen|Sen|Rep|St|Jr|Sr)\.(?:[A-Z][a-zA-Z]+|(?=\s|$|[,/:;!?)[\]]))|\b[A-Z](?:\.[A-Z])+(?:\.(?![\p{L}])|\b)|\b[A-Z][a-z]?\.[A-Z][a-z]?(?:\.[A-Z][a-z]?)?(?:\.(?![\p{L}])|\b)|\b[A-Za-z0-9_-]*[A-Za-z][A-Za-z0-9_-]*-[0-9]+[A-Za-z0-9_-]*\b|\b[A-Za-z]+[0-9]+[A-Za-z0-9_-]*\b|\b\d+\/\d+\b|\b(?:e\.g|i\.e|etc|vs|al|a\.m|p\.m|E\.G|I\.E)(?:\.(?![\p{L}])|\b))/gu;

const VERSION_REGEX = /\bv\d+(?:\.\d+)+(?:-[a-zA-Z0-9._-]+)?\b/giu;

const RATIO_PRE_CONTEXT_REGEX =
  /(?:(?:tỷ|tỉ)\s*lệ(?:\s+khung\s*hình)?|(?:ty|ti)\s*le(?:\s+khung\s*hinh)?|(?:tỷ|tỉ)\s*số|(?:ty|ti)\s*so|khung\s*hình|khung\s*hinh|màn\s*hình|man\s*hinh|aspect\s*ratio|ratio|độ\s*phân\s*giải|do\s*phan\s*giai)(?:\s+(?:chuẩn|tiêu\s*chuẩn|mặc\s*định|là|ở|đạt|của|rộng|hình\s*ảnh))?\s*$/iu;

const RATIO_POST_CONTEXT_REGEX =
  /^\s*(?:aspect\s*ratio|ratio|khung\s*hình|khung\s*hinh|màn\s*hình|man\s*hinh)/iu;

const DIVISION_PRE_CONTEXT_REGEX =
  /(?:phép\s*chia|phep\s*chia|phép\s*toán\s*chia|toán\s*chia|phép\s*tính(?:\s*chia)?|phep\s*tinh|chia(?:\s*cho)?|division(?:\s*of)?|divide)\s*$/iu;

const DIVISION_POST_CONTEXT_REGEX =
  /^\s*(?:=|bằng|bang|equals?|ra\s*kết\s*quả|kết\s*quả|is\s*equal\s*to)/iu;

const TIME_CONTEXT_REGEX =
  /(?:lúc|luc|vào|vao|thời\s*gian|thoi\s*gian|cuộc\s*họp\s*lúc|cuoc\s*hop\s*luc|hồi|hoi|đến|den|từ|tu|at|from|to|until|meeting\s*at|time)\s*$/iu;

const DATE_REGEX_YMD = /\b(\d{4})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/gu;
const DATE_REGEX_DMY = /\b(0[1-9]|[12]\d|3[01])[-/](0[1-9]|1[0-2])[-/](\d{4})\b/gu;

const CURRENCY_VN_REGEX = /(\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\b\d+)\s*(₫|đ|VND|vnd|đồng)(?![\p{L}\p{N}])/gu;
const CURRENCY_US_REGEX = /(\ba\s+|\ban\s+|\bthe\s+|\bthis\s+|\bthat\s+)?\$(\d+(?:,\d+)*(?:\.\d+)?)\s*([BMKbmk](?![\p{L}\p{N}]))?(?:\s+([a-zA-Z]+))?/gu;
const CURRENCY_SYMBOL_PREFIX_REGEX = /([€£¥])\s*(\d+(?:[.,]\d+)*)/gu;

const PERCENTAGE_REGEX = /(\b\d+(?:[.,]\d+)?)\s*%/gu;

// Unit regex with Unicode negative lookahead to strictly avoid matching Vietnamese words like "30 mà" -> "m"
const UNIT_KEYS = [
  "MW", "kW", "GW", "W",
  "km\\/h", "km", "cm", "mm", "m",
  "kg", "g",
  "kWh", "MWh",
  "GHz", "MHz", "kHz", "Hz",
  "V", "A", "hp",
  "°C", "°F"
].join("|");

const UNIT_REGEX = new RegExp(
  `(\\ba\\s+|\\ban\\s+|\\bthe\\s+|\\bthis\\s+|\\bthat\\s+)?(\\b\\d+(?:[.,]\\d+)?)\\s*(${UNIT_KEYS})(?![\\p{L}\\p{N}])(?:\\s+([a-zA-Z]+))?`,
  "gu"
);

/**
 * Validates whether HH:MM or HH:MM:SS is a valid time.
 */
function parseTimeMatch(matchStr: string): { valid: boolean; hour: number; minute: number; second?: number } {
  const parts = matchStr.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return { valid: false, hour: 0, minute: 0 };
  }
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  const second = parts.length === 3 ? parseInt(parts[2], 10) : undefined;

  // Strict 2-digit requirement for minute and second
  if (parts[1].length !== 2) {
    return { valid: false, hour, minute };
  }
  if (parts.length === 3 && parts[2].length !== 2) {
    return { valid: false, hour, minute };
  }

  if (isNaN(hour) || hour < 0 || hour > 23) {
    return { valid: false, hour, minute };
  }
  if (isNaN(minute) || minute < 0 || minute > 59) {
    return { valid: false, hour, minute };
  }
  if (second !== undefined && (isNaN(second) || second < 0 || second > 59)) {
    return { valid: false, hour, minute };
  }

  return { valid: true, hour, minute, second };
}

/**
 * Classifies text into non-overlapping typed tokens according to strict priority order.
 */
export function classifyTextTokens(text: string): ClassifiedToken[] {
  if (!text) return [];

  const candidates: SpanCandidate[] = [];

  // Helper to add candidate
  const addCandidate = (
    type: TokenType,
    raw: string,
    startIndex: number,
    endIndex: number,
    priority: number,
    metadata?: Record<string, any>
  ) => {
    candidates.push({ type, raw, startIndex, endIndex, priority, metadata });
  };

  // Priority 0: Internal placeholders (pronunciations, pauses)
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_REGEX.exec(text)) !== null) {
    addCandidate("technical", m[0], m.index, m.index + m[0].length, 0);
  }

  // Priority 1: URL & Email
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    // Strip trailing punctuation like period, comma if glued
    let raw = m[0];
    let end = m.index + raw.length;
    while (/[.,;:!?]$/.test(raw)) {
      raw = raw.slice(0, -1);
      end--;
    }
    addCandidate("url", raw, m.index, end, 1);
  }

  EMAIL_REGEX.lastIndex = 0;
  while ((m = EMAIL_REGEX.exec(text)) !== null) {
    let raw = m[0];
    let end = m.index + raw.length;
    while (/[.,;:!?]$/.test(raw)) {
      raw = raw.slice(0, -1);
      end--;
    }
    addCandidate("email", raw, m.index, end, 1);
  }

  // Priority 2: IP address
  IP_REGEX.lastIndex = 0;
  while ((m = IP_REGEX.exec(text)) !== null) {
    addCandidate("ip", m[0], m.index, m.index + m[0].length, 2);
  }

  // Priority 3 & 6: Colon expressions: TIME vs RATIO vs DIVISION vs PUNCTUATION
  // Find all patterns of digits:digits(:digits)?
  const colonNumberRegex = /\b(\d{1,4}):(\d{1,4})(?::(\d{1,2}))?\b/gu;
  while ((m = colonNumberRegex.exec(text)) !== null) {
    const raw = m[0];
    const startIndex = m.index;
    const endIndex = startIndex + raw.length;
    const precedingSlice = text.slice(Math.max(0, startIndex - 35), startIndex);
    const followingSlice = text.slice(endIndex, Math.min(text.length, endIndex + 25));

    const hasRatioContext =
      RATIO_PRE_CONTEXT_REGEX.test(precedingSlice) || RATIO_POST_CONTEXT_REGEX.test(followingSlice);
    const hasDivisionContext =
      DIVISION_PRE_CONTEXT_REGEX.test(precedingSlice) || DIVISION_POST_CONTEXT_REGEX.test(followingSlice);
    const hasTimeContext = TIME_CONTEXT_REGEX.test(precedingSlice);

    const timeCheck = parseTimeMatch(raw);

    if (hasRatioContext) {
      // Confirmed RATIO: tỷ lệ 16:9, khung hình 16:9, màn hình 16:9, aspect ratio 16:9
      const parts = raw.split(":");
      addCandidate("ratio", raw, startIndex, endIndex, 6, {
        antecedent: parts[0],
        consequent: parts[1],
      });
    } else if (hasDivisionContext) {
      // Confirmed DIVISION: 16:9 = ..., phép chia 16:9
      const parts = raw.split(":");
      addCandidate("division", raw, startIndex, endIndex, 6, {
        antecedent: parts[0],
        consequent: parts[1],
      });
    } else if (timeCheck.valid) {
      // Confirmed TIME (valid 24h clock, e.g. 10:30, 09:05, 23:59, 10:30:45)
      addCandidate("time", raw, startIndex, endIndex, 3, {
        hour: timeCheck.hour,
        minute: timeCheck.minute,
        second: timeCheck.second,
      });
    } else if (hasTimeContext && timeCheck.valid) {
      addCandidate("time", raw, startIndex, endIndex, 3, {
        hour: timeCheck.hour,
        minute: timeCheck.minute,
        second: timeCheck.second,
      });
    } else {
      // Ambiguous token without sufficient context: do not guess. Keep raw token.
    }
  }

  // Priority 4: DATE
  DATE_REGEX_YMD.lastIndex = 0;
  while ((m = DATE_REGEX_YMD.exec(text)) !== null) {
    addCandidate("date", m[0], m.index, m.index + m[0].length, 4, {
      year: parseInt(m[1], 10),
      month: parseInt(m[2], 10),
      day: parseInt(m[3], 10),
      format: "YMD",
    });
  }

  DATE_REGEX_DMY.lastIndex = 0;
  while ((m = DATE_REGEX_DMY.exec(text)) !== null) {
    addCandidate("date", m[0], m.index, m.index + m[0].length, 4, {
      day: parseInt(m[1], 10),
      month: parseInt(m[2], 10),
      year: parseInt(m[3], 10),
      format: "DMY",
    });
  }

  // Priority 5: VERSION
  VERSION_REGEX.lastIndex = 0;
  while ((m = VERSION_REGEX.exec(text)) !== null) {
    addCandidate("version", m[0], m.index, m.index + m[0].length, 5);
  }

  // Priority 6.1: Technical patterns (filenames, model names, abbreviations)
  TECHNICAL_PATTERNS_REGEX.lastIndex = 0;
  while ((m = TECHNICAL_PATTERNS_REGEX.exec(text)) !== null) {
    addCandidate("technical", m[0], m.index, m.index + m[0].length, 6.1);
  }

  // Priority 6.2: RANGE (e.g. 10-15)
  const rangeRegex = /(?<=\s|^|\()(\d+)-(\d+)(?=\s+[a-zA-Z\p{L}]+|[\s\p{P}]|$)/gu;
  while ((m = rangeRegex.exec(text)) !== null) {
    addCandidate("range", m[0], m.index, m.index + m[0].length, 6.2, {
      start: m[1],
      end: m[2],
    });
  }

  // Priority 6.4: YEAR in context (e.g. in 2021, năm 2021)
  const yearContextRegex = /\b(in|since|by|during|year|from|until|to|between|and|năm)\s+(19\d{2}|20\d{2})\b/giu;
  while ((m = yearContextRegex.exec(text)) !== null) {
    const prep = m[1];
    const yearStr = m[2];
    const yearStart = m.index + prep.length + 1;
    addCandidate("year", yearStr, yearStart, yearStart + yearStr.length, 6.4, {
      year: yearStr,
    });
  }

  // Priority 7: CURRENCY
  CURRENCY_VN_REGEX.lastIndex = 0;
  while ((m = CURRENCY_VN_REGEX.exec(text)) !== null) {
    addCandidate("currency", m[0], m.index, m.index + m[0].length, 7, {
      value: m[1],
      currency: m[2],
    });
  }

  CURRENCY_US_REGEX.lastIndex = 0;
  while ((m = CURRENCY_US_REGEX.exec(text)) !== null) {
    const article = m[1];
    const numStr = m[2];
    const scale = m[3];
    const followingWord = m[4];
    // Keep article and following word outside of the currency token itself
    const currencyStr = `$${numStr}${scale ? scale : ""}`;
    const tokenStart = m.index + (article ? article.length : 0);
    const tokenEnd = tokenStart + currencyStr.length;
    addCandidate("currency", currencyStr, tokenStart, tokenEnd, 7, {
      value: numStr,
      scale: scale ?? "",
      currency: "$",
      isAttributive: Boolean(article && followingWord),
    });
  }

  CURRENCY_SYMBOL_PREFIX_REGEX.lastIndex = 0;
  while ((m = CURRENCY_SYMBOL_PREFIX_REGEX.exec(text)) !== null) {
    addCandidate("currency", m[0], m.index, m.index + m[0].length, 7, {
      currency: m[1],
      value: m[2],
    });
  }

  // Priority 8: PERCENTAGE
  PERCENTAGE_REGEX.lastIndex = 0;
  while ((m = PERCENTAGE_REGEX.exec(text)) !== null) {
    addCandidate("percentage", m[0], m.index, m.index + m[0].length, 8, {
      value: m[1],
    });
  }

  // Priority 9: NUMBER + UNIT
  UNIT_REGEX.lastIndex = 0;
  while ((m = UNIT_REGEX.exec(text)) !== null) {
    const article = m[1];
    const numStr = m[2];
    const unitKey = m[3];
    const followingWord = m[4];
    const tokenStart = m.index + (article ? article.length : 0);
    const rawSpan = m[0].slice(article ? article.length : 0, followingWord ? m[0].lastIndexOf(followingWord) : undefined).trimEnd();
    addCandidate("unit", rawSpan, tokenStart, tokenStart + rawSpan.length, 9, {
      value: numStr,
      unit: unitKey,
      isAttributive: Boolean(article && followingWord),
    });
  }

  // Priority 10: DECIMAL & FORMATTED NUMBERS
  // 10a: Formatted numbers with thousands separators and optional decimals (e.g. 12,000.50 or 12.000,50 or 15,000)
  const formattedNumberRegex = /\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b/gu;
  while ((m = formattedNumberRegex.exec(text)) !== null) {
    addCandidate("integer", m[0], m.index, m.index + m[0].length, 10, {
      value: m[0],
    });
  }

  // 10b: Simple decimals (e.g. 3.14, 1.2, 1,5)
  const decimalRegex = /\b(\d+)([.,])(\d+)\b/gu;
  while ((m = decimalRegex.exec(text)) !== null) {
    const intPart = m[1];
    const sep = m[2];
    const fracPart = m[3];
    if (fracPart.length === 3 && (text[m.index + m[0].length] === sep || /^\d{1,3}$/.test(intPart))) {
      continue;
    }
    addCandidate("decimal", m[0], m.index, m.index + m[0].length, 10.2, {
      intPart,
      fracPart,
      separator: sep,
    });
  }

  // Priority 11: INTEGER
  // Standalone integers (e.g. 2, 25, 100)
  const standaloneIntRegex = /\b\d+\b/gu;
  while ((m = standaloneIntRegex.exec(text)) !== null) {
    addCandidate("integer", m[0], m.index, m.index + m[0].length, 11, {
      value: m[0],
    });
  }

  // Priority 12: PUNCTUATION
  const punctRegex = /([.,:;!?…]+)/gu;
  while ((m = punctRegex.exec(text)) !== null) {
    addCandidate("punctuation", m[0], m.index, m.index + m[0].length, 12);
  }

  // Resolve overlaps by strict priority:
  // Sort candidates by priority (lower number = higher priority), then by length descending
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Longer spans preferred within same priority
    return (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex);
  });

  const occupied = new Uint8Array(text.length);
  const acceptedSpans: SpanCandidate[] = [];

  for (const cand of candidates) {
    let hasOverlap = false;
    for (let i = cand.startIndex; i < cand.endIndex; i++) {
      if (occupied[i] === 1) {
        hasOverlap = true;
        break;
      }
    }
    if (!hasOverlap) {
      for (let i = cand.startIndex; i < cand.endIndex; i++) {
        occupied[i] = 1;
      }
      acceptedSpans.push(cand);
    }
  }

  // Sort accepted spans by startIndex
  acceptedSpans.sort((a, b) => a.startIndex - b.startIndex);

  // Fill in gaps with TEXT tokens
  const finalTokens: ClassifiedToken[] = [];
  let currentIdx = 0;

  for (const span of acceptedSpans) {
    if (span.startIndex > currentIdx) {
      finalTokens.push({
        type: "text",
        raw: text.slice(currentIdx, span.startIndex),
        startIndex: currentIdx,
        endIndex: span.startIndex,
      });
    }
    finalTokens.push({
      type: span.type,
      raw: span.raw,
      startIndex: span.startIndex,
      endIndex: span.endIndex,
      metadata: span.metadata,
    });
    currentIdx = span.endIndex;
  }

  if (currentIdx < text.length) {
    finalTokens.push({
      type: "text",
      raw: text.slice(currentIdx),
      startIndex: currentIdx,
      endIndex: text.length,
    });
  }

  return finalTokens;
}

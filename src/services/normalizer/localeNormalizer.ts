/**
 * Locale-aware normalizer engine.
 * 
 * Rules:
 * - All normalization rules depend on source language ("vi" or "en").
 * - If language is not determined (undefined), tokens are PRESERVED as-is.
 * - Under NO circumstance does it silently default to English.
 */

import { ClassifiedToken } from "./tokenClassifier";

// --- Vietnamese Number to Words Implementation ---

const VI_DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

function vietnameseSmallIntToWords(n: number): string {
  if (n < 10) {
    return VI_DIGITS[n];
  }
  if (n === 10) {
    return "mười";
  }
  if (n < 20) {
    const unit = n % 10;
    if (unit === 5) return "mười lăm";
    return `mười ${VI_DIGITS[unit]}`;
  }

  const tens = Math.floor(n / 10);
  const unit = n % 10;
  const tensWord = `${VI_DIGITS[tens]} mươi`;

  if (unit === 0) return tensWord;
  if (unit === 1) return `${tensWord} mốt`;
  if (unit === 4) return `${tensWord} tư`;
  if (unit === 5) return `${tensWord} lăm`;
  return `${tensWord} ${VI_DIGITS[unit]}`;
}

export function vietnameseIntegerToWords(n: number | string): string {
  let numStr = typeof n === "number" ? Math.floor(n).toString() : n.replace(/[,\s]/g, "");
  if (!/^-?\d+$/.test(numStr)) return String(n);

  let isNegative = false;
  if (numStr.startsWith("-")) {
    isNegative = true;
    numStr = numStr.slice(1);
  }

  // Remove leading zeros
  numStr = numStr.replace(/^0+/, "");
  if (!numStr) return "không";

  const num = parseInt(numStr, 10);
  if (num < 100) {
    const res = vietnameseSmallIntToWords(num);
    return isNegative ? `âm ${res}` : res;
  }

  // Group into 3-digit groups from right to left
  const groups: number[] = [];
  let s = numStr;
  while (s.length > 0) {
    const chunk = s.slice(Math.max(0, s.length - 3));
    groups.unshift(parseInt(chunk, 10));
    s = s.slice(0, Math.max(0, s.length - 3));
  }

  const scales = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];
  const parts: string[] = [];

  for (let i = 0; i < groups.length; i++) {
    const val = groups[i];
    const scaleIdx = groups.length - 1 - i;
    if (val === 0) continue;

    const hundreds = Math.floor(val / 100);
    const rem = val % 100;
    let groupText = "";

    if (hundreds > 0) {
      groupText = `${VI_DIGITS[hundreds]} trăm`;
      if (rem > 0) {
        if (rem < 10) {
          groupText += ` lẻ ${VI_DIGITS[rem]}`;
        } else {
          groupText += ` ${vietnameseSmallIntToWords(rem)}`;
        }
      }
    } else {
      if (parts.length > 0) {
        // e.g. 1,005 -> một nghìn không trăm lẻ năm
        groupText = `không trăm`;
        if (rem < 10) {
          groupText += ` lẻ ${VI_DIGITS[rem]}`;
        } else {
          groupText += ` ${vietnameseSmallIntToWords(rem)}`;
        }
      } else {
        groupText = vietnameseSmallIntToWords(rem);
      }
    }

    const scale = scales[scaleIdx] || "";
    if (scale) {
      parts.push(`${groupText} ${scale}`);
    } else {
      parts.push(groupText);
    }
  }

  const full = parts.join(" ").trim();
  return isNegative ? `âm ${full}` : full;
}

export function vietnameseDecimalToWords(str: string): string {
  const clean = str.replace(/,/g, ".");
  const [intPart, fracPart] = clean.split(".");
  const intWords = vietnameseIntegerToWords(intPart || "0");

  if (!fracPart) return intWords;

  // Single digit fraction: e.g. 1.5 -> một phẩy năm
  if (fracPart.length === 1) {
    return `${intWords} phẩy ${VI_DIGITS[parseInt(fracPart, 10)]}`;
  }

  // Multiple digits: read digit by digit (e.g. 3.14 -> ba phẩy một bốn)
  const fracWords = fracPart
    .split("")
    .map((d) => VI_DIGITS[parseInt(d, 10)] ?? d)
    .join(" ");

  return `${intWords} phẩy ${fracWords}`;
}

// --- English Number to Words Implementation ---

const EN_WORDS_UNDER_20 = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];

const EN_WORDS_TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];

function englishSmallIntToWords(n: number): string {
  if (n < 20) return EN_WORDS_UNDER_20[n];
  const ten = Math.floor(n / 10);
  const rem = n % 10;
  return rem > 0 ? `${EN_WORDS_TENS[ten]} ${EN_WORDS_UNDER_20[rem]}` : EN_WORDS_TENS[ten];
}

export function englishNumberToWords(n: number | string): string {
  let num = typeof n === "string" ? parseInt(n.replace(/,/g, ""), 10) : Math.floor(n);
  if (isNaN(num)) return String(n);
  if (num === 0) return "zero";
  if (num < 0) return "minus " + englishNumberToWords(Math.abs(num));

  const parts: string[] = [];

  const billions = Math.floor(num / 1000000000);
  num %= 1000000000;
  if (billions > 0) parts.push(`${englishNumberToWords(billions)} billion`);

  const millions = Math.floor(num / 1000000);
  num %= 1000000;
  if (millions > 0) parts.push(`${englishNumberToWords(millions)} million`);

  const thousands = Math.floor(num / 1000);
  num %= 1000;
  if (thousands > 0) parts.push(`${englishNumberToWords(thousands)} thousand`);

  const hundreds = Math.floor(num / 100);
  const remainder = num % 100;
  if (hundreds > 0) {
    if (remainder > 0) {
      if (remainder < 20) {
        parts.push(`${EN_WORDS_UNDER_20[hundreds]} hundred and ${englishSmallIntToWords(remainder)}`);
      } else {
        parts.push(`${EN_WORDS_UNDER_20[hundreds]} hundred ${englishSmallIntToWords(remainder)}`);
      }
    } else {
      parts.push(`${EN_WORDS_UNDER_20[hundreds]} hundred`);
    }
  } else if (remainder > 0) {
    parts.push(englishSmallIntToWords(remainder));
  }

  return parts.join(" ");
}

export function englishDecimalToWords(str: string): string {
  const [intPart, decPart] = str.replace(/,/g, ".").split(".");
  const intWords = englishNumberToWords(intPart || "0");
  if (!decPart) return intWords;
  const decWords = decPart
    .split("")
    .map((d) => EN_WORDS_UNDER_20[parseInt(d, 10)] ?? d)
    .join(" ");
  return `${intWords} point ${decWords}`;
}

// --- Unit Dictionaries ---

const VI_UNIT_MAP: Record<string, string> = {
  kg: "ki-lô-gam",
  g: "gam",
  "km/h": "ki-lô-mét trên giờ",
  km: "ki-lô-mét",
  m: "mét",
  cm: "xen-ti-mét",
  mm: "mi-li-mét",
  "°C": "độ C",
  "°F": "độ F",
  MW: "mê-ga-oát",
  kW: "ki-lô-oát",
  W: "oát",
  GW: "ghi-ga-oát",
  kWh: "ki-lô-oát giờ",
  MWh: "mê-ga-oát giờ",
  Hz: "héc",
  kHz: "ki-lô-héc",
  MHz: "mê-ga-héc",
  GHz: "ghi-ga-héc",
  V: "vôn",
  A: "am-pe",
  hp: "mã lực",
};

const EN_UNIT_MAP: Record<string, { singular: string; plural: string }> = {
  MW: { singular: "megawatt", plural: "megawatts" },
  kW: { singular: "kilowatt", plural: "kilowatts" },
  GW: { singular: "gigawatt", plural: "gigawatts" },
  W: { singular: "watt", plural: "watts" },
  km: { singular: "kilometer", plural: "kilometers" },
  "km/h": { singular: "kilometer per hour", plural: "kilometers per hour" },
  m: { singular: "meter", plural: "meters" },
  cm: { singular: "centimeter", plural: "centimeters" },
  mm: { singular: "millimeter", plural: "millimeters" },
  kg: { singular: "kilogram", plural: "kilograms" },
  g: { singular: "gram", plural: "grams" },
  kWh: { singular: "kilowatt hour", plural: "kilowatt hours" },
  MWh: { singular: "megawatt hour", plural: "megawatt hours" },
  Hz: { singular: "hertz", plural: "hertz" },
  GHz: { singular: "gigahertz", plural: "gigahertz" },
  MHz: { singular: "megahertz", plural: "megahertz" },
  kHz: { singular: "kilohertz", plural: "kilohertz" },
  V: { singular: "volt", plural: "volts" },
  A: { singular: "amp", plural: "amps" },
  hp: { singular: "horsepower", plural: "horsepower" },
  "°C": { singular: "degree Celsius", plural: "degrees Celsius" },
  "°F": { singular: "degree Fahrenheit", plural: "degrees Fahrenheit" },
};

// --- Exported Normalizers ---

export function normalizeNumber(value: number | string, language?: string): string {
  const valStr = String(value).trim();
  if (language === "vi") {
    // If it has thousands separator (e.g. 15,000 or 15.000 or 150,000):
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(valStr)) {
      return vietnameseIntegerToWords(valStr);
    }
    if (valStr.includes(".") || valStr.includes(",")) {
      return vietnameseDecimalToWords(valStr);
    }
    return vietnameseIntegerToWords(valStr);
  }
  if (language === "en") {
    if (/^\d{1,3}(?:,\d{3})+$/.test(valStr)) {
      return englishNumberToWords(valStr);
    }
    if (valStr.includes(".")) {
      return englishDecimalToWords(valStr);
    }
    return englishNumberToWords(valStr);
  }
  // Undetermined language: preserve token
  return valStr;
}

export function normalizeUnit(
  value: number | string,
  unit: string,
  language?: string,
  options?: { isAttributive?: boolean }
): string {
  const valStr = String(value).trim();
  if (language === "vi") {
    const numWords = normalizeNumber(valStr, "vi");
    const unitWord = VI_UNIT_MAP[unit] ?? unit;
    return `${numWords} ${unitWord}`;
  }
  if (language === "en") {
    const numWords = normalizeNumber(valStr, "en");
    const info = EN_UNIT_MAP[unit];
    if (!info) return `${numWords} ${unit}`;
    const unitWord = options?.isAttributive || valStr === "1" ? info.singular : info.plural;
    return `${numWords} ${unitWord}`;
  }
  // Undetermined language: preserve token
  return `${valStr} ${unit}`;
}

export function normalizeCurrency(
  value: number | string,
  currency: string,
  language?: string,
  options?: { scale?: string; isAttributive?: boolean }
): string {
  const valStr = String(value).trim();
  const scale = options?.scale ? options.scale.toUpperCase() : "";

  if (language === "vi") {
    const numWords = normalizeNumber(valStr, "vi");
    let scaleWord = "";
    if (scale === "B") scaleWord = "tỷ";
    else if (scale === "M") scaleWord = "triệu";
    else if (scale === "K") scaleWord = "nghìn";

    let currWord = "đồng";
    if (currency === "$" || currency.toUpperCase() === "USD") currWord = "đô la";
    else if (currency === "€" || currency.toUpperCase() === "EUR") currWord = "euro";
    else if (currency === "£" || currency.toUpperCase() === "GBP") currWord = "bảng Anh";
    else if (currency === "¥" || currency.toUpperCase() === "JPY") currWord = "yên";

    if (scaleWord) {
      return `${numWords} ${scaleWord} ${currWord}`;
    }
    return `${numWords} ${currWord}`;
  }

  if (language === "en") {
    const numWords = normalizeNumber(valStr, "en");
    let scaleWord = "";
    if (scale === "B") scaleWord = "billion";
    else if (scale === "M") scaleWord = "million";
    else if (scale === "K") scaleWord = "thousand";

    let unitWord = options?.isAttributive || (!scale && valStr === "1") ? "dollar" : "dollars";
    if (currency === "€") unitWord = "euros";
    else if (currency === "£") unitWord = "pounds";

    if (scaleWord) {
      return `${numWords} ${scaleWord} ${unitWord}`;
    }
    return `${numWords} ${unitWord}`;
  }

  // Undetermined language: preserve
  return `${currency}${valStr}${scale ? scale : ""}`;
}

export function normalizeTime(timeStr: string, language?: string): string {
  const parts = timeStr.split(":");
  if (parts.length < 2 || parts.length > 3) return timeStr;

  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parts.length === 3 ? parseInt(parts[2], 10) : undefined;

  if (isNaN(h) || h < 0 || h > 23 || isNaN(m) || m < 0 || m > 59) {
    return timeStr;
  }
  if (s !== undefined && (isNaN(s) || s < 0 || s > 59)) {
    return timeStr;
  }

  if (language === "vi") {
    const hWords = VI_DIGITS[h] ?? vietnameseIntegerToWords(h);
    // Explicit user rule: 09:05 -> "chín giờ năm phút"
    const mWords = m < 10 ? VI_DIGITS[m] : vietnameseIntegerToWords(m);

    let res = "";
    if (m === 0 && s === undefined) {
      res = `${hWords} giờ`;
    } else {
      res = `${hWords} giờ ${mWords} phút`;
    }

    if (s !== undefined && s > 0) {
      const sWords = s < 10 ? VI_DIGITS[s] : vietnameseIntegerToWords(s);
      res += ` ${sWords} giây`;
    }
    return res;
  }

  if (language === "en") {
    const hWords = englishNumberToWords(h);
    let mWords = "";
    if (m === 0) {
      mWords = "o'clock";
    } else if (m < 10) {
      mWords = `oh ${EN_WORDS_UNDER_20[m]}`;
    } else {
      mWords = englishSmallIntToWords(m);
    }
    let res = `${hWords} ${mWords}`;
    if (s !== undefined && s > 0) {
      res += ` and ${englishNumberToWords(s)} seconds`;
    }
    return res;
  }

  // Undetermined language: preserve
  return timeStr;
}

export function normalizeDate(dateStr: string, language?: string): string {
  if (language === "vi") {
    // Format YYYY-MM-DD or DD/MM/YYYY
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split("-");
      return `ngày ${parseInt(d, 10)} tháng ${parseInt(m, 10)} năm ${y}`;
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
      const [d, m, y] = dateStr.split("/");
      return `ngày ${parseInt(d, 10)} tháng ${parseInt(m, 10)} năm ${y}`;
    }
  }
  return dateStr;
}

export function normalizePercent(value: number | string, language?: string): string {
  const valStr = String(value).trim();
  if (language === "vi") {
    const numWords = normalizeNumber(valStr, "vi");
    return `${numWords} phần trăm`;
  }
  if (language === "en") {
    const numWords = normalizeNumber(valStr, "en");
    return `${numWords} percent`;
  }
  return `${valStr}%`;
}

export function normalizeRatio(ratioStr: string, language?: string): string {
  const parts = ratioStr.split(":");
  if (parts.length !== 2) return ratioStr;

  const ant = parts[0].trim();
  const cons = parts[1].trim();

  if (language === "vi") {
    const antWords = normalizeNumber(ant, "vi");
    const consWords = normalizeNumber(cons, "vi");
    return `${antWords} trên ${consWords}`;
  }
  if (language === "en") {
    const antWords = normalizeNumber(ant, "en");
    const consWords = normalizeNumber(cons, "en");
    return `${antWords} to ${consWords}`;
  }
  return ratioStr;
}

export function normalizeDivision(divStr: string, language?: string): string {
  const delimiter = divStr.includes(":") ? ":" : divStr.includes("/") ? "/" : "";
  if (!delimiter) return divStr;
  const parts = divStr.split(delimiter);
  if (parts.length !== 2) return divStr;

  const ant = parts[0].trim();
  const cons = parts[1].trim();

  if (language === "vi") {
    const antWords = normalizeNumber(ant, "vi");
    const consWords = normalizeNumber(cons, "vi");
    return `${antWords} chia ${consWords}`;
  }
  if (language === "en") {
    const antWords = normalizeNumber(ant, "en");
    const consWords = normalizeNumber(cons, "en");
    return `${antWords} divided by ${consWords}`;
  }
  return divStr;
}

export function englishYearToWords(yearStr: string): string {
  const y = parseInt(yearStr, 10);
  if (isNaN(y)) return yearStr;
  const century = Math.floor(y / 100);
  const rem = y % 100;
  if (y >= 2000 && y <= 2009) {
    if (rem === 0) return "two thousand";
    return `two thousand ${EN_WORDS_UNDER_20[rem]}`;
  }
  const centuryWords = englishSmallIntToWords(century);
  let remWords = "";
  if (rem === 0) {
    remWords = "hundred";
  } else if (rem < 10) {
    remWords = `zero ${EN_WORDS_UNDER_20[rem]}`;
  } else {
    remWords = englishSmallIntToWords(rem);
  }
  return `${centuryWords} ${remWords}`;
}

export function normalizeRange(rangeStr: string, language?: string): string {
  const parts = rangeStr.split("-");
  if (parts.length !== 2) return rangeStr;
  const start = parts[0].trim();
  const end = parts[1].trim();
  if (language === "vi") {
    return `${normalizeNumber(start, "vi")} đến ${normalizeNumber(end, "vi")}`;
  }
  if (language === "en") {
    return `${normalizeNumber(start, "en")} to ${normalizeNumber(end, "en")}`;
  }
  return rangeStr;
}

export function normalizeYear(yearStr: string, language?: string): string {
  if (language === "en") {
    return englishYearToWords(yearStr);
  }
  if (language === "vi") {
    return normalizeNumber(yearStr, "vi");
  }
  return yearStr;
}

export function normalizeVersion(versionStr: string, _language?: string): string {
  // Version is a protected structured token (v2.0, v1.2.3).
  // Kept intact and protected from decimal rules.
  return versionStr;
}

/**
 * Normalizes an array of classified tokens into final speech-ready text.
 */
export function normalizeTokens(tokens: ClassifiedToken[], language?: string): string {
  const result: string[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "time":
        result.push(normalizeTime(token.raw, language));
        break;
      case "ratio":
        result.push(normalizeRatio(token.raw, language));
        break;
      case "division":
        result.push(normalizeDivision(token.raw, language));
        break;
      case "range":
        result.push(normalizeRange(token.raw, language));
        break;
      case "year":
        result.push(normalizeYear(token.raw, language));
        break;
      case "currency":
        if (token.metadata?.scale) {
          result.push(
            normalizeCurrency(token.metadata.value, token.metadata.currency ?? "$", language, {
              scale: token.metadata.scale,
              isAttributive: token.metadata.isAttributive,
            })
          );
        } else {
          result.push(
            normalizeCurrency(
              token.metadata?.value ?? token.raw,
              token.metadata?.currency ?? "",
              language,
              { isAttributive: token.metadata?.isAttributive }
            )
          );
        }
        break;
      case "percentage":
        result.push(normalizePercent(token.metadata?.value ?? token.raw.replace("%", ""), language));
        break;
      case "unit":
        result.push(
          normalizeUnit(token.metadata?.value, token.metadata?.unit, language, {
            isAttributive: token.metadata?.isAttributive,
          })
        );
        break;
      case "decimal":
        result.push(normalizeNumber(token.raw, language));
        break;
      case "integer":
        result.push(normalizeNumber(token.raw, language));
        break;
      case "date":
        result.push(normalizeDate(token.raw, language));
        break;
      case "version":
        result.push(normalizeVersion(token.raw, language));
        break;
      case "ip":
      case "url":
      case "email":
      case "technical":
      case "punctuation":
      case "text":
      default:
        result.push(token.raw);
        break;
    }
  }

  return result.join("");
}

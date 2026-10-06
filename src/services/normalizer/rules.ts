import { NormalizerGroup, NormalizerGroupId } from "./types";

export const NORMALIZER_GROUPS: NormalizerGroup[] = [
  {
    id: "whitespace",
    name: "Khoảng trắng & dòng trống",
    description: "Xóa khoảng trắng thừa và dòng trống dư.",
    example: '"Xin  chào" → "Xin chào"',
    exampleBefore: '"Xin  chào ,  các bạn"',
    exampleAfter: '"Xin chào, các bạn"',
    category: "format",
    categoryName: "Định dạng văn bản",
    defaultEnabled: true,
  },
  {
    id: "punctuation",
    name: "Dấu câu & khoảng cách",
    description: "Sửa khoảng cách sai quanh dấu câu.",
    example: '"chào .bạn" → "chào. Bạn"',
    exampleBefore: '"chào .bạn !!!"',
    exampleAfter: '"chào. Bạn!"',
    category: "punctuation",
    categoryName: "Làm sạch dấu câu",
    defaultEnabled: true,
  },
  {
    id: "unicode",
    name: "Unicode & ký tự đặc biệt",
    description: "Chuẩn hóa ký tự phù hợp với TTS.",
    example: '"Xin​chào" → "Xin chào"',
    exampleBefore: '“Tesla” → Tesla',
    exampleAfter: "Tesla",
    category: "content",
    categoryName: "Xử lý nội dung",
    defaultEnabled: true,
  },
  {
    id: "numbers",
    name: "Số liệu & đơn vị",
    description: "Chuẩn hóa cách đọc số, phần trăm, tiền tệ và đơn vị.",
    example: '"15,000" → "fifteen thousand"',
    exampleBefore: '"$119B"',
    exampleAfter: '"one hundred and nineteen billion dollars"',
    category: "content",
    categoryName: "Xử lý nội dung",
    defaultEnabled: false,
  },
];

export const PRONUNCIATION_GROUP: NormalizerGroup = {
  id: "pronunciation",
  name: "Phát âm tùy chỉnh",
  description: "Áp dụng các cách đọc tùy chỉnh đã thiết lập cho từ, cụm từ và ký hiệu trong kịch bản.",
  example: '"UBND" → "Ủy ban nhân dân"',
  exampleBefore: '"UBND, Report #5"',
  exampleAfter: '"Ủy ban nhân dân, Report Number five"',
  category: "content",
  categoryName: "Xử lý nội dung",
  defaultEnabled: false,
};

export const ALL_NORMALIZER_GROUPS: NormalizerGroup[] = [
  ...NORMALIZER_GROUPS,
  PRONUNCIATION_GROUP,
];

/**
 * Token protection utility to ensure protected technical items (IPs, URLs, emails,
 * academic titles, abbreviations, versions, technical filenames)
 * are NEVER damaged or mangled during text normalization.
 */
export function protectTokens(text: string): {
  protectedText: string;
  restore: (str: string) => string;
} {
  let sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
  while (text.includes(sessionKey)) {
    sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  const protectedItems: string[] = [];
  const tokenPattern =
    /(?:https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+|\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b|\b\d{1,2}:\d{2}(?::\d{2})?\b|\b\d+:\d+\b|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\bv?\d+(?:\.\d+)+[a-zA-Z0-9._-]*\b|\b(?:Dr|Mr|Mrs|Ms|Prof|Rev|Gen|Sen|Rep|St|Jr|Sr)\.(?:[A-Z][a-zA-Z]+|(?=\s|$|[,/:;!?)[\]]))|\b[A-Z](?:\.[A-Z])+(?:\.(?![A-Za-z\p{L}])|\b)|\b[A-Z][a-z]?\.[A-Z][a-z]?(?:\.[A-Z][a-z]?)?(?:\.(?![A-Za-z\p{L}])|\b)|\b(?:e\.g|i\.e|etc|vs|al|a\.m|p\.m|E\.G|I\.E)(?:\.(?![A-Za-z\p{L}])|\b)|\b[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.(?:com|net|org|io|ai|dev|app|edu|gov|vn|info|biz|me|co|tech|online|site|xyz|js|ts|json|html|css|py|rs|go|cpp|c|h|md|txt|wav|mp3|ogg|flac|png|jpg|jpeg|gif|svg|webp|pdf)\b|\[(?:PAUSE|pause)\s+\d+(?:\.\d+)?\s*(?:ms|s)?\]|VOX_PRON_P\d+_XOV)/gu;

  const protectedText = text.replace(tokenPattern, (match) => {
    protectedItems.push(match);
    return `VOX${sessionKey}P${protectedItems.length - 1}XOV`;
  });

  const restore = (str: string): string => {
    const restoreRegex = new RegExp(`VOX${sessionKey}P(\\d+)XOV`, "g");
    return str.replace(restoreRegex, (_, idx) => protectedItems[Number(idx)] ?? "");
  };

  return { protectedText, restore };
}

export const BULLET_REGEX = /^[^\S\r\n]*(?:([•◆■●★*◦▪])[^\S\r\n]*|([-–—])[^\S\r\n]+)(.*)$/;

function hasValidPunctuation(str: string): boolean {
  const actual = str.trim();
  if (!actual) return true;
  if (/[.,:!?…]$/.test(actual)) return true;
  if (/[.,:!?…]["'”’»\)\]]+$/.test(actual)) return true;
  return false;
}

function hasSentenceTerminalPunctuation(str: string): boolean {
  const actual = str.trim();
  if (!actual) return true;
  if (/[.:!?…]$/.test(actual)) return true;
  if (/[.:!?…]["'”’»\)\]]+$/.test(actual)) return true;
  return false;
}

/**
 * Normalizes inline lists on a single line where multiple bullets separate items:
 * e.g. "Benefits: • lower cost • lower weight • easier repair"
 *   -> "Benefits: lower cost, lower weight, easier repair."
 */
export function normalizeInlineLists(line: string): string {
  const bulletMatches = line.match(/[•◆■●★*◦▪]/g);
  if (!bulletMatches || bulletMatches.length < 2) {
    return line;
  }

  const parts = line.split(/[•◆■●★*◦▪]/);
  const prefix = parts[0].trimEnd();
  const items = parts.slice(1).map((p) => p.trim()).filter((p) => p.length > 0);

  if (items.length < 2) {
    return line;
  }

  const formattedItems = items.map((item, idx) => {
    const clean = item.replace(/[\s,.;:]+$/, "");
    if (clean.endsWith("?") || clean.endsWith("!")) {
      return clean;
    }
    if (idx === items.length - 1) {
      return clean + ".";
    }
    return clean + ",";
  });

  const joinedItems = formattedItems.join(" ");
  return prefix.length > 0 ? `${prefix} ${joinedItems}` : joinedItems;
}

/**
 * Normalizes lists and paragraph boundaries.
 * If convertBullets is true, removes bullet symbols and formats items with commas and period.
 * If convertBullets is false, preserves bullet markers on separate lines.
 */
export function normalizeStructure(
  text: string,
  options: { convertBullets: boolean }
): string {
  const hasCRLF = text.includes("\r\n");
  const normalizedText = text.replace(/\r\n/g, "\n");
  const rawLines = normalizedText.split("\n").map(normalizeInlineLists);

  interface LineInfo {
    lineIndex: number;
    raw: string;
    isBullet: boolean;
    bulletMarker: string;
    bulletContent: string;
  }

  const nonBlank: LineInfo[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (trimmed.length > 0) {
      const match = rawLines[i].match(BULLET_REGEX);
      const bulletContent = match ? match[3].trim() : "";
      if (match && bulletContent.length > 0) {
        nonBlank.push({
          lineIndex: i,
          raw: rawLines[i],
          isBullet: true,
          bulletMarker: match[1] || match[2] || "",
          bulletContent,
        });
      } else {
        nonBlank.push({
          lineIndex: i,
          raw: rawLines[i],
          isBullet: false,
          bulletMarker: "",
          bulletContent: "",
        });
      }
    }
  }

  if (nonBlank.length === 0) {
    return text.trim();
  }

  type Unit =
    | { type: "ordinary"; line: LineInfo }
    | { type: "list"; items: LineInfo[] };

  const units: Unit[] = [];
  let idx = 0;

  while (idx < nonBlank.length) {
    const current = nonBlank[idx];
    if (current.isBullet) {
      const listItems: LineInfo[] = [current];
      idx++;
      while (idx < nonBlank.length && nonBlank[idx].isBullet) {
        listItems.push(nonBlank[idx]);
        idx++;
      }
      units.push({ type: "list", items: listItems });
    } else {
      units.push({ type: "ordinary", line: current });
      idx++;
    }
  }

  // Assemble units
  const outputSegments: Array<{ text: string; isList: boolean; hasBlankAfter: boolean; isShort: boolean; endsWithColon: boolean }> = [];

  for (let u = 0; u < units.length; u++) {
    const unit = units[u];
    const isLastUnit = u === units.length - 1;
    const nextUnit = !isLastUnit ? units[u + 1] : null;

    if (unit.type === "list") {
      const totalItems = unit.items.length;
      const listFormattedLines: string[] = [];

      for (let k = 0; k < totalItems; k++) {
        const item = unit.items[k];
        if (options.convertBullets) {
          const rawContent = item.bulletContent;
          const cleanContent = rawContent.replace(/[\s,.;:]+$/, "");
          let formattedItem: string;
          if (cleanContent.endsWith("?") || cleanContent.endsWith("!")) {
            formattedItem = cleanContent;
          } else if (totalItems === 1 || k === totalItems - 1) {
            formattedItem = cleanContent + ".";
          } else {
            formattedItem = cleanContent + ",";
          }
          listFormattedLines.push(formattedItem);
        } else {
          listFormattedLines.push(item.raw.trim());
        }
      }

      const nextFirstLineIndex = nextUnit
        ? nextUnit.type === "list"
          ? nextUnit.items[0].lineIndex
          : nextUnit.line.lineIndex
        : 0;
      const lastLineIndex = unit.items[totalItems - 1].lineIndex;
      const hasBlankAfter = nextUnit ? nextFirstLineIndex > lastLineIndex + 1 : false;

      outputSegments.push({
        text: listFormattedLines.join("\n"),
        isList: true,
        hasBlankAfter,
        isShort: false,
        endsWithColon: false,
      });
    } else {
      const lineInfo = unit.line;
      let lineText = lineInfo.raw.trim();

      // Section 10: List intro ending with dash normalizes to colon if followed by list
      if (nextUnit && nextUnit.type === "list") {
        lineText = lineText.replace(/[^\S\r\n]*[—–-]$/, ":");
      }

      const nextFirstLineIndex = nextUnit
        ? nextUnit.type === "list"
          ? nextUnit.items[0].lineIndex
          : nextUnit.line.lineIndex
        : 0;
      const hasBlankAfter = nextUnit ? nextFirstLineIndex > lineInfo.lineIndex + 1 : false;
      const wordCount = lineText.split(/\s+/).length;
      const isShort = wordCount <= 3;
      const endsWithColon = lineText.endsWith(":");

      outputSegments.push({
        text: lineText,
        isList: false,
        hasBlankAfter,
        isShort,
        endsWithColon,
      });
    }
  }

  // Join segments
  let result = "";
  for (let i = 0; i < outputSegments.length; i++) {
    const cur = outputSegments[i];
    const isLast = i === outputSegments.length - 1;
    const next = !isLast ? outputSegments[i + 1] : null;

    let segmentText = cur.text;

    if (!isLast && next) {
      if (cur.endsWithColon && next.isList) {
        // Intro clause before a list directly precedes the list
        result += segmentText + "\n";
      } else if (cur.isList || next.isList) {
        // Between list and non-list, or between lists: keep separate line
        if (!cur.isList && !hasValidPunctuation(segmentText)) {
          segmentText += ".";
        }
        result += segmentText + "\n";
      } else {
        // Two ordinary segments
        const isListLikeItem = segmentText.endsWith(",") || next.text.endsWith(",");

        if (isListLikeItem) {
          result += segmentText + "\n";
        } else if (cur.hasBlankAfter) {
          if (!hasValidPunctuation(segmentText)) {
            segmentText += ".";
          }
          result += segmentText + "\n";
        } else {
          // Single newline
          if (hasSentenceTerminalPunctuation(segmentText)) {
            result += segmentText + "\n";
          } else if (/[,;:–—-]$/.test(segmentText.trim())) {
            // Continuation punctuation at end of segment
            result += segmentText + " ";
          } else {
            const nextTrimmed = next.text.trim();
            const startsWithUpper = /^\p{Lu}/u.test(nextTrimmed);
            if (startsWithUpper) {
              segmentText += ".";
              result += segmentText + " ";
            } else {
              // Lowercase continuation or default conservative: space without period
              result += segmentText + " ";
            }
          }
        }
      }
    } else {
      result += segmentText;
    }
  }

  return hasCRLF ? result.replace(/\n/g, "\r\n") : result;
}

export function convertBulletListsOnly(text: string): string {
  const hasCRLF = text.includes("\r\n");
  const normalizedText = text.replace(/\r\n/g, "\n");
  const rawLines = normalizedText.split("\n").map(normalizeInlineLists);

  const bulletRegex = /^[^\S\r\n]*(?:([•◆■●★*◦▪])[^\S\r\n]*|([-–—])[^\S\r\n]+)(.*)$/;

  interface LineData {
    raw: string;
    isBullet: boolean;
    bulletContent: string;
  }

  const lines: LineData[] = rawLines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return { raw: "", isBullet: false, bulletContent: "" };
    const match = line.match(bulletRegex);
    if (match && match[3].trim().length > 0) {
      return { raw: line, isBullet: true, bulletContent: match[3].trim() };
    }
    return { raw: line, isBullet: false, bulletContent: "" };
  });

  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const cur = lines[i];

    if (!cur.isBullet && cur.raw.trim().length > 0) {
      // Look ahead to see if next non-empty line is bullet
      let nextNonEmptyIdx = i + 1;
      while (nextNonEmptyIdx < lines.length && lines[nextNonEmptyIdx].raw.trim().length === 0) {
        nextNonEmptyIdx++;
      }
      if (nextNonEmptyIdx < lines.length && lines[nextNonEmptyIdx].isBullet) {
        // Section 10: normalize trailing dash before list to colon
        cur.raw = cur.raw.replace(/[^\S\r\n]*[—–-]$/, ":");
      }
    }

    if (cur.isBullet) {
      const listItems: string[] = [cur.bulletContent];
      i++;
      while (i < lines.length) {
        if (lines[i].isBullet) {
          listItems.push(lines[i].bulletContent);
          i++;
        } else if (lines[i].raw.trim().length === 0) {
          let lookAhead = i + 1;
          while (lookAhead < lines.length && lines[lookAhead].raw.trim().length === 0) {
            lookAhead++;
          }
          if (lookAhead < lines.length && lines[lookAhead].isBullet) {
            i = lookAhead;
          } else {
            break;
          }
        } else {
          break;
        }
      }

      const total = listItems.length;
      for (let k = 0; k < total; k++) {
        const clean = listItems[k].replace(/[\s,.;:]+$/, "");
        let formatted: string;
        if (clean.endsWith("?") || clean.endsWith("!")) {
          formatted = clean;
        } else if (total === 1 || k === total - 1) {
          formatted = clean + ".";
        } else {
          formatted = clean + ",";
        }
        output.push(formatted);
      }
    } else {
      output.push(cur.raw.trim());
      i++;
    }
  }

  const result = output.join("\n");
  return hasCRLF ? result.replace(/\n/g, "\r\n") : result;
}

export function normalizeVoiceOverListsAndParagraphs(
  text: string,
  _restore?: (s: string) => string
): string {
  return normalizeStructure(text, { convertBullets: true });
}

export function normalizeBulletLists(text: string, _restore?: (s: string) => string): string {
  return convertBulletListsOnly(text);
}

/** Group 1: Khoảng trắng & dòng trống */
export function applyWhitespaceGroup(text: string): string {
  const { protectedText, restore } = protectTokens(text);
  let res = protectedText;

  // 1. Collapse multiple horizontal spaces
  res = res.replace(/[^\S\r\n]{2,}/g, " ");

  // 2. Normalize line breaks into sentence boundaries and clean spacing
  res = normalizeStructure(res, { convertBullets: false });

  // 3. Trim outer whitespace
  res = res.trim();

  return restore(res);
}

/** Group 2: Dấu câu & khoảng cách */
export function applyPunctuationGroup(text: string): string {
  const { protectedText, restore } = protectTokens(text);
  let res = protectedText;

  // 1. Collapse repeated punctuation (collapse !!! -> !, ??? -> ?, ... -> ., etc., while preserving ?! and !?)
  // Protect ?! and !?
  res = res.replace(/\?!+/g, "?!").replace(/!\?+/g, "!?");
  // Collapse 2+ of the same mark
  res = res
    .replace(/(?<!\?)\!{2,}/g, "!")
    .replace(/(?<!\!)\?{2,}/g, "?")
    .replace(/\.{2,}/g, ".")
    .replace(/,{2,}/g, ",")
    .replace(/;{2,}/g, ";")
    .replace(/:{2,}/g, ":");

  // 2. Obvious stray punctuation (, . -> . và . , -> .)
  res = res
    .replace(/,\s*\./g, ".")
    .replace(/\.\s*,/g, ".");

  // 3. Clean stray punctuation at start of line
  res = res.replace(/^[^\S\r\n]*[,;]+/gm, "");

  // 4. Remove space before punctuation (.,:;!?)
  res = res.replace(/[^\S\r\n]+([,.:;!?])/g, "$1");

  // 5. Add space after punctuation when directly adjacent to word characters
  res = res
    .replace(/([,;:])(?=[^\s\d\p{P}])/gu, "$1 ")
    .replace(/([.!?])(?=[^\s\d\p{P}])/gu, "$1 ");

  // 6. Capitalization after sentence boundary (. ! ?) on the same line
  res = res.replace(/([.!?][^\S\r\n]+)(\p{Ll})/gu, (_, p1, letter) => p1 + letter.toUpperCase());

  return restore(res);
}

/**
 * Detects if a line is a structural separator line (e.g., ---, ____, ***, ===, ~~~~, ———).
 * A structural separator line consists entirely of one repeated separator character
 * (with optional spaces between them) with at least 3 occurrences, and no alphanumeric characters.
 */
export function isStructuralSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Disallow letters or digits
  if (/[\p{L}\p{N}]/u.test(trimmed)) return false;

  // Must consist entirely of one of the valid separator characters (and optional whitespace)
  // with at least 3 occurrences of that separator character.
  // Allowed: - (hyphen), _ (underscore), * (asterisk), = (equal), ~ (tilde), — (em dash), – (en dash)
  return /^([-*=_~—–])(?:\s*\1){2,}\s*$/.test(trimmed);
}

function endsWithSentencePunctuation(str: string): boolean {
  const trimmed = str.trim();
  if (!trimmed) return true;
  return /[.!?…][\s"'”’»\)\]]*$/.test(trimmed);
}

/**
 * Normalizes structural section separators (---, ___, ***, ===, etc.) into clean paragraph breaks.
 * Ensures the previous section ends with sentence-ending punctuation without duplicate marks.
 */
export function normalizeStructuralSeparators(text: string): string {
  const hasCRLF = text.includes("\r\n");
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  interface ClassifiedLine {
    raw: string;
    isSeparator: boolean;
    isBlank: boolean;
  }

  const classified: ClassifiedLine[] = lines.map((line) => {
    const isSep = isStructuralSeparator(line);
    const isBl = !isSep && line.trim().length === 0;
    return { raw: line, isSeparator: isSep, isBlank: isBl };
  });

  if (!classified.some((c) => c.isSeparator)) {
    return text;
  }

  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let inSeparatorRegion = false;

  for (let i = 0; i < classified.length; i++) {
    const item = classified[i];
    if (item.isSeparator) {
      if (!inSeparatorRegion) {
        while (currentChunk.length > 0 && currentChunk[currentChunk.length - 1].trim().length === 0) {
          currentChunk.pop();
        }
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = [];
        }
        inSeparatorRegion = true;
      }
    } else if (inSeparatorRegion) {
      if (item.isBlank) {
        // skip blank line adjacent to/between separators
      } else {
        inSeparatorRegion = false;
        currentChunk.push(item.raw);
      }
    } else {
      currentChunk.push(item.raw);
    }
  }

  while (currentChunk.length > 0 && currentChunk[currentChunk.length - 1].trim().length === 0) {
    currentChunk.pop();
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  if (chunks.length === 0) {
    return "";
  }

  const outputLines: string[] = [];

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const isLastChunk = c === chunks.length - 1;

    if (!isLastChunk) {
      let lastLineIdx = chunk.length - 1;
      while (lastLineIdx >= 0 && chunk[lastLineIdx].trim().length === 0) {
        lastLineIdx--;
      }
      if (lastLineIdx >= 0) {
        let lastLine = chunk[lastLineIdx];
        const trimmed = lastLine.trim();
        if (trimmed.length > 0 && !endsWithSentencePunctuation(trimmed)) {
          if (/[,;]$/.test(trimmed)) {
            lastLine = lastLine.replace(/[,;]+$/, ".");
          } else {
            lastLine = lastLine + ".";
          }
          chunk[lastLineIdx] = lastLine;
        }
      }
    }

    for (const l of chunk) {
      outputLines.push(l);
    }
  }

  const result = outputLines.join("\n");
  return hasCRLF ? result.replace(/\n/g, "\r\n") : result;
}

/**
 * Normalizes hyphens in lexical compounds (e.g. twenty-five-thousand-dollar -> twenty five thousand dollar,
 * low-margin -> low margin, state-backed -> state backed) into spaces for spoken TTS.
 * Protects:
 * - Proper names (Shin-Etsu, Mercedes-Benz, TitleCase-TitleCase compounds)
 * - Technical tokens / model identifiers (RTX-5090, X-1, F-150, B-2, AI-5, v1-rc1, etc.)
 * - Numeric ranges (10-15, 2024-2025)
 * - Negative numbers / unary minus (-5, -10°C, -3.5)
 */
export function normalizeLexicalHyphens(text: string): string {
  let sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
  while (text.includes(sessionKey)) {
    sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  const protectedItems: string[] = [];
  const protect = (match: string): string => {
    protectedItems.push(match);
    return `VOXHYPH${sessionKey}P${protectedItems.length - 1}HYPH`;
  };

  // 1. Proper names (Shin-Etsu, Mercedes-Benz, Rolls-Royce, Harley-Davidson, Coca-Cola, TitleCase-TitleCase compounds)
  const properNamePattern =
    /\b(?:Shin-Etsu|Mercedes-Benz|Rolls-Royce|Harley-Davidson|Coca-Cola)\b|\b\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)+\b/gu;
  let res = text.replace(properNamePattern, protect);

  // 2. Technical tokens / model identifiers
  const technicalPattern =
    /\b[A-Za-z]+-[0-9]+[A-Za-z0-9_-]*\b|\b[A-Za-z]-[0-9]+\b|\b[A-Za-z0-9_-]+-[0-9]+[A-Za-z]+[A-Za-z0-9_-]*\b|\bv\d+(?:[.-][a-zA-Z0-9]+)+\b|\b[A-Z]{2,}-[A-Z]\b/gu;
  res = res.replace(technicalPattern, protect);

  // 3. Numeric ranges
  const rangePattern = /\b\d+\s*-\s*\d+\b/gu;
  res = res.replace(rangePattern, protect);

  // 4. Negative numbers / unary minus
  const negativeNumberPattern = /(?<=^|\s|[(\[{])-\d+(?:\.\d+)?(?:[°C°F%a-zA-Z]+)?\b/gu;
  res = res.replace(negativeNumberPattern, protect);

  // 5. Lexical hyphen compounds (letters only on both sides)
  const lexicalCompoundPattern =
    /(?<![\p{L}\p{N}-])(\p{L}+(?:-\p{L}+)+)(?![\p{L}\p{N}-])/gu;
  res = res.replace(lexicalCompoundPattern, (match) => match.replace(/-/g, " "));

  // 6. Restore protected tokens
  const restoreRegex = new RegExp(`VOXHYPH${sessionKey}P(\\d+)HYPH`, "g");
  return res.replace(restoreRegex, (_, idx) => protectedItems[Number(idx)] ?? "");
}

/** Group 3: Unicode & ký tự đặc biệt */
export function applyUnicodeGroup(text: string): string {
  // 0. Detect and normalize structural section separators early before generic transformations
  const textWithoutSeparators = normalizeStructuralSeparators(text);

  const { protectedText, restore } = protectTokens(textWithoutSeparators);
  let res = protectedText
    // 1. Unicode NFC canonical composition
    .normalize("NFC")
    // 2. Non-breaking space to normal space
    .replace(/\u00A0/g, " ")
    // 3. Strip zero-width, BOM, soft hyphen, ASCII control chars
    .replace(/[\u200B-\u200D\uFEFF\u00AD\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // 4. Markdown headers: #, ##, ### at line start
    .replace(/^[^\S\r\n]*#{1,6}[^\S\r\n]+(.*)$/gm, "$1")
    .replace(/(^|[^\S\r\n])#+[^\S\r\n]*/gm, "$1")
    .replace(/#/g, "")
    // 5. Inline markdown: **bold**, __italic__, `code`
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    // 6. Double quotation marks removal
    .replace(/[“”„«»❝❞"]/g, "");

  // 7. Single quote delimiters removal (protect lexical apostrophes like we're, can't, Musk's, Tesla's, rock 'n' roll, 1990's)
  res = res.replace(/(^|[^\S\r\n])['‘’]n['‘’](?=[^\S\r\n]|$)/gi, "$1___VOX_ROCK_N_ROLL___");
  res = res.replace(/(\d)[’‚‛]([a-zA-Z])/gu, "$1'$2");
  res = res.replace(/(?:(?<!\p{L})['‘’]|['‘’](?!\p{L}))/gu, (_m, offset, full) => {
    // Preserve digit + 's (e.g. 1990's)
    if (offset > 0 && /\d$/.test(full.slice(0, offset)) && /^s\b/i.test(full.slice(offset + 1))) {
      return "'";
    }
    return "";
  });
  res = res.replace(/(\p{L})[’‚‛](\p{L})/gu, "$1'$2");
  res = res.replace(/___VOX_ROCK_N_ROLL___/g, "'n'");

  // 8. Bullet & list normalization
  res = convertBulletListsOnly(res);

  // 9. Prose em/en dash normalization (convert prose dash to pause/comma, preserving numeric ranges)
  res = res.replace(/(\b\d+\s*[–—-]\s*\d+\b)|(?:\s*[—–]\s*)/gu, (_match, range, offset, string) => {
    if (range) return range;
    const prefix = string.slice(0, offset).trimEnd();
    if (/[.!?]$/.test(prefix)) {
      return " ";
    }
    return ", ";
  });
  res = res.replace(/,\s*,/g, ",");

  // 10. Lexical hyphen normalization (convert hyphens in lexical compounds to space for TTS)
  res = normalizeLexicalHyphens(res);

  return restore(res);
}

/** Group 4: Typography (backward compatibility helper) */
export function applyTypographyGroup(text: string): string {
  return text
    .replace(/[“”„«»❝❞]/g, '"')
    .replace(/[‘’‚‛❛❜]/g, "'");
}

/* ======================================================================
 * OPTION 4: Số liệu & đơn vị (Verbalizer Helpers)
 * ====================================================================== */

const NUM_WORDS_UNDER_20 = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen"
];

const NUM_WORDS_TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"
];

function smallIntToWords(n: number): string {
  if (n < 20) return NUM_WORDS_UNDER_20[n];
  const ten = Math.floor(n / 10);
  const rem = n % 10;
  return rem > 0 ? `${NUM_WORDS_TENS[ten]} ${NUM_WORDS_UNDER_20[rem]}` : NUM_WORDS_TENS[ten];
}

export function numberToWords(n: number | string): string {
  let num = typeof n === "string" ? parseInt(n.replace(/,/g, ""), 10) : n;
  if (isNaN(num)) return String(n);
  if (num === 0) return "zero";
  if (num < 0) return "minus " + numberToWords(Math.abs(num));

  const parts: string[] = [];

  const billions = Math.floor(num / 1000000000);
  num %= 1000000000;
  if (billions > 0) {
    parts.push(`${numberToWords(billions)} billion`);
  }

  const millions = Math.floor(num / 1000000);
  num %= 1000000;
  if (millions > 0) {
    parts.push(`${numberToWords(millions)} million`);
  }

  const thousands = Math.floor(num / 1000);
  num %= 1000;
  if (thousands > 0) {
    parts.push(`${numberToWords(thousands)} thousand`);
  }

  const hundreds = Math.floor(num / 100);
  const remainder = num % 100;
  if (hundreds > 0) {
    if (remainder > 0) {
      if (remainder === 19 || remainder < 20) {
        parts.push(`${NUM_WORDS_UNDER_20[hundreds]} hundred and ${smallIntToWords(remainder)}`);
      } else {
        parts.push(`${NUM_WORDS_UNDER_20[hundreds]} hundred ${smallIntToWords(remainder)}`);
      }
    } else {
      parts.push(`${NUM_WORDS_UNDER_20[hundreds]} hundred`);
    }
  } else if (remainder > 0) {
    if (parts.length > 0) {
      parts.push(smallIntToWords(remainder));
    } else {
      parts.push(smallIntToWords(remainder));
    }
  }

  return parts.join(" ");
}

function decimalToWords(str: string): string {
  const [intPart, decPart] = str.split(".");
  const intWords = numberToWords(intPart);
  const decWords = decPart
    .split("")
    .map((d) => NUM_WORDS_UNDER_20[parseInt(d, 10)])
    .join(" ");
  return `${intWords} point ${decWords}`;
}

function formatNumberString(str: string): string {
  if (str.includes(".")) {
    return decimalToWords(str);
  }
  return numberToWords(str);
}

function yearToWords(yearStr: string): string {
  const y = parseInt(yearStr, 10);
  const century = Math.floor(y / 100);
  const rem = y % 100;
  if (y >= 2000 && y <= 2009) {
    if (rem === 0) return "two thousand";
    return `two thousand ${NUM_WORDS_UNDER_20[rem]}`;
  }
  const centuryWords = smallIntToWords(century);
  let remWords = "";
  if (rem === 0) {
    remWords = "hundred";
  } else if (rem < 10) {
    remWords = `zero ${NUM_WORDS_UNDER_20[rem]}`;
  } else {
    remWords = smallIntToWords(rem);
  }
  return `${centuryWords} ${remWords}`;
}

const UNIT_MAP: Record<string, { singular: string; plural: string }> = {
  MW: { singular: "megawatt", plural: "megawatts" },
  kW: { singular: "kilowatt", plural: "kilowatts" },
  GW: { singular: "gigawatt", plural: "gigawatts" },
  W: { singular: "watt", plural: "watts" },
  km: { singular: "kilometer", plural: "kilometers" },
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
  V: { singular: "volt", plural: "volts" },
  A: { singular: "amp", plural: "amps" },
  hp: { singular: "horsepower", plural: "horsepower" },
  "°C": { singular: "degree Celsius", plural: "degrees Celsius" },
  "°F": { singular: "degree Fahrenheit", plural: "degrees Fahrenheit" },
};

/**
 * Group 4: Số liệu & đơn vị
 * Verbalizes written numeric forms into spoken English words according to Section G contracts.
 * DEFAULT: OFF
 */
export function applyNumbersGroup(text: string): string {
  let sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
  while (text.includes(sessionKey)) {
    sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  const protectedItems: string[] = [];
  const modelPattern =
    /(?:https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+|\bv\d+(?:\.\d+)+[a-zA-Z0-9._-]*\b|\b\d+(?:\.\d+){2,}[a-zA-Z0-9._-]*\b|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b[A-Za-z]+[0-9]+[A-Za-z0-9_-]*\b|\b[A-Za-z]+-[0-9]+[A-Za-z0-9_-]*\b|\b[A-Za-z0-9_-]+-[0-9]+[A-Za-z]+[A-Za-z0-9_-]*\b|\b[A-Za-z]-[0-9]+\b|\b\d+\/\d+\b|\[(?:PAUSE|pause)\s+\d+(?:\.\d+)?\s*(?:ms|s)?\]|VOX_PRON_P\d+_XOV)/gu;

  let res = text.replace(modelPattern, (match) => {
    if (/^\d+$/.test(match)) return match;
    protectedItems.push(match);
    return `NUM${sessionKey}P${protectedItems.length - 1}MUN`;
  });

  // 1. Currencies: $119B, $15,000, etc. (with attributive vs noun detection)
  res = res.replace(
    /(\ba\s+|\ban\s+|\bthe\s+|\bthis\s+|\bthat\s+)?\$(\d+(?:,\d+)*(?:\.\d+)?)\s*([BMKbmk])?(?:\s+([a-zA-Z]+))?/gu,
    (_full, article, numStr, scale, followingWord) => {
      const numWords = formatNumberString(numStr);
      let scaleWord = "";
      if (scale) {
        const s = scale.toUpperCase();
        if (s === "B") scaleWord = "billion";
        else if (s === "M") scaleWord = "million";
        else if (s === "K") scaleWord = "thousand";
      }

      const isAttributive = Boolean(article && followingWord);
      let unitWord = isAttributive ? "dollar" : "dollars";
      if (!isAttributive && numStr === "1" && !scale) {
        unitWord = "dollar";
      }

      const spokenAmount = scaleWord ? `${numWords} ${scaleWord} ${unitWord}` : `${numWords} ${unitWord}`;
      if (article && followingWord) {
        return `${article}${spokenAmount} ${followingWord}`;
      }
      if (followingWord) {
        return `${spokenAmount} ${followingWord}`;
      }
      return spokenAmount;
    }
  );

  // 2. Compound units: 20 km/h -> twenty kilometers per hour
  res = res.replace(/(\b\d+(?:,\d+)*(?:\.\d+)?)\s*km\/h\b/gu, (_, numStr) => {
    return `${formatNumberString(numStr)} kilometers per hour`;
  });

  // 3. Units / Measurements: 1.2 MW, a 1.2 MW system
  const unitKeys = Object.keys(UNIT_MAP).join("|");
  const unitRegex = new RegExp(
    `(\\ba\\s+|\\ban\\s+|\\bthe\\s+|\\bthis\\s+|\\bthat\\s+)?(\\b\\d+(?:,\\d+)*(?:\\.\\d+)?)\\s*(${unitKeys})\\b(?:\\s+([a-zA-Z]+))?`,
    "gu"
  );
  res = res.replace(unitRegex, (_full, article, numStr, unitKey, followingWord) => {
    const unitInfo = UNIT_MAP[unitKey];
    if (!unitInfo) return _full;
    const numWords = formatNumberString(numStr);
    const isAttributive = Boolean(article && followingWord);
    const unitWord = isAttributive ? unitInfo.singular : unitInfo.plural;

    const spokenMeasurement = `${numWords} ${unitWord}`;
    if (article && followingWord) {
      return `${article}${spokenMeasurement} ${followingWord}`;
    }
    if (followingWord) {
      return `${spokenMeasurement} ${followingWord}`;
    }
    return spokenMeasurement;
  });

  // 4. Percentages: 13.5% -> thirteen point five percent
  res = res.replace(/(\b\d+(?:,\d+)*(?:\.\d+)?)%/gu, (_, numStr) => {
    return `${formatNumberString(numStr)} percent`;
  });

  // 5. Ranges: 10-15 -> ten to fifteen
  res = res.replace(/(?<=\s|^|\()(\d+)-(\d+)(?=\s+[a-zA-Z]+|[\s\p{P}]|$)/gu, (_, start, end) => {
    return `${numberToWords(start)} to ${numberToWords(end)}`;
  });

  // 6. Year in context:
  // 6a. Article/Demonstrative + Year + Noun: The 2021 report -> The twenty twenty one report
  res = res.replace(/\b(the|this|that)\s+(19\d{2}|20\d{2})\s+([a-zA-Z]+)\b/giu, (_, article, yearStr, noun) => {
    return `${article} ${yearToWords(yearStr)} ${noun}`;
  });

  // 6b. Preposition + Year: in 2021, from 2020 to 2021, since 1999
  res = res.replace(/\b(in|since|by|during|year|from|until|to|between|and)\s+(19\d{2}|20\d{2})\b/giu, (_, prep, yearStr) => {
    return `${prep} ${yearToWords(yearStr)}`;
  });

  // 7. Decimals: 1.2 -> one point two, 1.07 -> one point zero seven
  res = res.replace(/\b(\d+)\.(\d+)\b/gu, (_full, intPart, decPart) => {
    return decimalToWords(`${intPart}.${decPart}`);
  });

  // 8. Basic numbers with thousands separator: 15,000, 150,000
  res = res.replace(/\b\d{1,3}(?:,\d{3})+\b/gu, (match) => {
    return numberToWords(match);
  });

  // Restore protected models & technical tokens
  const restoreRegex = new RegExp(`NUM${sessionKey}P(\\d+)MUN`, "g");
  res = res.replace(restoreRegex, (_, idx) => protectedItems[Number(idx)] ?? "");

  return res;
}

export const GROUP_APPLY_MAP: Record<NormalizerGroupId, (text: string) => string> = {
  unicode: applyUnicodeGroup,
  punctuation: applyPunctuationGroup,
  whitespace: applyWhitespaceGroup,
  numbers: applyNumbersGroup,
  pronunciation: (text: string) => text,
};

export const ORDERED_GROUP_IDS: NormalizerGroupId[] = [
  "unicode",
  "whitespace",
  "punctuation",
  "numbers",
];

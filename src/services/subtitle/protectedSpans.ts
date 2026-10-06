import { ProtectedSpan, ProtectedSpanType } from "./types";

/**
 * Patterns for recognizing protected lexical spans where internal punctuation
 * (. , : / -) must NEVER be treated as a sentence or subtitle split boundary.
 */
interface PatternDef {
  type: ProtectedSpanType;
  regex: RegExp;
}

const PROTECTED_PATTERNS: PatternDef[] = [
  // 1. IP addresses (e.g. 192.168.1.1, 127.0.0.1)
  {
    type: "ip",
    regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  },
  // 2. Dates (e.g. 24.09.2026, 24/09/2026, 24-09-2026)
  {
    type: "date",
    regex: /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
  },
  // 3. Version numbers (e.g. v2.5.1, 2.5.1, v1.0.0.4)
  {
    type: "version",
    regex: /\bv?\d+\.\d+(?:\.\d+)+\b/gi,
  },
  // 4. Times (e.g. 15:30, 10:30:00)
  {
    type: "time",
    regex: /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  },
  // 5. Currency with prefix (e.g. $15.99, $1,299.99, €250.00, £50)
  {
    type: "currency",
    regex: /[$€£₫¥₩]\s*\d+(?:[.,]\d+)*(?:\s*(?:USD|EUR|GBP|VND|k|tr))?\b/gi,
  },
  // 6. Currency with suffix (e.g. 150.000đ, 25.000 VND)
  {
    type: "currency",
    regex: /\b\d+(?:[.,]\d+)*\s*(?:USD|EUR|GBP|VND|đ)\b/gi,
  },
  // 7. Number + Unit (e.g. 3.5 GHz, 12.5 kg, 100 km/h, 25%)
  {
    type: "unit",
    regex: /\b\d+(?:[.,]\d+)?\s*(?:GHz|MHz|kHz|Hz|kg|g|mg|km|m|cm|mm|GB|MB|KB|TB|s|ms|h|min|mph|km\/h|%)\b/gi,
  },
  // 8. Thousands with decimal or thousand separator (e.g. 15.000, 1,500.25, 1.500,25)
  {
    type: "number",
    regex: /\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b/g,
  },
  // 9. Decimals (e.g. 0.05, 3.14)
  {
    type: "number",
    regex: /\b\d+\.\d+\b/g,
  },
  // 10. Decimal with comma (Vietnamese / European convention e.g. 0,05)
  {
    type: "number",
    regex: /\b\d+,\d+\b/g,
  },
  // 11. URLs
  {
    type: "url",
    regex: /\bhttps?:\/\/[^\s]+|\bwww\.[a-zA-Z0-9-]+\.[^\s]+/gi,
  },
  // 12. Email addresses
  {
    type: "email",
    regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi,
  },
  // 13. Common abbreviations (e.g. Dr., Mr., Mrs., Ms., Prof., vs., etc., e.g., i.e.)
  {
    type: "abbreviation",
    regex: /\b(?:Dr|Mr|Mrs|Ms|Prof|vs|etc|e\.g|i\.e)\./gi,
  },
];

/**
 * Finds all protected lexical spans in the input text.
 * Spans that overlap are merged or priority given to the longer span.
 */
export function findProtectedSpans(text: string): ProtectedSpan[] {
  if (!text) return [];

  const rawSpans: ProtectedSpan[] = [];

  for (const { type, regex } of PROTECTED_PATTERNS) {
    const rx = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = rx.exec(text)) !== null) {
      const raw = match[0];
      const startIndex = match.index;
      const endIndex = startIndex + raw.length;
      rawSpans.push({ type, raw, startIndex, endIndex });
    }
  }

  // Sort by start index ascending, then length descending
  rawSpans.sort((a, b) => {
    if (a.startIndex !== b.startIndex) {
      return a.startIndex - b.startIndex;
    }
    return b.raw.length - a.raw.length;
  });

  // Filter out overlapping spans (keep the earlier/longer one)
  const nonOverlapping: ProtectedSpan[] = [];
  let lastEnd = -1;

  for (const span of rawSpans) {
    if (span.startIndex >= lastEnd) {
      nonOverlapping.push(span);
      lastEnd = span.endIndex;
    }
  }

  return nonOverlapping;
}

/**
 * Checks whether a given character index in the text is strictly inside a protected span.
 */
export function isIndexProtected(index: number, spans: ProtectedSpan[]): boolean {
  for (const span of spans) {
    if (index >= span.startIndex && index < span.endIndex) {
      return true;
    }
    if (span.startIndex > index) {
      break;
    }
  }
  return false;
}

/**
 * Masks all punctuation inside protected spans with sentinel characters,
 * ensuring no candidate sentence/clause boundary splits inside protected spans.
 *
 * Provides a lossless `restore` function that guarantees 100% token fidelity.
 */
export function maskProtectedSpans(text: string): {
  maskedText: string;
  spans: ProtectedSpan[];
  restore: (masked: string) => string;
} {
  const spans = findProtectedSpans(text);
  if (spans.length === 0) {
    return {
      maskedText: text,
      spans: [],
      restore: (s: string) => s,
    };
  }

  const tokenMap = new Map<string, string>();
  let maskedText = "";
  let cursor = 0;

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    maskedText += text.slice(cursor, span.startIndex);

    // Generate unique sentinel token that cannot collide with text
    const token = `__PROT_SPAN_${i}__`;
    tokenMap.set(token, span.raw);
    maskedText += token;

    cursor = span.endIndex;
  }
  maskedText += text.slice(cursor);

  const restore = (str: string): string => {
    let result = str;
    for (const [token, original] of tokenMap.entries()) {
      result = result.split(token).join(original);
    }
    return result;
  };

  return { maskedText, spans, restore };
}

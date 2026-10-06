import { PronunciationRule } from "./types";

interface ClaimedSpan {
  start: number;
  end: number;
  spokenText: string;
  placeholder: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a regex pattern with token boundary protection based on whether
 * the first and last characters are alphanumeric/letters.
 */
export function buildRuleRegex(rule: PronunciationRule): RegExp {
  const escaped = escapeRegex(rule.sourceText);
  const firstChar = rule.sourceText[0];
  const lastChar = rule.sourceText[rule.sourceText.length - 1];

  const startsWithWord = /[\p{L}\p{N}]/u.test(firstChar);
  const endsWithWord = /[\p{L}\p{N}]/u.test(lastChar);

  const prefix = startsWithWord ? "(?<![\\p{L}\\p{N}])" : "";
  const suffix = endsWithWord ? "(?![\\p{L}\\p{N}])" : "";

  const pattern = `${prefix}${escaped}${suffix}`;
  const flags = rule.caseSensitive ? "gu" : "giu";
  return new RegExp(pattern, flags);
}

/**
 * Matches pronunciation rules against the original source text in longest-first order,
 * protects matched spans with non-colliding placeholders, and prepares restoration.
 */
export function matchAndProtectPronunciations(
  text: string,
  rules: PronunciationRule[]
): {
  protectedText: string;
  replacements: Map<string, string>;
  matchedCount: number;
} {
  // Filter enabled rules with non-empty source
  const validRules = rules.filter(
    (r) => r.enabled && r.sourceText && r.sourceText.trim().length > 0
  );

  if (validRules.length === 0) {
    return {
      protectedText: text,
      replacements: new Map(),
      matchedCount: 0,
    };
  }

  // Contract: Longest match first
  const sortedRules = [...validRules].sort(
    (a, b) => b.sourceText.length - a.sourceText.length
  );

  const claimedSpans: ClaimedSpan[] = [];

  for (let ruleIndex = 0; ruleIndex < sortedRules.length; ruleIndex++) {
    const rule = sortedRules[ruleIndex];
    const regex = buildRuleRegex(rule);

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Check for overlap with already claimed spans
      const overlaps = claimedSpans.some(
        (span) => start < span.end && end > span.start
      );

      if (!overlaps) {
        const placeholder = `VOX_PRON_P${claimedSpans.length}_XOV`;
        claimedSpans.push({
          start,
          end,
          spokenText: rule.spokenText,
          placeholder,
        });
      }

      // Safeguard against zero-length infinite regex match
      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }
  }

  if (claimedSpans.length === 0) {
    return {
      protectedText: text,
      replacements: new Map(),
      matchedCount: 0,
    };
  }

  // Sort claimed spans ascending by position
  claimedSpans.sort((a, b) => a.start - b.start);

  const replacements = new Map<string, string>();
  let result = "";
  let lastIndex = 0;

  for (const span of claimedSpans) {
    result += text.slice(lastIndex, span.start);
    result += span.placeholder;
    replacements.set(span.placeholder, span.spokenText);
    lastIndex = span.end;
  }
  result += text.slice(lastIndex);

  return {
    protectedText: result,
    replacements,
    matchedCount: claimedSpans.length,
  };
}

/**
 * Restores protected pronunciation placeholders with their designated spoken forms in a single pass.
 * Non-recursive: spoken forms are never re-evaluated or rematched.
 */
export function restorePronunciations(
  text: string,
  replacements: Map<string, string>
): string {
  if (replacements.size === 0) return text;

  // Single regex matching all placeholders in this pass
  return text.replace(/VOX_PRON_P\d+_XOV/g, (match) => {
    return replacements.get(match) ?? match;
  });
}

import { DiffToken } from "./types";

/**
 * High-performance tokenized diff generator.
 * Divides text into word, whitespace, and punctuation tokens.
 * Uses prefix-suffix elimination + token alignment to handle long documents smoothly.
 */
export function computeTokenDiff(
  originalText: string,
  normalizedText: string
): { diffBefore: DiffToken[]; diffAfter: DiffToken[]; changeCount: number } {
  if (originalText === normalizedText) {
    return {
      diffBefore: [{ text: originalText, type: "equal" }],
      diffAfter: [{ text: normalizedText, type: "equal" }],
      changeCount: 0,
    };
  }

  // Tokenize preserving whitespace, words, and punctuation
  const tokenize = (str: string): string[] => {
    if (!str) return [];
    // Match runs of whitespace, runs of word characters, or individual punctuation
    return str.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [str];
  };

  const origTokens = tokenize(originalText);
  const normTokens = tokenize(normalizedText);

  // 1. Fast common prefix
  let prefixLen = 0;
  while (
    prefixLen < origTokens.length &&
    prefixLen < normTokens.length &&
    origTokens[prefixLen] === normTokens[prefixLen]
  ) {
    prefixLen++;
  }

  // 2. Fast common suffix
  let suffixLen = 0;
  while (
    suffixLen < origTokens.length - prefixLen &&
    suffixLen < normTokens.length - prefixLen &&
    origTokens[origTokens.length - 1 - suffixLen] ===
      normTokens[normTokens.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const diffBefore: DiffToken[] = [];
  const diffAfter: DiffToken[] = [];

  // Add prefix
  if (prefixLen > 0) {
    const prefixText = origTokens.slice(0, prefixLen).join("");
    diffBefore.push({ text: prefixText, type: "equal" });
    diffAfter.push({ text: prefixText, type: "equal" });
  }

  // Middle divergent region
  const origMid = origTokens.slice(prefixLen, origTokens.length - suffixLen);
  const normMid = normTokens.slice(prefixLen, normTokens.length - suffixLen);

  const addDivergentChunks = (
    removedText: string,
    newText: string
  ) => {
    if (!removedText && !newText) return;

    if (!removedText) {
      diffAfter.push({ text: newText, type: "pure_added" });
      return;
    }

    if (!newText) {
      diffBefore.push({ text: removedText, type: "pure_deleted" });
      return;
    }

    // Strip common character prefix within divergent chunk
    let cp = 0;
    while (
      cp < removedText.length &&
      cp < newText.length &&
      removedText[cp] === newText[cp]
    ) {
      cp++;
    }

    if (cp > 0) {
      const commonPrefix = removedText.slice(0, cp);
      diffBefore.push({ text: commonPrefix, type: "equal" });
      diffAfter.push({ text: commonPrefix, type: "equal" });
      removedText = removedText.slice(cp);
      newText = newText.slice(cp);
    }

    // Strip common character suffix within divergent chunk
    let cs = 0;
    while (
      cs < removedText.length &&
      cs < newText.length &&
      removedText[removedText.length - 1 - cs] ===
        newText[newText.length - 1 - cs]
    ) {
      cs++;
    }

    let commonSuffix = "";
    if (cs > 0) {
      commonSuffix = removedText.slice(removedText.length - cs);
      removedText = removedText.slice(0, removedText.length - cs);
      newText = newText.slice(0, newText.length - cs);
    }

    if (removedText && newText) {
      diffBefore.push({
        text: removedText,
        type: "replaced_old",
        oldText: newText,
      });
      diffAfter.push({
        text: newText,
        type: "replaced_new",
        oldText: removedText,
      });
    } else if (removedText) {
      diffBefore.push({ text: removedText, type: "pure_deleted" });
    } else if (newText) {
      diffAfter.push({ text: newText, type: "pure_added" });
    }

    if (commonSuffix) {
      diffBefore.push({ text: commonSuffix, type: "equal" });
      diffAfter.push({ text: commonSuffix, type: "equal" });
    }
  };

  // High-performance smart-sync token alignment (O(N) with lookahead resync)
  let i = 0;
  let j = 0;
  const windowSize = 35;

  while (i < origMid.length || j < normMid.length) {
    if (i < origMid.length && j < normMid.length && origMid[i] === normMid[j]) {
      diffBefore.push({ text: origMid[i], type: "equal" });
      diffAfter.push({ text: normMid[j], type: "equal" });
      i++;
      j++;
    } else {
      let bestMatchI = -1;
      let bestMatchJ = -1;

      const maxD = Math.min(
        windowSize,
        Math.max(origMid.length - i, normMid.length - j)
      );

      outerSync: for (let d = 1; d <= maxD; d++) {
        for (let di = 0; di <= d; di++) {
          const dj = d - di;
          const candidateI = i + di;
          const candidateJ = j + dj;
          if (
            candidateI < origMid.length &&
            candidateJ < normMid.length &&
            origMid[candidateI] === normMid[candidateJ]
          ) {
            const token = origMid[candidateI];
            const isWhitespace = /^\s+$/.test(token);

            // Count consecutive matching tokens
            let matchLen = 1;
            while (
              candidateI + matchLen < origMid.length &&
              candidateJ + matchLen < normMid.length &&
              origMid[candidateI + matchLen] === normMid[candidateJ + matchLen]
            ) {
              matchLen++;
            }

            // Do not resync on lone whitespace tokens to avoid mismatching punctuation
            if (isWhitespace && matchLen < 2) {
              continue;
            }

            bestMatchI = candidateI;
            bestMatchJ = candidateJ;
            break outerSync;
          }
        }
      }

      if (bestMatchI !== -1 && bestMatchJ !== -1) {
        const removedText =
          bestMatchI > i ? origMid.slice(i, bestMatchI).join("") : "";
        const newText =
          bestMatchJ > j ? normMid.slice(j, bestMatchJ).join("") : "";
        addDivergentChunks(removedText, newText);
        i = bestMatchI;
        j = bestMatchJ;
      } else {
        // Consume remaining middle tokens
        const removedText = i < origMid.length ? origMid.slice(i).join("") : "";
        const newText = j < normMid.length ? normMid.slice(j).join("") : "";
        addDivergentChunks(removedText, newText);
        i = origMid.length;
        j = normMid.length;
      }
    }
  }

  // Add suffix
  if (suffixLen > 0) {
    const suffixText = origTokens
      .slice(origTokens.length - suffixLen)
      .join("");
    diffBefore.push({ text: suffixText, type: "equal" });
    diffAfter.push({ text: suffixText, type: "equal" });
  }

  // Merge adjacent tokens of the same type for optimal DOM rendering performance
  const mergeTokens = (tokens: DiffToken[]): DiffToken[] => {
    const merged: DiffToken[] = [];
    for (const tok of tokens) {
      if (!tok.text) continue;
      const last = merged[merged.length - 1];
      if (last && last.type === tok.type) {
        last.text += tok.text;
      } else {
        merged.push({ ...tok });
      }
    }
    return merged;
  };

  const mergedBefore = mergeTokens(diffBefore);
  const mergedAfter = mergeTokens(diffAfter);

  const changedChunksCount = Math.max(
    mergedBefore.filter((t) => t.type !== "equal").length,
    mergedAfter.filter((t) => t.type !== "equal").length
  );

  return {
    diffBefore: mergedBefore,
    diffAfter: mergedAfter,
    changeCount: Math.max(1, changedChunksCount),
  };
}

/**
 * Computes the number of words added and deleted from existing diff tokens.
 * A word is defined as a sequence of unicode letters or numbers (e.g. [\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*).
 * Pure punctuation or whitespace tokens produce 0 words.
 */
export function computeWordDelta(
  diffBefore: DiffToken[],
  diffAfter: DiffToken[]
): { addedWords: number; deletedWords: number } {
  const countWords = (tokens: DiffToken[]): number => {
    let count = 0;
    for (const t of tokens) {
      if (t.type === "equal") continue;
      const matches = t.text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
      if (matches) {
        count += matches.length;
      }
    }
    return count;
  };

  return {
    deletedWords: countWords(diffBefore),
    addedWords: countWords(diffAfter),
  };
}

/**
 * Computes the number of characters added and deleted from existing diff tokens.
 * Deleted characters are calculated from non-equal tokens in diffBefore (pure_deleted, replaced_old, removed).
 * Added characters are calculated from non-equal tokens in diffAfter (pure_added, replaced_new, added, modified).
 * Accurately accounts for whitespace, punctuation, quotes, and text replacement.
 */
export function computeCharDelta(
  diffBefore: DiffToken[],
  diffAfter: DiffToken[]
): { addedChars: number; deletedChars: number } {
  const countChars = (tokens: DiffToken[]): number => {
    let count = 0;
    for (const t of tokens) {
      if (t.type === "equal") continue;
      count += t.text.length;
    }
    return count;
  };

  return {
    deletedChars: countChars(diffBefore),
    addedChars: countChars(diffAfter),
  };
}



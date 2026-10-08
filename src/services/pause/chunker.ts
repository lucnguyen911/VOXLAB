import { ChunkItem } from "../../types/ui";
import { parsePauseDurationMs } from "./types";

export interface SmartChunkOptions {
  targetSentences?: number; // default: 3
  hardMaxChars?: number;    // default: 600
}

/**
 * Token protection utility for technical tokens, custom pronunciation spans,
 * numeric units, currencies, abbreviations, and proper names during sentence/long-text splitting.
 */
export function protectSemanticTokens(text: string): {
  protectedText: string;
  restore: (str: string) => string;
} {
  let sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
  while (text.includes(sessionKey)) {
    sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  const protectedItems: string[] = [];
  // Protect:
  // 1. Custom pronunciation placeholders (VOX_PRON_P..._XOV)
  // 2. Manual pause representations ([PAUSE ...])
  // 3. URLs and emails
  // 4. Numbers with commas/decimals (15,000, 3.14)
  // 5. Abbreviations with periods (Dr., Mr., Mrs., Ms., Prof., e.g., i.e.)
  // 6. Currencies ($119B, $15,000, 500.000₫)
  // 7. Numeric units (1.2 MW, 20 km/h, 13.5%, 5°C, -10°C, 10-15)
  // 8. Technical model tokens (RTX-5090, v1.2.3, 127.0.0.1, AI-5, X-1)
  // 9. Proper names (Shin-Etsu, Mercedes-Benz, Rolls-Royce, Harley-Davidson)
  const tokenPattern =
    /(?:VOX_PRON_P\d+_XOV|\[(?:PAUSE|pause)\s+[^\]]+\]|https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+|\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b|\b\d{1,2}:\d{2}(?::\d{2})?\b|\b\d+:\d+\b|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\bv?\d+(?:\.\d+)+[a-zA-Z0-9._-]*\b|\b(?:Dr|Mr|Mrs|Ms|Prof|Rev|Gen|Sen|Rep|St|Jr|Sr)\.(?:[A-Z][a-zA-Z]+|(?=\s|$|[,/:;!?)[\]]))|\b(?:e\.g|i\.e|etc|vs|al|a\.m|p\.m|E\.G|I\.E)\.|\b(?:Shin-Etsu|Mercedes-Benz|Rolls-Royce|Harley-Davidson|Coca-Cola)\b|\b[A-Za-z]+-[0-9]+[A-Za-z0-9_-]*\b|\b[A-Za-z]-[0-9]+\b|\b\$\d+(?:\.\d+)?[BMKbmk]?\b|\b\d+(?:\.\d+)?\s*(?:MW|kW|km\/h|m\/s|%|°C|°F|V|kV|A|mA|Hz|kHz|MHz|GHz|TB|GB|MB|KB|kg|g|mg|km|m|cm|mm|usd|vnd|eur|dollars?|cents?)\b)/gu;

  const protectedText = text.replace(tokenPattern, (match) => {
    protectedItems.push(match);
    return `VOXTOK${sessionKey}P${protectedItems.length - 1}XOT`;
  });

  const restore = (str: string): string => {
    const restoreRegex = new RegExp(`VOXTOK${sessionKey}P(\\d+)XOT`, "g");
    return str.replace(restoreRegex, (_, idx) => protectedItems[Number(idx)] ?? "");
  };

  return { protectedText, restore };
}

/**
 * Splits a single long sentence (> hardMax) into smaller parts <= hardMax characters.
 * Boundary priority:
 * 1. Clause boundary: ';'
 * 2. Clause boundary: ':'
 * 3. Safe comma: ','
 * 4. Safe whitespace fallback
 * Never splits inside protected semantic tokens.
 */
export function splitLongSentence(sentence: string, hardMax = 600): string[] {
  const trimmed = sentence.trim();
  if (!trimmed) return [];
  if (trimmed.length <= hardMax) return [trimmed];

  const { protectedText, restore } = protectSemanticTokens(trimmed);

  const splitProtected = (str: string, maxLen: number): string[] => {
    if (str.length <= maxLen) return [str];

    // Find cut position within searchWindow [1, maxLen]
    const searchWindow = str.slice(0, maxLen + 1);

    let cutIndex = -1;
    let delimiterLen = 1;

    // 1. Semicolons
    const semiIdx = searchWindow.lastIndexOf(";");
    if (semiIdx > 0 && semiIdx < maxLen) {
      cutIndex = semiIdx + 1;
    }

    // 2. Colons
    if (cutIndex === -1) {
      const colonIdx = searchWindow.lastIndexOf(":");
      if (colonIdx > 0 && colonIdx < maxLen) {
        cutIndex = colonIdx + 1;
      }
    }

    // 3. Safe comma
    if (cutIndex === -1) {
      const commaIdx = searchWindow.lastIndexOf(",");
      if (commaIdx > 0 && commaIdx < maxLen) {
        cutIndex = commaIdx + 1;
      }
    }

    // 4. Safe whitespace
    if (cutIndex === -1) {
      const wsMatch = searchWindow.match(/\s+(?=[^\s]*$)/);
      if (wsMatch && wsMatch.index !== undefined && wsMatch.index > 0) {
        cutIndex = wsMatch.index;
        delimiterLen = wsMatch[0].length;
      }
    }

    // Fallback if no delimiter found in searchWindow (unbreakable sequence)
    if (cutIndex <= 0) {
      cutIndex = maxLen;
      delimiterLen = 0;
    }

    const head = str.slice(0, cutIndex).trim();
    const tail = str.slice(cutIndex + (delimiterLen > 1 ? delimiterLen : 0)).trim();

    const parts: string[] = [];
    if (head.length > 0) {
      parts.push(head);
    }
    if (tail.length > 0) {
      parts.push(...splitProtected(tail, maxLen));
    }
    return parts;
  };

  const rawChunks = splitProtected(protectedText, hardMax);
  return rawChunks.map((c) => restore(c).trim()).filter((c) => c.length > 0);
}

/**
 * Splits a paragraph into individual sentences.
 * Respects sentence terminators (. ! ? …) followed by whitespace,
 * while protecting abbreviations (Dr., e.g., i.e.) and decimals (3.14).
 */
export function splitParagraphIntoSentences(paragraph: string): string[] {
  const trimmed = paragraph.trim();
  if (!trimmed) return [];

  const { protectedText, restore } = protectSemanticTokens(trimmed);

  // Split on sentence-ending punctuation followed by whitespace and a non-lowercase character
  const sentenceRegex = /(?<=[.!?…])\s+(?=[A-Z\p{Lu}\d"“'‘\p{L}])/gu;
  const parts = protectedText.split(sentenceRegex);

  return parts
    .map((p) => restore(p).trim())
    .filter((p) => p.length > 0);
}

/**
 * Calculates balanced sentence counts per chunk to avoid singleton tail chunks.
 * Target distribution:
 * 1 -> 1, 2 -> 2, 3 -> 3, 4 -> 2+2, 5 -> 3+2, 6 -> 3+3, 7 -> 3+2+2, 8 -> 3+3+2, 9 -> 3+3+3, 10 -> 3+3+2+2
 */
export function calculateBalancedSentenceCounts(totalSentences: number, target = 3): number[] {
  if (totalSentences <= 0) return [];
  if (totalSentences <= target) return [totalSentences];

  const remainder = totalSentences % target;
  if (remainder === 0) {
    return Array(totalSentences / target).fill(target);
  }
  if (remainder === 2) {
    const threeCount = Math.floor(totalSentences / target);
    return [...Array(threeCount).fill(target), 2];
  }
  // remainder === 1: partition tail into two 2-sentence chunks (e.g. 4 -> [2, 2], 7 -> [3, 2, 2])
  const threeCount = Math.floor(totalSentences / target) - 1;
  return [...Array(threeCount).fill(target), 2, 2];
}

/**
 * Groups sentences belonging to the same paragraph / pause segment into smart chunks.
 * Target: ~3 sentences per chunk with balanced tail chunking (avoids single-sentence tail when safe).
 * Hard max: 600 characters per chunk (higher priority than target count).
 */
export function groupSentencesIntoChunks(
  sentences: string[],
  targetSentences = 3,
  hardMax = 600
): string[] {
  // 1. Pre-split any individual sentence longer than hardMax
  const flatSentences: string[] = [];
  for (const rawSentence of sentences) {
    if (rawSentence.length > hardMax) {
      flatSentences.push(...splitLongSentence(rawSentence, hardMax));
    } else if (rawSentence.trim().length > 0) {
      flatSentences.push(rawSentence.trim());
    }
  }

  if (flatSentences.length === 0) return [];

  // Helper to test if a planned partition is valid under hardMax
  const tryPartition = (counts: number[]): string[] | null => {
    const result: string[] = [];
    let idx = 0;
    for (const count of counts) {
      const group = flatSentences.slice(idx, idx + count);
      const text = group.join(" ");
      if (text.length > hardMax) {
        return null; // Exceeds hardMax
      }
      result.push(text);
      idx += count;
    }
    return result;
  };

  // 2. Try the ideal balanced distribution
  const idealCounts = calculateBalancedSentenceCounts(flatSentences.length, targetSentences);
  const balancedResult = tryPartition(idealCounts);
  if (balancedResult) {
    return balancedResult;
  }

  // 3. Fallback: Dynamic greedy grouping when balanced distribution exceeds hardMax
  const chunks: string[] = [];
  let currentGroup: string[] = [];
  let currentLen = 0;

  for (const sent of flatSentences) {
    const sentLen = sent.length;

    // Check if adding this sentence to currentGroup would exceed hardMax
    const wouldExceedMax =
      currentGroup.length > 0 &&
      currentLen + 1 + sentLen > hardMax;

    const reachedTarget = currentGroup.length >= targetSentences;

    if (wouldExceedMax || reachedTarget) {
      if (currentGroup.length > 0) {
        chunks.push(currentGroup.join(" "));
        currentGroup = [];
        currentLen = 0;
      }
    }

    currentGroup.push(sent);
    currentLen = currentGroup.join(" ").length;
  }

  if (currentGroup.length > 0) {
    chunks.push(currentGroup.join(" "));
  }

  // 4. Safe tail rebalancing if greedy grouping produced a singleton tail
  if (chunks.length >= 2) {
    const lastChunk = chunks[chunks.length - 1];
    const prevChunk = chunks[chunks.length - 2];

    const lastSentences = splitParagraphIntoSentences(lastChunk);
    const prevSentences = splitParagraphIntoSentences(prevChunk);

    if (lastSentences.length === 1 && prevSentences.length >= 3) {
      const movedSentence = prevSentences[prevSentences.length - 1];
      const newPrevSentences = prevSentences.slice(0, -1);
      const newLastSentences = [movedSentence, ...lastSentences];

      const newPrevText = newPrevSentences.join(" ");
      const newLastText = newLastSentences.join(" ");

      if (newPrevText.length <= hardMax && newLastText.length <= hardMax) {
        chunks[chunks.length - 2] = newPrevText;
        chunks[chunks.length - 1] = newLastText;
      }
    }
  }

  return chunks;
}

/**
 * Core Smart Chunking implementation for Voice Generation scripts.
 * Replaces old 1-sentence = 1-chunk behavior with multi-sentence chunking.
 *
 * Rules:
 * 1. Target: ~3 sentences per chunk.
 * 2. Hard max: 600 characters per chunk.
 * 3. Boundary priority:
 *    Manual Pause (hard) -> Section / structural break -> Paragraph boundary (\n\n) -> Sentence (. ! ?) -> Clause (; :) -> Comma -> Whitespace.
 * 4. Manual Pause tokens [PAUSE {ms}ms] act as unconditional hard boundaries.
 * 5. Deterministic, pure, no text loss or duplication.
 */
export function smartChunkScript(
  script: string,
  options?: SmartChunkOptions
): ChunkItem[] {
  const trimmed = script.trim();
  if (!trimmed) return [];

  const targetSentences = options?.targetSentences ?? 3;
  const hardMaxChars = options?.hardMaxChars ?? 600;

  // Step 1: Split on Manual Pause tokens (HARD BOUNDARY)
  const pauseRegex = /(\[(?:PAUSE|pause)\s+\d+(?:\.\d+)?\s*(?:ms|s)?\])/gi;
  const parts = trimmed.split(pauseRegex);

  interface RawChunkWithPause {
    text: string;
    pauseAfterMs: number | "auto";
  }

  const rawChunks: RawChunkWithPause[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (pauseRegex.test(part)) {
      // Pause token: attach duration to the preceding chunk if available
      const durationMs = parsePauseDurationMs(part) ?? 1000;
      if (rawChunks.length > 0) {
        rawChunks[rawChunks.length - 1].pauseAfterMs = durationMs;
      }
    } else {
      const segText = part.trim();
      if (!segText) continue;

      // Step 2: Split segment into paragraphs (priority 3 boundary: never merge across \n\n)
      const paragraphs = segText
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      for (const para of paragraphs) {
        // Step 3: Split paragraph into sentences
        const sentences = splitParagraphIntoSentences(para);

        // Step 4: Group sentences into smart chunks (~3 sentences, max 600 chars)
        const groupedChunks = groupSentencesIntoChunks(
          sentences,
          targetSentences,
          hardMaxChars
        );

        for (const chunkText of groupedChunks) {
          rawChunks.push({
            text: chunkText,
            pauseAfterMs: "auto",
          });
        }
      }
    }
  }

  return rawChunks.map((chunk, idx) => {
    // Remove any accidental remnant pause tokens from spoken text
    const cleanText = chunk.text.replace(/\[(?:PAUSE|pause)\s+[^\]]+\]/gi, "").trim();
    const wordCount = cleanText ? cleanText.split(/\s+/).length : 0;
    const estSec = Math.max(1.2, Math.round((wordCount / 3.0) * 10) / 10);

    return {
      id: `chunk_${String(idx + 1).padStart(2, "0")}`,
      index: idx + 1,
      text: cleanText,
      originalText: cleanText,
      status: "pending",
      durationSec: estSec,
      pauseAfterMs: chunk.pauseAfterMs,
    };
  });
}

/**
 * Backward-compatible entrypoint used across the application.
 * Fully backed by the new Smart Chunking engine.
 */
export function splitScriptWithPauses(script: string): ChunkItem[] {
  return smartChunkScript(script, {
    targetSentences: 3,
    hardMaxChars: 600,
  });
}

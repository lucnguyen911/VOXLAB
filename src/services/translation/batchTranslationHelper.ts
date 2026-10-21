/**
 * Batch translation helper for VoxLab.
 * Implements Adaptive Full-Context Batching:
 * - Short/medium scripts (<= 45 items): Translates the entire script in 1 single request.
 * - Long scripts (> 45 items): Splits into balanced ~35-item batches while injecting
 *   a Global Script Summary + preceding translated lines for 100% tone/pronoun consistency.
 */

import { BatchItem, BatchTranslationContext } from "./types";

export type { BatchItem, BatchTranslationContext };

/** Maximum number of cues/groups to send in a single 1-pass full-script request */
export const SINGLE_PASS_MAX_ITEMS = 45;

/** Target items per batch when a script exceeds SINGLE_PASS_MAX_ITEMS */
export const ADAPTIVE_BATCH_TARGET_SIZE = 35;

/**
 * Strips `<think>...</think>` reasoning blocks emitted by reasoning LLMs
 * (such as DeepSeek-R1, Qwen3, Gemma 4) so only the final translation output remains.
 */
export function stripThinkingTags(rawContent: string): string {
  if (!rawContent) return "";
  return rawContent
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
}

/**
 * Builds a compact overview of the full script (opening, middle, and closing lines)
 * so each batch knows the overall topic, tone, and speaker context of the video.
 */
export function buildGlobalScriptSummary(allTexts: string[], maxChars = 480): string {
  const cleaned = allTexts
    .map((t) => t.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (cleaned.length === 0) return "";

  if (cleaned.length <= 8) {
    return cleaned.join(" | ").slice(0, maxChars);
  }

  const head = cleaned.slice(0, 3).join(" / ");
  const midIdx = Math.floor(cleaned.length / 2);
  const mid = cleaned.slice(Math.max(3, midIdx - 1), Math.max(4, midIdx + 1)).join(" / ");
  const tail = cleaned.slice(-2).join(" / ");

  const combined = `Opening: ${head} ... Middle: ${mid} ... Ending: ${tail}`;
  return combined.length > maxChars ? `${combined.slice(0, maxChars)}...` : combined;
}

/**
 * Splits items adaptively:
 * - If `items.length <= singlePassMax` (default 45): returns a single batch `[items]` (1 request for the whole file).
 * - If `items.length > singlePassMax`: divides into balanced batches (~30-35 items each) so there is never a tiny 1-3 item tail batch.
 */
export function chunkArrayAdaptive<T>(
  items: T[],
  singlePassMax = SINGLE_PASS_MAX_ITEMS,
  targetBatchSize = ADAPTIVE_BATCH_TARGET_SIZE
): T[][] {
  if (items.length === 0) return [];
  if (items.length <= singlePassMax) {
    return [items];
  }

  const numBatches = Math.ceil(items.length / targetBatchSize);
  const balancedSize = Math.ceil(items.length / numBatches);
  return chunkArray(items, balancedSize);
}

/**
 * Estimates LLM token count for a string (conservative ~1 token per 3.4 characters
 * or 1.35x word count, plus overhead).
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  const charBased = Math.ceil(text.length / 3.4);
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const wordBased = Math.ceil(wordCount * 1.35);
  return Math.max(charBased, wordBased);
}

/**
 * Extracts recurring proper nouns, capitalized entities, technical acronyms, and numbers+units
 * across the entire script so parallel batches maintain 100% terminology and entity consistency.
 */
export function extractScriptGlossaryAndEntities(
  allTexts: string[],
  maxTerms = 24
): string[] {
  const counts = new Map<string, number>();
  const displayForm = new Map<string, string>();
  const commonIgnore = new Set([
    "the", "and", "for", "with", "that", "this", "from", "have", "what", "when",
    "where", "which", "while", "your", "they", "their", "there", "here", "today",
    "welcome", "hello", "thank", "thanks", "but", "not", "you", "are", "was", "were",
    "can", "will", "just", "now", "how", "why", "who", "all", "one", "two", "three",
  ]);

  for (const raw of allTexts) {
    const cleaned = (raw || "").replace(/\r\n|\r|\n/g, " ").trim();
    if (!cleaned) continue;

    // Match multi-word capitalized entities, acronyms, or alphanumeric model names (e.g., "BMW M3", "RTX 5070", "Porsche 911")
    const entityRegex = /\b([A-Z][A-Za-z0-9_-]{1,}(?:\s+[A-Z0-9][A-Za-z0-9_.-]*)*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = entityRegex.exec(cleaned)) !== null) {
      const candidate = match[1].trim();
      if (candidate.length < 2) continue;
      const lower = candidate.toLowerCase();
      if (commonIgnore.has(lower)) continue;
      counts.set(lower, (counts.get(lower) || 0) + 1);
      if (!displayForm.has(lower)) {
        displayForm.set(lower, candidate);
      }
    }
  }

  // Keep terms that appear >= 2 times, or multi-word / alphanumeric technical terms
  const ranked = Array.from(counts.entries())
    .filter(([key, count]) => count >= 2 || key.includes(" ") || /\d/.test(key))
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([key]) => displayForm.get(key) || key);

  return ranked;
}

/**
 * Splits items into batches respecting BOTH item count (`chunkArrayAdaptive`)
 * and input/output token budgets (`maxInputTokens`, `maxOutputTokens`).
 * Never splits a single item across multiple batches.
 */
export function chunkItemsTokenAware<T>(
  items: T[],
  getText: (item: T) => string,
  options?: {
    singlePassMax?: number;
    targetBatchSize?: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
  }
): T[][] {
  if (items.length === 0) return [];

  const singlePassMax = options?.singlePassMax ?? SINGLE_PASS_MAX_ITEMS;
  const targetBatchSize = options?.targetBatchSize ?? ADAPTIVE_BATCH_TARGET_SIZE;
  const maxOutputTokens =
    options?.maxOutputTokens && options.maxOutputTokens > 0
      ? options.maxOutputTokens
      : 4096;
  const maxInputTokens =
    options?.maxInputTokens && options.maxInputTokens > 0
      ? options.maxInputTokens
      : Math.max(1800, Math.floor(maxOutputTokens * 0.75));
  // Reserve 25% of output token budget for expansion in target language (e.g. English -> Vietnamese)
  const safeBatchTokenBudget = Math.min(
    maxInputTokens,
    Math.max(400, Math.floor((maxOutputTokens - 250) / 1.35))
  );

  const initialBatches = chunkArrayAdaptive(items, singlePassMax, targetBatchSize);
  const finalBatches: T[][] = [];

  for (const batch of initialBatches) {
    let currentSubBatch: T[] = [];
    let currentTokens = 0;

    for (const item of batch) {
      const itemText = getText(item) || "";
      const itemTokens = Math.max(8, estimateTokenCount(itemText) + 6);

      if (
        currentSubBatch.length > 0 &&
        currentTokens + itemTokens > safeBatchTokenBudget
      ) {
        finalBatches.push(currentSubBatch);
        currentSubBatch = [item];
        currentTokens = itemTokens;
      } else {
        currentSubBatch.push(item);
        currentTokens += itemTokens;
      }
    }

    if (currentSubBatch.length > 0) {
      finalBatches.push(currentSubBatch);
    }
  }

  return finalBatches;
}

export function buildBatchTranslationPrompt(
  items: BatchItem[],
  targetLang: string,
  style = "default",
  batchContext?: BatchTranslationContext
): { system: string; user: string } {
  const isCinema = style === "cinema";
  const isFreeNarration = batchContext?.dubbingMode === "free_narration";

  let system: string;
  if (isFreeNarration) {
    system = isCinema
      ? `You are an elite video scriptwriter and narration adapter. Translate the numbered dialogue/narration units into ${targetLang} with rich, cinematic, and captivating prose suited for documentary and YouTube voiceovers. Do NOT compress or artificially shorten sentences for timing. Prioritize fluent rhythm, natural grammar, idiomatic expressions, consistent pronouns, and preserve all proper nouns, numbers, and key facts. Strict rule: Keep the exact line number format \`[id] translated text\` on each line with NO markdown formatting, conversational filler, or commentary.`
      : `You are an expert narration translator and script adaptation specialist. Translate the numbered dialogue/narration units into ${targetLang} with complete, natural, and fluent phrasing suited for engaging YouTube narration and voiceover. Do NOT artificially compress sentences for timing. Maintain natural sentence structures, correct idioms, consistent pronouns, and preserve all proper nouns, numbers, and key terminology. Strict rule: Keep the exact line number format \`[id] translated text\` on each line with NO markdown formatting, conversational filler, or commentary.`;
  } else {
    system = isCinema
      ? `You are a professional film/video subtitle translator and adaptation specialist. Translate the numbered speech units into ${targetLang}. Adapt each unit to sound natural, punchy, and cinematic when spoken, while fitting comfortably within spoken timing constraints without dropping any critical meaning, proper nouns, numbers, or key terminology. Strict rule: Keep the exact line number format \`[id] translated text\` on each line with NO markdown formatting, conversational filler, or commentary.`
      : `You are an expert subtitle and dubbing translator. Translate the numbered speech units into ${targetLang} with concise, natural phrasing that matches spoken timing without dropping critical meaning, proper nouns, numbers, or key terminology. Maintain consistent pronouns and tone across the script. Strict rule: Keep the exact line number format \`[id] translated text\` on each line with NO markdown formatting, conversational filler, or commentary.`;
  }

  const contextBlocks: string[] = [];

  if (batchContext?.isFullScriptSinglePass) {
    contextBlocks.push(
      `Note: Below is the complete script (${items.length} lines). Maintain 100% consistent pronouns, character tone, and terminology from start to finish.`
    );
  } else {
    if (batchContext?.globalSummary) {
      contextBlocks.push(
        `Global Video Context (for topic & tone reference only — DO NOT translate):\n${batchContext.globalSummary}`
      );
    }
    if (batchContext?.glossaryTerms && batchContext.glossaryTerms.length > 0) {
      contextBlocks.push(
        `Shared Glossary & Proper Nouns (keep these exact names, units, and terms consistent across the script — DO NOT output this list):\n${batchContext.glossaryTerms.join(", ")}`
      );
    }
    if (batchContext?.prevLines && batchContext.prevLines.length > 0) {
      const prevFormatted = batchContext.prevLines
        .map((p) => `- "${p.source}" -> "${p.translated}"`)
        .join("\n");
      contextBlocks.push(
        `Preceding Translated Lines (match these exact pronouns & terminology — DO NOT repeat in output):\n${prevFormatted}`
      );
    } else if (
      batchContext?.surroundingContextBefore &&
      batchContext.surroundingContextBefore.length > 0
    ) {
      const beforeFormatted = batchContext.surroundingContextBefore
        .map((line) => `- "${line}"`)
        .join("\n");
      contextBlocks.push(
        `Preceding Source Lines (READ-ONLY context for pronoun & flow continuity — DO NOT translate or include in output):\n${beforeFormatted}`
      );
    }
    if (
      batchContext?.surroundingContextAfter &&
      batchContext.surroundingContextAfter.length > 0
    ) {
      const afterFormatted = batchContext.surroundingContextAfter
        .map((line) => `- "${line}"`)
        .join("\n");
      contextBlocks.push(
        `Following Source Lines (READ-ONLY lookahead context — DO NOT translate or include in output):\n${afterFormatted}`
      );
    }
  }

  const userLines = items.map((it) => `[${it.id}] ${it.text}`).join("\n");
  const contextHeader = contextBlocks.length > 0 ? `${contextBlocks.join("\n\n")}\n\n` : "";
  const user = `${contextHeader}Translate each numbered line below into ${targetLang} (output ONLY \`[id] translation\` lines):\n\n${userLines}`;

  return { system, user };
}

export function parseBatchTranslationResponse(
  rawContent: string,
  expectedItems: BatchItem[]
): Map<number, string> {
  const result = new Map<number, string>();
  if (!rawContent) return result;

  // Strip thinking tags (<think>...</think>) and markdown code fences
  const cleaned = stripThinkingTags(rawContent)
    .replace(/^```[a-zA-Z]*\n/gm, "")
    .replace(/^```$/gm, "");

  // Match lines like: [1] Translation or [1]: Translation or 1. [1] Translation
  const regex = /^\s*(?:\d+[\.\)]\s*)?\[(\d+)\]\s*:?\s*(.*)$/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cleaned)) !== null) {
    const id = parseInt(match[1], 10);
    const text = match[2].trim();
    if (!isNaN(id) && text) {
      result.set(id, text);
    }
  }

  // Fallback: If LLM output plain numbered lines like "1. Translation" without brackets
  if (result.size < expectedItems.length / 2) {
    const fallbackRegex = /^\s*(\d+)[\.\:]\s*(.*)$/gm;
    while ((match = fallbackRegex.exec(cleaned)) !== null) {
      const id = parseInt(match[1], 10);
      const text = match[2].trim();
      if (!isNaN(id) && text && !result.has(id)) {
        result.set(id, text);
      }
    }
  }

  return result;
}

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 2
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runner(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  const promises: Promise<void>[] = [];
  for (let i = 0; i < poolSize; i++) {
    promises.push(runner());
  }

  await Promise.all(promises);
  return results;
}

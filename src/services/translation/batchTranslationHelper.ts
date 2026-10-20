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
    if (batchContext?.prevLines && batchContext.prevLines.length > 0) {
      const prevFormatted = batchContext.prevLines
        .map((p) => `- "${p.source}" -> "${p.translated}"`)
        .join("\n");
      contextBlocks.push(
        `Preceding Translated Lines (match these exact pronouns & terminology — DO NOT repeat in output):\n${prevFormatted}`
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

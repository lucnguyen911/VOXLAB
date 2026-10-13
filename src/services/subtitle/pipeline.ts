import { ChunkItem, PunctuationPauses } from "../../types/ui";
import {
  getTargetPauseMs,
  calculateEffectiveSilenceGapMs,
} from "../pause/punctuationPause";
import {
  SpeechUnit,
  SubtitleAspectRatio,
  SubtitleCue,
} from "./types";
import { getSubtitleProfile, loadSubtitleSettings } from "./profiles";
import {
  splitIntoSentences,
  splitLongSentenceIntoClauses,
  getWordCount,
  getDisplayWidth,
  wrapCueTextBalanced,
} from "./candidates";
import { optimizeSubtitles } from "./optimizer";
import { validateSubtitles } from "./validator";
import { exportToSrt } from "./exporter";

export interface SubtitlePipelineOptions {
  aspectRatio?: SubtitleAspectRatio;
  maxLines?: number;
  punctuationPauses?: PunctuationPauses;
  totalAudioDurationSec?: number;
  wrapLines?: boolean;
}

/**
 * Builds precise SpeechUnits from generated TTS ChunkItems using real audio durations
 * and calculated punctuation pauses (with trailing silence deduction).
 * Long TTS chunks (> 8 words or > 36 chars) are decomposed into natural sentence/clause
 * sub-units with proportional timing so `generateSubtitlesFromChunks` never copies
 * a 20-35 word TTS chunk as a single monolithic cue.
 */
export function buildSpeechUnitsFromChunks(
  chunks: ChunkItem[],
  punctuationPauses?: PunctuationPauses,
  aspectRatio: SubtitleAspectRatio = "16:9"
): SpeechUnit[] {
  if (!chunks || chunks.length === 0) return [];

  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  const units: SpeechUnit[] = [];
  let currentTime = 0;

  const baseProfile = getSubtitleProfile(aspectRatio, 1);
  const clauseProfile = {
    ...baseProfile,
    maxLines: 1,
    targetWidth: Math.min(27, baseProfile.targetWidth),
    maxWidth: Math.min(32, baseProfile.maxWidth),
    targetWords: 6,
    maxWords: 8,
  };

  for (let i = 0; i < sorted.length; i++) {
    const chunk = sorted[i];
    const durationSec =
      typeof chunk.durationSec === "number" && !isNaN(chunk.durationSec)
        ? Math.max(0.1, chunk.durationSec)
        : 1.0;

    const startSec = currentTime;
    const endSec = currentTime + durationSec;
    currentTime = endSec;

    // Calculate pause duration before next chunk
    const isLast = i === sorted.length - 1;
    let pauseSec = 0;

    if (!isLast) {
      if (punctuationPauses) {
        const targetPauseMs = getTargetPauseMs(
          chunk.text,
          punctuationPauses,
          chunk.pauseAfterMs
        );
        const effectivePauseMs = calculateEffectiveSilenceGapMs(
          targetPauseMs,
          chunk.trailingSilenceMs ?? 0
        );
        pauseSec = effectivePauseMs / 1000;
      } else if (typeof chunk.pauseAfterMs === "number" && chunk.pauseAfterMs > 0) {
        pauseSec = chunk.pauseAfterMs / 1000;
      }
      currentTime += pauseSec;
    } else if (
      !punctuationPauses &&
      typeof chunk.pauseAfterMs === "number" &&
      chunk.pauseAfterMs > 0
    ) {
      pauseSec = chunk.pauseAfterMs / 1000;
      currentTime += pauseSec;
    }

    const cleanChunkText = chunk.text.replace(/\[pause[^\]]*\]/gi, " ").replace(/\s+/g, " ").trim();
    if (!cleanChunkText) continue;

    // Short chunks remain a single unit so adjacent short chunks can merge cleanly
    if (getWordCount(cleanChunkText) <= 8 && getDisplayWidth(cleanChunkText) <= 36) {
      units.push({
        id: chunk.id,
        text: cleanChunkText,
        startSec,
        endSec,
        durationSec,
        pauseAfterSec: pauseSec,
      });
      continue;
    }

    // Long TTS chunks: decompose into natural sentences and clauses
    const sentences = splitIntoSentences(cleanChunkText);
    const subClauses: string[] = [];
    for (const s of sentences) {
      subClauses.push(...splitLongSentenceIntoClauses(s, clauseProfile));
    }

    const validClauses = subClauses.map((c) => c.trim()).filter(Boolean);
    if (validClauses.length <= 1) {
      units.push({
        id: chunk.id,
        text: cleanChunkText,
        startSec,
        endSec,
        durationSec,
        pauseAfterSec: pauseSec,
      });
      continue;
    }

    const weights = validClauses.map((c) => {
      const charWeight = Math.max(1, c.length);
      const punctBonus = /[.!?…]$/u.test(c) ? 6 : /[,;:]$/u.test(c) ? 3 : 0;
      return charWeight + punctBonus;
    });
    const totalWeight = weights.reduce((acc, w) => acc + w, 0) || 1;
    let subCursor = startSec;

    for (let k = 0; k < validClauses.length; k++) {
      const isLastSub = k === validClauses.length - 1;
      const subDur = isLastSub
        ? Math.max(0.05, endSec - subCursor)
        : Math.max(0.05, Math.round((durationSec * (weights[k] / totalWeight)) * 1000) / 1000);
      const subStart = Math.round(subCursor * 1000) / 1000;
      const subEnd = isLastSub ? Math.round(endSec * 1000) / 1000 : Math.round((subStart + subDur) * 1000) / 1000;
      subCursor = subEnd;

      units.push({
        id: `${chunk.id}_sub_${k + 1}`,
        text: validClauses[k],
        startSec: subStart,
        endSec: Math.max(subStart + 0.05, subEnd),
        durationSec: Math.max(0.05, subEnd - subStart),
        pauseAfterSec: isLastSub ? pauseSec : 0,
      });
    }
  }

  return units;
}

/**
 * Generates optimized SubtitleCues from TTS ChunkItems.
 * Long chunks are split into natural YouTube Cinematic clauses and short adjacent units
 * are merged according to the active aspect ratio profile, while respecting audio timestamps.
 */
export function generateSubtitlesFromChunks(
  chunks: ChunkItem[],
  options?: SubtitlePipelineOptions
): SubtitleCue[] {
  if (!chunks || chunks.length === 0) return [];

  const settings = loadSubtitleSettings();
  const aspectRatio = options?.aspectRatio || settings.aspectRatio;
  const maxLines = options?.maxLines || settings.maxLines;
  const profile = getSubtitleProfile(aspectRatio, maxLines);

  const speechUnits = buildSpeechUnitsFromChunks(
    chunks,
    options?.punctuationPauses,
    aspectRatio
  );
  const rawCues = optimizeSubtitles(speechUnits, profile);
  const shouldWrap = options?.wrapLines !== false && profile.maxLines >= 2;
  const cues = shouldWrap
    ? rawCues.map((c) => ({
        ...c,
        text: wrapCueTextBalanced(c.text, profile),
      }))
    : rawCues;

  // Validate the resulting cues against full original text
  const originalText = chunks
    .map((c) => c.text.replace(/\[pause[^\]]*\]/gi, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  const validation = validateSubtitles(cues, originalText);
  if (!validation.valid) {
    console.warn("Subtitle validation warnings/errors:", validation.errors);
  }

  return cues;
}

/**
 * Generates optimized SubtitleCues directly from a text string.
 * Used for pre-synthesis analysis, offline subtitle generation, and test suites.
 *
 * Pipeline:
 * Text -> Protected Spans -> Sentences -> Long Clause Splits -> Speech Units -> Optimizer -> Validator.
 */
export function generateSubtitlesFromText(
  text: string,
  options?: SubtitlePipelineOptions & { speechRateWordsPerSec?: number }
): SubtitleCue[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const settings = loadSubtitleSettings();
  const aspectRatio = options?.aspectRatio || settings.aspectRatio;
  const maxLines = options?.maxLines || settings.maxLines;
  const profile = getSubtitleProfile(aspectRatio, maxLines);
  const speechRate = options?.speechRateWordsPerSec || 2.5; // ~2.5 words per second

  // 1. Split into sentence candidates (protecting decimals, URLs, dates, numbers)
  const rawSentences = splitIntoSentences(trimmed);

  // 2. Further split overly long sentences at natural clause / semicolon / comma boundaries
  const candidateClauses: string[] = [];
  for (const s of rawSentences) {
    const subClauses = splitLongSentenceIntoClauses(s, profile);
    candidateClauses.push(...subClauses);
  }

  // 3. Build speech units with realistic timeline
  let currentTime = 0;
  const speechUnits: SpeechUnit[] = [];

  for (let i = 0; i < candidateClauses.length; i++) {
    const clauseText = candidateClauses[i];
    const wordCount = getWordCount(clauseText);
    const duration = Math.max(0.8, Math.round((wordCount / speechRate) * 10) / 10);

    const startSec = currentTime;
    const endSec = currentTime + duration;
    currentTime = endSec;

    // Small pause (0.4s) after clauses ending in punctuation
    const hasPunct = /[.!?…]$/u.test(clauseText.trim());
    const pause = hasPunct ? 0.4 : 0.0;
    currentTime += pause;

    speechUnits.push({
      id: i + 1,
      text: clauseText,
      startSec,
      endSec,
      durationSec: duration,
      pauseAfterSec: pause,
    });
  }

  // 4. Run DP optimizer to merge short units and balance layout
  const cues = optimizeSubtitles(speechUnits, profile);

  // 5. Final Validation
  const validation = validateSubtitles(cues, trimmed);
  if (!validation.valid) {
    console.warn("Subtitle text validation errors:", validation.errors);
  }

  return cues;
}

/**
 * High-level helper: generates formatted SubRip (.srt) subtitle string from either
 * TTS ChunkItems or raw text.
 */
export function generateSrtContent(
  source: ChunkItem[] | string,
  options?: SubtitlePipelineOptions
): string {
  let cues: SubtitleCue[] = [];
  if (typeof source === "string") {
    cues = generateSubtitlesFromText(source, options);
  } else if (Array.isArray(source)) {
    cues = generateSubtitlesFromChunks(source, options);
  }
  return exportToSrt(cues);
}

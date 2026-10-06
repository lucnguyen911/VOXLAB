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
} from "./candidates";
import { optimizeSubtitles } from "./optimizer";
import { validateSubtitles } from "./validator";
import { exportToSrt } from "./exporter";

export interface SubtitlePipelineOptions {
  aspectRatio?: SubtitleAspectRatio;
  maxLines?: number;
  punctuationPauses?: PunctuationPauses;
  totalAudioDurationSec?: number;
}

/**
 * Builds precise SpeechUnits from generated TTS ChunkItems using real audio durations
 * and calculated punctuation pauses (with trailing silence deduction).
 */
export function buildSpeechUnitsFromChunks(
  chunks: ChunkItem[],
  punctuationPauses?: PunctuationPauses
): SpeechUnit[] {
  if (!chunks || chunks.length === 0) return [];

  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  const units: SpeechUnit[] = [];
  let currentTime = 0;

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

    units.push({
      id: chunk.id,
      text: chunk.text.trim(),
      startSec,
      endSec,
      durationSec,
      pauseAfterSec: pauseSec,
    });
  }

  return units;
}

/**
 * Generates optimized SubtitleCues from TTS ChunkItems.
 * Short adjacent chunks are intelligently merged into unified subtitle cues
 * according to the active aspect ratio profile, while respecting real audio timestamps.
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

  const speechUnits = buildSpeechUnitsFromChunks(chunks, options?.punctuationPauses);
  const cues = optimizeSubtitles(speechUnits, profile);

  // Validate the resulting cues against full original text
  const originalText = chunks.map((c) => c.text).join(" ");
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

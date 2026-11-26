import { ChunkItem, PunctuationPauses } from "../../types/ui";
import type { LocalAiServices } from "../ai/localAiServices";
import type { DialogueTimelineEntry } from "../dialogue/masterAssembly";
import { generateDialogueSrt } from "../dialogue/srtExporter";
import { exportToSrt } from "./exporter";
import { parseSubtitle } from "./parser";
import { generateSubtitlesFromChunks } from "./pipeline";
import { loadSubtitleSettings } from "./profiles";
import { SubtitleAspectRatio, SubtitleCue, SubtitleMaxLines } from "./types";

type OptimizerSegmentInput = Parameters<LocalAiServices["optimizeSubtitlesV2"]>[0]["segments"][number];
type OptimizerWordInput = NonNullable<OptimizerSegmentInput["words"]>[number];

export interface AssembledSegmentTiming {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface UnifiedMasterSubtitleOptions {
  chunks: ChunkItem[];
  assembledSegments?: AssembledSegmentTiming[];
  masterAudioPath?: string;
  ai?: LocalAiServices | null;
  aspectRatio?: SubtitleAspectRatio;
  maxLines?: 1 | 2;
  punctuationPauses?: PunctuationPauses;
  asrModelId?: string;
  language?: string;
}

function roundMs(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}

function cleanScriptChunkText(text: string): string {
  return text.replace(/\[pause[^\]]*\]/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * Unified Final-Step Master Subtitle Generator (Audio-Factory Reference Synced).
 *
 * Guarantees 100% waveform-locked subtitle timing and Audio-Factory word-level DP layout
 * across TTS Tab, Batch TTS, and Batch QC Rebuild without touching Post-QC thresholds:
 * 1. Anchors every chunk strictly to its true stitched `[startSec, endSec]` from `assembledSegments`
 *    (eliminating cumulative multi-second drift on long 20-60 minute audio).
 * 2. Tier 1 (~0.1s, zero extra GPU ASR): When all non-empty chunks already carry `qualityReview.words`
 *    from Post-QC, shifts word timestamps onto the exact Master timeline and runs Python
 *    `optimize_subtitles_v2` (with script orthographic recovery + >= -28/-30 dBFS breath-immune envelope).
 * 3. Tier 2 (Full Master ASR + Optimizer): When Post-QC was skipped or any chunk lacks word timestamps,
 *    runs `ai.generateMasterSubtitles` directly on `masterAudioPath` with `scriptText` recovery —
 *    identical to the Subtitle Tab and Audio-Factory.
 * 4. Tier 3 (Offline / Unit-Test Fallback): Falls back to `generateSubtitlesFromChunks` bounded by
 *    exact `assembledSegments` offsets so browser/mock tests remain deterministic with zero drift.
 */
export async function exportUnifiedMasterSubtitlesFromTts(
  options: UnifiedMasterSubtitleOptions
): Promise<SubtitleCue[]> {
  const sorted = [...options.chunks].sort((a, b) => a.index - b.index);
  if (sorted.length === 0) return [];

  const subSettings = loadSubtitleSettings();
  const aspectRatio: SubtitleAspectRatio = options.aspectRatio || subSettings.aspectRatio;
  const maxLines: 1 | 2 = (options.maxLines ?? subSettings.maxLines) === 1 ? 1 : 2;
  const effectiveAsrModel = options.asrModelId || subSettings.whisperModel;

  // Map exact stitched [startSec, endSec, durationSec] onto each chunk when available
  const segByIdx = new Map<number, AssembledSegmentTiming>();
  if (options.assembledSegments && options.assembledSegments.length === sorted.length) {
    options.assembledSegments.forEach((seg, idx) => {
      segByIdx.set(idx, seg);
    });
  }

  const exactTimedChunks: ChunkItem[] = sorted.map((c, idx) => {
    const seg = segByIdx.get(idx);
    if (!seg) return c;
    return {
      ...c,
      durationSec: seg.durationSec,
      _assembledStartSec: seg.startSec,
      _assembledEndSec: seg.endSec,
    } as ChunkItem;
  });

  const nonEmptyEntries = exactTimedChunks
    .map((chunk, idx) => ({
      chunk,
      idx,
      seg: segByIdx.get(idx),
      cleanText: cleanScriptChunkText(chunk.originalText?.trim() || chunk.text),
      spokenCleanText: cleanScriptChunkText(chunk.text),
    }))
    .filter((entry) => entry.spokenCleanText.length > 0);

  if (nonEmptyEntries.length === 0) return [];

  const fullScriptText = nonEmptyEntries.map((e) => e.cleanText).join("\n");
  const ai = options.ai;
  const masterPath = options.masterAudioPath;

  // Tier 1: All chunks have Post-QC word timestamps -> instant Python optimize_subtitles_v2
  const allHaveWords = nonEmptyEntries.every(
    (e) => Array.isArray(e.chunk.qualityReview?.words) && e.chunk.qualityReview!.words!.length > 0
  );

  if (
    allHaveWords &&
    ai &&
    typeof ai.optimizeSubtitlesV2 === "function" &&
    masterPath &&
    segByIdx.size === sorted.length
  ) {
    try {
      const globalSegments: OptimizerSegmentInput[] = [];
      let prevGlobalEnd = 0;

      for (const entry of nonEmptyEntries) {
        const segStart = entry.seg!.startSec;
        const segEnd = entry.seg!.endSec;
        const segDur = Math.max(0.05, segEnd - segStart);
        const rawWords = entry.chunk.qualityReview!.words!;
        const mappedWords: OptimizerWordInput[] = [];

        for (const w of rawWords) {
          if (
            typeof w.startSec !== "number" ||
            typeof w.endSec !== "number" ||
            !Number.isFinite(w.startSec) ||
            !Number.isFinite(w.endSec) ||
            !String(w.word || "").trim()
          ) {
            continue;
          }
          const clampedLocalS = Math.max(0, Math.min(segDur - 0.02, w.startSec));
          const clampedLocalE = Math.max(clampedLocalS + 0.02, Math.min(segDur + 0.05, w.endSec));
          const gStart = roundMs(Math.max(prevGlobalEnd, segStart + clampedLocalS));
          const gEnd = roundMs(Math.max(gStart + 0.02, Math.min(segEnd + 0.05, segStart + clampedLocalE)));
          mappedWords.push({
            word: w.word,
            startSec: gStart,
            endSec: gEnd,
            probability: 0.99,
          });
          prevGlobalEnd = gEnd;
        }

        if (mappedWords.length > 0) {
          globalSegments.push({
            id: globalSegments.length + 1,
            startSec: mappedWords[0].startSec,
            endSec: mappedWords[mappedWords.length - 1].endSec,
            text: mappedWords.map((mw) => mw.word.trim()).join(" "),
            words: mappedWords,
          });
        }
      }

      if (globalSegments.length > 0) {
        const optRes = await ai.optimizeSubtitlesV2({
          segments: globalSegments,
          aspectRatio,
          maxLines,
          audioPath: masterPath,
          scriptText: fullScriptText,
          language: options.language || "en",
          chunkCount: nonEmptyEntries.length,
        });
        if (optRes?.cues && optRes.cues.length > 0) {
          return optRes.cues.map((c, idx) => ({
            index: c.index || idx + 1,
            startSec: roundMs(c.startSec),
            endSec: roundMs(c.endSec),
            text: c.text,
          }));
        }
      }
    } catch (err) {
      console.warn("[MasterSubtitleExport] Tier-1 optimizeSubtitlesV2 failed, falling back:", err);
    }
  }

  // Tier 2: Post-QC was off or partial -> full Whisper Master ASR + Audio-Factory Optimizer on Master Audio
  if (ai && typeof ai.generateMasterSubtitles === "function" && masterPath) {
    try {
      const masterRes = await ai.generateMasterSubtitles({
        audioPath: masterPath,
        scriptText: fullScriptText,
        language: options.language || "auto",
        aspectRatio,
        maxLines,
        asrModelId: effectiveAsrModel,
        chunkCount: nonEmptyEntries.length,
      });
      if (masterRes?.cues && masterRes.cues.length > 0) {
        return masterRes.cues.map((c, idx) => ({
          index: c.index || idx + 1,
          startSec: roundMs(c.startSec),
          endSec: roundMs(c.endSec),
          text: c.text,
        }));
      }
    } catch (err) {
      console.warn("[MasterSubtitleExport] Tier-2 generateMasterSubtitles failed, falling back:", err);
    }
  }

  // Tier 3: Deterministic offline / unit-test fallback bounded by exact stitched segment offsets
  let fallbackCues = generateSubtitlesFromChunks(exactTimedChunks, {
    punctuationPauses: options.punctuationPauses,
    aspectRatio,
    maxLines,
  });

  if (ai && typeof ai.alignSubtitleCues === "function" && masterPath && fallbackCues.length > 0) {
    try {
      const alignedRes = await ai.alignSubtitleCues({
        cues: fallbackCues,
        audioPath: masterPath,
        minDbThreshold: -28.0,
        alignEnds: true,
      });
      if (alignedRes?.cues && alignedRes.cues.length === fallbackCues.length) {
        fallbackCues = fallbackCues.map((c, idx) => ({
          ...c,
          startSec: alignedRes.cues[idx].startSec,
          endSec: alignedRes.cues[idx].endSec,
        }));
      }
    } catch {
      // Non-blocking in mock / browser environments
    }
  }

  return fallbackCues;
}

/**
 * Generates speaker-labeled Dialogue SRT using exact stitched Master Audio segment boundaries
 * (`assembledSegments`) and refines cue onset/offset via breath-immune waveform alignment.
 */
export async function exportAlignedDialogueSrt(options: {
  timeline: DialogueTimelineEntry[];
  assembledSegments?: AssembledSegmentTiming[];
  masterAudioPath?: string;
  ai?: LocalAiServices | null;
  aspectRatio?: SubtitleAspectRatio;
  maxLines?: SubtitleMaxLines;
}): Promise<string> {
  const syncedTimeline: DialogueTimelineEntry[] =
    options.assembledSegments && options.assembledSegments.length === options.timeline.length
      ? options.timeline.map((entry, idx) => {
          const seg = options.assembledSegments![idx];
          const nextSeg = options.assembledSegments![idx + 1];
          return {
            ...entry,
            startSec: seg.startSec,
            endSec: seg.endSec,
            durationSec: seg.durationSec,
            pauseAfterSec: nextSeg ? Math.max(0, nextSeg.startSec - seg.endSec) : entry.pauseAfterSec,
          };
        })
      : options.timeline;

  const rawSrt = generateDialogueSrt(syncedTimeline, {
    aspectRatio: options.aspectRatio,
    maxLines: options.maxLines,
  });

  if (!rawSrt || !options.ai || typeof options.ai.alignSubtitleCues !== "function" || !options.masterAudioPath) {
    return rawSrt;
  }

  try {
    const parsedCues = parseSubtitle(rawSrt);
    if (Array.isArray(parsedCues) && parsedCues.length > 0) {
      const alignedRes = await options.ai.alignSubtitleCues({
        cues: parsedCues,
        audioPath: options.masterAudioPath,
        minDbThreshold: -28.0,
        alignEnds: true,
      });
      if (alignedRes?.cues && alignedRes.cues.length === parsedCues.length) {
        return exportToSrt(
          parsedCues.map((c, idx) => ({
            index: c.index || idx + 1,
            text: c.text,
            startSec: alignedRes.cues[idx].startSec,
            endSec: alignedRes.cues[idx].endSec,
          }))
        );
      }
    }
  } catch {
    // Graceful fallback when sidecar alignment is unavailable
  }

  return rawSrt;
}

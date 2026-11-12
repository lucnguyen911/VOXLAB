import { EffectiveVoiceSnapshot, PunctuationPauses } from "../../types/ui";
import { getSharedAiServices, readAudioFileBlobUrl } from "../batch/batchRuntime";
import {
  getEffectiveRules,
  prepareSpokenText,
  PronunciationMappingEntry,
  PronunciationRule,
} from "../pronunciation";
import { edgeTtsProvider } from "./edgeProvider";
import { googleTranslateTtsProvider } from "./googleProvider";

export interface SynthesisCoreOptions {
  scope?: string;
  id?: string;
  projectId?: string;
  pronunciationRules?: PronunciationRule[];
  punctuationPauses?: PunctuationPauses;
  asrModelId?: string;
  advancedSettings?: Record<string, unknown>;
  onProgress?: (pct: number, stage: string) => void;
}

export interface SynthesisCoreResult {
  durationSec: number;
  outputPath: string;
  blobUrl: string;
  sourceText: string;
  spokenText: string;
  pronunciationMapping: PronunciationMappingEntry[];
  leadingSilenceMs?: number;
  trailingSilenceMs?: number;
}

/**
 * Single source of truth for synthesizing a single speech chunk/turn across all providers:
 * - Microsoft Edge TTS (online high-quality neural)
 * - Google Translate TTS
 * - Local AI (OmniVoice, Chatterbox Turbo, Qwen TTS)
 * - Local Cloned Voices (Zero-shot voice cloning)
 *
 * Strictly preserves `sourceText` while sending normalized `spokenText` and `pronunciationRules`
 * to the underlying synthesis engine.
 */
export async function synthesizeSpeechCore(
  text: string,
  snapshot: EffectiveVoiceSnapshot,
  options: SynthesisCoreOptions = {}
): Promise<SynthesisCoreResult> {
  const ai = await getSharedAiServices();
  const isOnline = snapshot.provider === "edge" || snapshot.provider === "google_translate";
  const fileExt = isOnline ? "mp3" : "wav";
  const scope = options.scope || "tts";
  const id = (options.id || `chunk_${Date.now()}`).replace(/[^\w-]/g, "_");
  const projectId = options.projectId || (scope === "dialogue" ? "dialogue" : "current");
  const effectiveRules = options.pronunciationRules ?? getEffectiveRules(projectId);
  const prepared = prepareSpokenText(text, {
    rules: effectiveRules,
    engine: snapshot.modelId || snapshot.provider,
  });

  const outputPath = ai
    ? await ai.scratchPath(scope, `${id}_${Date.now()}.${fileExt}`)
    : `scratch/${id}_${Date.now()}.${fileExt}`;

  let durationSec = 0;
  let finalOutputPath = outputPath;
  let spokenText = prepared.spokenText;
  let pronunciationMapping = prepared.pronunciationMapping;
  let leadingSilenceMs: number | undefined;
  let trailingSilenceMs: number | undefined;
  let majorPunctuationSplit = false;

  if (snapshot.provider === "edge") {
    const res = await edgeTtsProvider.synthesize({
      voiceId: snapshot.providerVoiceId || snapshot.voiceId,
      text: prepared.spokenText,
      outputPath,
      speed: snapshot.speed,
      pitch: snapshot.pitch,
      volume: snapshot.volume,
      onProgress: options.onProgress,
    });
    durationSec = res.durationSec;
    finalOutputPath = res.outputPath;
  } else if (snapshot.provider === "google_translate") {
    const res = await googleTranslateTtsProvider.synthesize({
      voiceId: snapshot.providerVoiceId || snapshot.voiceId,
      text: prepared.spokenText,
      outputPath,
      speed: snapshot.speed,
      onProgress: options.onProgress,
    });
    durationSec = res.durationSec;
    finalOutputPath = res.outputPath;
  } else if (snapshot.provider === "local" || snapshot.provider === "clone") {
    if (!ai) {
      throw new Error("Local AI runtime chưa khởi tạo.");
    }
    const res = await ai.synthesize({
      model: snapshot.modelId || snapshot.engine || "omnivoice",
      voiceId: snapshot.voiceId,
      text,
      outputPath,
      speed: snapshot.speed,
      advancedSettings: options.advancedSettings,
      pronunciationRules: effectiveRules,
      punctuationPauses: options.punctuationPauses,
      projectId,
      onProgress: options.onProgress,
    });
    durationSec = res.durationSec;
    finalOutputPath = res.outputPath;
    if (res.spokenText) spokenText = res.spokenText;
    if (res.pronunciationMapping) pronunciationMapping = res.pronunciationMapping;
    leadingSilenceMs = res.leadingSilenceMs;
    trailingSilenceMs = res.trailingSilenceMs;
    majorPunctuationSplit = Boolean(res.majorPunctuationSplit);
  } else {
    throw new Error(`Provider "${snapshot.provider}" chưa được hỗ trợ để tạo audio.`);
  }

  if (ai && options.punctuationPauses) {
    const trimmed = text.trim();
    const innerText = trimmed.length > 2 ? trimmed.slice(0, -1) : "";
    const needsTier2Shaping = majorPunctuationSplit
      ? /[,，、:;：；]/.test(innerText)
      : /[,.;:!?…，、。；：！？]/.test(innerText);
    if (needsTier2Shaping) {
      try {
        const shaped = await ai.enforcePunctuationPauses({
          audioPath: finalOutputPath,
          text,
          punctuationPauses: options.punctuationPauses,
          language: snapshot.language,
          speed: snapshot.speed,
          majorAlreadySplit: majorPunctuationSplit,
          asrModelId: options.asrModelId,
        });
        if (shaped && typeof shaped.durationSec === "number" && shaped.durationSec > 0) {
          durationSec = shaped.durationSec;
          if (typeof shaped.leadingSilenceMs === "number") leadingSilenceMs = shaped.leadingSilenceMs;
          if (typeof shaped.trailingSilenceMs === "number") trailingSilenceMs = shaped.trailingSilenceMs;
        }
      } catch (shapeErr) {
        console.warn("[synthesizeSpeechCore] Punctuation pause shaping skipped:", shapeErr);
      }
    }
  }

  const blobUrl = await readAudioFileBlobUrl(finalOutputPath);
  return {
    durationSec,
    outputPath: finalOutputPath,
    blobUrl,
    sourceText: text,
    spokenText,
    pronunciationMapping,
    ...(leadingSilenceMs !== undefined ? { leadingSilenceMs } : {}),
    ...(trailingSilenceMs !== undefined ? { trailingSilenceMs } : {}),
  };
}


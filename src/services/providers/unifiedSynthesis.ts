import { EffectiveVoiceSnapshot } from "../../types/ui";
import { getSharedAiServices, readAudioFileBlobUrl } from "../batch/batchRuntime";
import { edgeTtsProvider } from "./edgeProvider";
import { googleTranslateTtsProvider } from "./googleProvider";

export interface SynthesisCoreOptions {
  scope?: string;
  id?: string;
  advancedSettings?: Record<string, unknown>;
  onProgress?: (pct: number, stage: string) => void;
}

export interface SynthesisCoreResult {
  durationSec: number;
  outputPath: string;
  blobUrl: string;
}

/**
 * Single source of truth for synthesizing a single speech chunk/turn across all providers:
 * - Microsoft Edge TTS (online high-quality neural)
 * - Google Translate TTS
 * - Local AI (OmniVoice, Chatterbox Turbo, Qwen TTS)
 * - Local Cloned Voices (Zero-shot voice cloning)
 *
 * Saves real audio to disk atomically and returns real duration, file path, and Blob URL for webview playback.
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

  const outputPath = ai
    ? await ai.scratchPath(scope, `${id}_${Date.now()}.${fileExt}`)
    : `scratch/${id}_${Date.now()}.${fileExt}`;

  let durationSec = 0;
  let finalOutputPath = outputPath;

  if (snapshot.provider === "edge") {
    const res = await edgeTtsProvider.synthesize({
      voiceId: snapshot.providerVoiceId || snapshot.voiceId,
      text,
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
      text,
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
      model: snapshot.modelId || "omnivoice",
      voiceId: snapshot.voiceId,
      text,
      outputPath,
      speed: snapshot.speed,
      advancedSettings: options.advancedSettings,
      onProgress: options.onProgress,
    });
    durationSec = res.durationSec;
    finalOutputPath = res.outputPath;
  } else {
    throw new Error(`Provider "${snapshot.provider}" chưa được hỗ trợ để tạo audio.`);
  }

  const blobUrl = await readAudioFileBlobUrl(finalOutputPath);
  return {
    durationSec,
    outputPath: finalOutputPath,
    blobUrl,
  };
}

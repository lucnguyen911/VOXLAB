import { VoiceProfile, EffectiveVoiceSnapshot } from "../../types/ui";
import { resolveEdgeVoiceName } from "./edgeProvider";
import { resolveCloneVoiceReference } from "../ai/cloneVoiceRegistry";

export interface SnapshotCreationOptions {
  activeModel?: string;
  speed?: number;
  pitch?: number;
  volume?: number;
}

/**
 * Creates an immutable snapshot of the selected voice for TTS synthesis.
 * In normal TTS, "Giọng đọc chính" is the SINGLE SOURCE OF TRUTH.
 *
 * Rules:
 * - NO SILENT FALLBACK: If selectedVoiceId is invalid or not in voices, throws clearly.
 * - Resolves the real provider voice ID (e.g. vi-VN-HoaiMyNeural for Edge).
 * - Resolves reference audio/text for cloned voices.
 * - Returns a frozen object that cannot be modified mid-batch.
 */
export function createEffectiveVoiceSnapshot(
  selectedVoiceId: string,
  voices: VoiceProfile[],
  options: SnapshotCreationOptions = {}
): EffectiveVoiceSnapshot {
  if (!selectedVoiceId || !selectedVoiceId.trim()) {
    throw new Error("Chưa chọn giọng đọc chính. Vui lòng chọn một giọng trong danh sách.");
  }

  const voice = voices.find((v) => v.id === selectedVoiceId);
  if (!voice) {
    throw new Error(`Giọng đọc đã chọn "${selectedVoiceId}" không tồn tại trong hệ thống.`);
  }

  const provider = voice.provider || (
    voice.source === "edge"
      ? "edge"
      : voice.source === "google"
      ? "google_translate"
      : "local"
  );

  let providerVoiceId = voice.id;
  if (provider === "edge") {
    const resolvedName = resolveEdgeVoiceName(voice.id);
    if (resolvedName) {
      providerVoiceId = resolvedName;
    } else if (voice.id.includes("Neural")) {
      providerVoiceId = voice.id;
    } else if (voice.supportedLanguages.includes("vi")) {
      providerVoiceId = "vi-VN-HoaiMyNeural";
    } else {
      providerVoiceId = "en-US-JennyNeural";
    }
  }

  let refAudioPath = voice.sampleAudioPath;
  let refText: string | undefined;

  if (voice.origin === "clone" || provider === "clone") {
    const cloneRef = resolveCloneVoiceReference(voice.id);
    if (cloneRef) {
      refAudioPath = cloneRef.refAudioPath;
      refText = cloneRef.refText;
    }
  }

  const engine = voice.engine || (
    provider === "edge"
      ? "edge_tts"
      : provider === "google_translate"
      ? "gtts"
      : options.activeModel || "omnivoice"
  );

  const snapshot: EffectiveVoiceSnapshot = {
    voiceId: voice.id,
    provider,
    engine,
    modelId: provider === "local" ? options.activeModel : undefined,
    language: voice.supportedLanguages?.[0],
    voiceName: voice.name,
    speed: options.speed ?? 1.0,
    pitch: options.pitch ?? 1.0,
    volume: options.volume ?? 1.0,
    providerVoiceId,
    refAudioPath,
    refText,
  };

  return Object.freeze(snapshot);
}

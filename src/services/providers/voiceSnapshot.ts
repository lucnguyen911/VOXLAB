import { VoiceProfile, EffectiveVoiceSnapshot } from "../../types/ui";
import { resolveEdgeVoiceName } from "./edgeProvider";
import { resolveCloneVoiceReference } from "../ai/cloneVoiceRegistry";
import { resolveLocalEngine } from "../ai/ttsEngines";

export interface SnapshotCreationOptions {
  activeModel?: string;
  speed?: number;
  pitch?: number;
  volume?: number;
}

export function isCloneVoiceProfile(voice?: VoiceProfile | null): boolean {
  if (!voice) return false;
  return (
    voice.origin === "clone" ||
    voice.provider === "clone" ||
    voice.source === "local_clone" ||
    voice.id.startsWith("clone_")
  );
}

/**
 * Resolves the effective local/clone model for a voice profile and UI model selector:
 * - For cloned voices: the user-selected clone model (`selectedModel`) takes priority over `voice.engine`.
 * - For system preset voices (e.g. `kokoro_af_heart` with `engine: "kokoro_82m"`): the voice's bound engine takes priority.
 */
export function resolveEffectiveActiveModel(
  voice: VoiceProfile | undefined,
  selectedModel?: string
): string | undefined {
  if (!voice) return selectedModel;
  if (isCloneVoiceProfile(voice)) {
    return selectedModel || voice.engine;
  }
  return voice.engine || selectedModel;
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
  const isClone = isCloneVoiceProfile(voice);
  const cloneRef = isClone ? resolveCloneVoiceReference(voice.id) : null;

  if (isClone) {
    if (cloneRef) {
      refAudioPath = cloneRef.refAudioPath;
      refText = cloneRef.refText;
    }
    if (!refAudioPath || !refAudioPath.trim()) {
      throw new Error(
        `Mẫu âm thanh gốc của giọng nhân bản "${voice.name}" không còn tồn tại. Vui lòng chọn giọng đọc khác hoặc tạo lại giọng nhân bản.`
      );
    }
  }

  const resolvedActiveCaps =
    provider === "local" || provider === "clone"
      ? resolveLocalEngine(options.activeModel)
      : null;

  const engine =
    provider === "edge"
      ? "edge_tts"
      : provider === "google_translate"
      ? "gtts"
      : resolvedActiveCaps?.voxlabModelId || voice.engine || options.activeModel || "omnivoice";

  // Cloned voices represent speaker timbre rather than a locked script language:
  // leave snapshot.language undefined so LocalAiServices determines target language from each chunk's text.
  const effectiveLanguage = isClone ? undefined : voice.supportedLanguages?.[0];

  const snapshot: EffectiveVoiceSnapshot = {
    voiceId: voice.id,
    provider,
    engine,
    modelId:
      provider === "local" || provider === "clone"
        ? options.activeModel || voice.engine
        : undefined,
    language: effectiveLanguage,
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

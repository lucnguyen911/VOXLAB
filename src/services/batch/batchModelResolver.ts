/**
 * Pure, cycle-free model & voice target resolver for Batch executors and UI modals.
 *
 * IMPORTANT: Do NOT import `mock/data` or `services/providers/index` here, because
 * `edgeProvider` -> `batchRuntime` -> `batchOrchestrator` -> executors -> `batchModelResolver`
 * must remain acyclic during ESM initialization.
 */

import { VoiceProfile } from "../../types/ui";
import { normalizeWhisperModelId } from "../ai/aiRuntimeSettings";
import { listCloneVoices } from "../ai/cloneVoiceRegistry";
import { resolveLocalEngine } from "../ai/ttsEngines";

export interface ResolvedBatchVoiceTarget {
  voiceId: string;
  /** Canonical local model id (e.g. "kokoro_82m", "omnivoice", "chatterbox_turbo", "qwen_tts_1_7b") or raw fallback when invalid */
  model: string;
  isGoogleVoice: boolean;
  isEdgeVoice: boolean;
  isOnlineVoice: boolean;
  /** Edge TTS writes MPEG `.mp3`; Google TTS and all local sidecar engines write RIFF PCM `.wav`. */
  audioExt: "mp3" | "wav";
}

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== "undefined" && (globalThis as { localStorage?: Storage }).localStorage) {
      return (globalThis as { localStorage?: Storage }).localStorage ?? null;
    }
  } catch {
    // ignore storage access errors
  }
  return null;
}

function findStoredVoiceProfile(voiceId: string): Partial<VoiceProfile> | undefined {
  if (!voiceId || voiceId === "omnivoice-auto") return undefined;
  const storage = getSafeLocalStorage();
  if (!storage) return undefined;
  try {
    const raw = storage.getItem("voxlab_voices_v1");
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.find((v) => v && typeof v === "object" && v.id === voiceId);
  } catch {
    return undefined;
  }
}

function isCloneLikeVoice(voice?: Partial<VoiceProfile> | null): boolean {
  if (!voice) return false;
  return (
    voice.origin === "clone" ||
    voice.provider === "clone" ||
    voice.source === "local_clone" ||
    Boolean(voice.id && voice.id.startsWith("clone_"))
  );
}

function isKokoroVoiceId(vId: string): boolean {
  return vId.startsWith("kokoro_") || /^[ab][fm]_[a-z0-9_]+$/i.test(vId);
}

export function resolveBatchWhisperModelId(raw?: string | null): string {
  return normalizeWhisperModelId(raw);
}

export function resolveBatchModelForVoiceProfile(
  voice: Partial<VoiceProfile> | undefined | null,
  fallbackModel?: string
): string {
  const fallbackCaps = resolveLocalEngine(fallbackModel);
  const normalizedFallback = fallbackCaps?.voxlabModelId || fallbackModel || "omnivoice";

  if (!voice || !voice.id) return normalizedFallback;

  const isGoogle =
    voice.provider === "google_translate" ||
    voice.source === "google" ||
    voice.id.startsWith("google_");
  const isEdge =
    !isGoogle &&
    (voice.provider === "edge" ||
      voice.source === "edge" ||
      voice.id.startsWith("edge_") ||
      voice.id.includes("Neural"));

  if (isGoogle || isEdge) {
    return normalizedFallback;
  }

  if (
    isKokoroVoiceId(voice.id) ||
    resolveLocalEngine(voice.engine)?.voxlabModelId === "kokoro_82m"
  ) {
    return "kokoro_82m";
  }

  if (isCloneLikeVoice(voice)) {
    const cloneBound =
      listCloneVoices().find((v) => v.id === voice.id)?.engine || voice.engine;
    const cloneCaps = resolveLocalEngine(cloneBound);
    if (cloneCaps) return cloneCaps.voxlabModelId;
    return normalizedFallback;
  }

  const presetCaps = resolveLocalEngine(voice.engine);
  if (presetCaps) return presetCaps.voxlabModelId;

  return normalizedFallback;
}

/**
 * Resolves the exact provider / local engine target for a Batch voice ID + task snapshot model.
 *
 * Invariants:
 * 1. Explicit non-local model names (e.g. `model: "edge-tts"` with `voiceId: "omnivoice-auto"`)
 *    are preserved verbatim so `ai.resolveEngine` rejects them (no silent local substitution).
 * 2. Cloned voices (`clone_*`) and local preset voices (`kokoro_*`, etc.) resolve to their bound
 *    engine (`chatterbox_turbo`, `qwen_tts_1_7b`, `kokoro_82m`, `omnivoice`) even when the task
 *    snapshot `model` still carries the schema default `"omnivoice"`.
 * 3. Online voices (`google_*`, `edge_*`, `*Neural`) bypass local `ai.resolveEngine` and dispatch
 *    to their exact online provider (`googleTranslateTtsProvider` -> `.wav`, `edgeTtsProvider` -> `.mp3`).
 */
export function resolveBatchVoiceTarget(
  voiceId: string | undefined | null,
  fallbackModel?: string
): ResolvedBatchVoiceTarget {
  const vId = String(voiceId || "").trim();
  const cloneEntry = vId ? listCloneVoices().find((v) => v.id === vId) : undefined;
  const storedVoice = findStoredVoiceProfile(vId);

  const isGoogleVoice =
    vId.startsWith("google_") ||
    storedVoice?.provider === "google_translate" ||
    storedVoice?.source === "google";
  const isEdgeVoice =
    !isGoogleVoice &&
    (vId.startsWith("edge_") ||
      vId.includes("Neural") ||
      storedVoice?.provider === "edge" ||
      storedVoice?.source === "edge");
  const isOnlineVoice = isGoogleVoice || isEdgeVoice;
  const audioExt: "mp3" | "wav" = isEdgeVoice ? "mp3" : "wav";

  const rawFallback = String(fallbackModel || "").trim();
  const fallbackCaps = resolveLocalEngine(rawFallback);

  // Preserve explicit invalid/non-local model strings when no specific local/clone voice overrides them
  if (rawFallback && !fallbackCaps && !isOnlineVoice && !isKokoroVoiceId(vId) && !cloneEntry) {
    return {
      voiceId: vId,
      model: rawFallback,
      isGoogleVoice,
      isEdgeVoice,
      isOnlineVoice,
      audioExt,
    };
  }

  let model: string;
  if (
    isKokoroVoiceId(vId) ||
    resolveLocalEngine(storedVoice?.engine)?.voxlabModelId === "kokoro_82m"
  ) {
    model = "kokoro_82m";
  } else if (cloneEntry?.engine || (isCloneLikeVoice(storedVoice) && storedVoice?.engine)) {
    const boundEngine = cloneEntry?.engine || storedVoice?.engine || "";
    const boundCaps = resolveLocalEngine(boundEngine);
    if (fallbackCaps && fallbackCaps.voxlabModelId !== "omnivoice") {
      model = fallbackCaps.voxlabModelId;
    } else {
      model =
        boundCaps?.voxlabModelId ||
        boundEngine ||
        fallbackCaps?.voxlabModelId ||
        rawFallback ||
        "omnivoice";
    }
  } else if (!isOnlineVoice && storedVoice?.engine) {
    const presetCaps = resolveLocalEngine(storedVoice.engine);
    if (fallbackCaps && fallbackCaps.voxlabModelId !== "omnivoice") {
      model = fallbackCaps.voxlabModelId;
    } else {
      model =
        presetCaps?.voxlabModelId ||
        storedVoice.engine ||
        fallbackCaps?.voxlabModelId ||
        rawFallback ||
        "omnivoice";
    }
  } else {
    model = fallbackCaps?.voxlabModelId || rawFallback || "";
  }

  return {
    voiceId: vId,
    model,
    isGoogleVoice,
    isEdgeVoice,
    isOnlineVoice,
    audioExt,
  };
}

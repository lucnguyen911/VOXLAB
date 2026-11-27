import { ChunkItem } from "../../types/ui";
import { DialogueCharacter, DialogueSegment } from "../../types/dialogue";

export const TTS_SESSION_STORAGE_KEY = "voxlab_tts_session_v1";
export const DIALOGUE_SESSION_STORAGE_KEY = "voxlab_dialogue_session_v1";

export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface ScratchAudioFsDeps {
  fileExists: (path: string) => Promise<boolean>;
  readBlobUrl: (path: string) => Promise<string>;
}

interface TtsSessionPayloadV1 {
  version: 1;
  stage: "prep" | "studio";
  workingText: string;
  chunks: ChunkItem[];
  updatedAt: number;
}

interface DialogueSessionPayloadV1 {
  version: 1;
  stage: "prep" | "studio";
  rawScript: string;
  characters: DialogueCharacter[];
  segments: Array<Omit<DialogueSegment, "audioBuffer" | "audioBlobUrl">>;
  updatedAt: number;
}

function getDefaultStorage(): KeyValueStorage | null {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    // ignore storage access errors
  }
  return null;
}

function normalizeScriptKey(text: string): string {
  return (text || "").replace(/\r\n/g, "\n").trim();
}

/**
 * Reconciles newly parsed script chunks with existing studio chunks so toggling
 * Prep <-> Studio or editing a single sentence preserves all unchanged ready audio & QC reviews.
 */
export function reconcileChunksPreservingGeneratedAudio(
  prevChunks: ChunkItem[],
  parsedChunks: ChunkItem[]
): ChunkItem[] {
  if (!prevChunks || prevChunks.length === 0) {
    return parsedChunks;
  }

  const usedPrevIndices = new Set<number>();

  return parsedChunks.map((parsed) => {
    const targetText = parsed.text.trim();
    let matchedIdx = -1;

    for (let i = 0; i < prevChunks.length; i++) {
      if (usedPrevIndices.has(i)) continue;
      if (prevChunks[i].text.trim() === targetText) {
        matchedIdx = i;
        break;
      }
    }

    if (matchedIdx === -1) {
      return parsed;
    }

    usedPrevIndices.add(matchedIdx);
    const prev = prevChunks[matchedIdx];
    const hasReusableAudio =
      prev.status === "ready" && Boolean(prev.audioFilePath || prev.audioUrl);
    const hasReusableMeta = Boolean(prev.voiceOverrideId || prev.acknowledgedAt);

    if (!hasReusableAudio && !hasReusableMeta && prev.status === "pending") {
      return {
        ...parsed,
        id: prev.id,
      };
    }

    return {
      ...prev,
      index: parsed.index,
      text: parsed.text,
      pauseAfterMs: parsed.pauseAfterMs,
    };
  });
}

function sanitizeChunkForStorage(chunk: ChunkItem): ChunkItem {
  const normalizedStatus = chunk.status === "generating" ? "pending" : chunk.status;
  const sanitizedReview =
    chunk.qualityReview?.status === "checking" ? undefined : chunk.qualityReview;

  const { audioUrl: _ephemeralUrl, ...rest } = chunk;
  return {
    ...rest,
    status: normalizedStatus,
    qualityReview: sanitizedReview,
  };
}

export function saveTtsSessionBackup(
  session: {
    stage: "prep" | "studio";
    workingText: string;
    chunks: ChunkItem[];
  },
  storage: KeyValueStorage | null = getDefaultStorage()
): void {
  if (!storage) return;

  try {
    if (session.chunks.length === 0 && session.stage === "prep") {
      storage.removeItem(TTS_SESSION_STORAGE_KEY);
      return;
    }

    const payload: TtsSessionPayloadV1 = {
      version: 1,
      stage: session.stage,
      workingText: session.workingText,
      chunks: session.chunks.map(sanitizeChunkForStorage),
      updatedAt: Date.now(),
    };
    storage.setItem(TTS_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("[workspaceSessionStorage] Failed to save TTS session:", err);
  }
}

export function loadTtsSessionBackup(
  currentWorkingText: string,
  storage: KeyValueStorage | null = getDefaultStorage()
): { stage: "prep" | "studio"; chunks: ChunkItem[] } | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(TTS_SESSION_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<TtsSessionPayloadV1>;
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.chunks) ||
      parsed.chunks.length === 0 ||
      typeof parsed.workingText !== "string"
    ) {
      return null;
    }

    if (normalizeScriptKey(parsed.workingText) !== normalizeScriptKey(currentWorkingText)) {
      return null;
    }

    const stage = parsed.stage === "studio" ? "studio" : "prep";
    const chunks: ChunkItem[] = parsed.chunks.map((c) => ({
      ...c,
      audioUrl: undefined,
      status: c.status === "generating" ? "pending" : c.status,
      qualityReview: c.qualityReview?.status === "checking" ? undefined : c.qualityReview,
    }));

    return { stage, chunks };
  } catch (err) {
    console.warn("[workspaceSessionStorage] Failed to load TTS session:", err);
    return null;
  }
}

/**
 * Verifies on-disk scratch audio files for TTS chunks, re-creating fresh Blob URLs when needed
 * and resetting chunks back to `pending` if their scratch file was cleaned from disk.
 */
export async function hydrateTtsSessionChunksFromDisk(
  chunks: ChunkItem[],
  deps: ScratchAudioFsDeps
): Promise<ChunkItem[]> {
  return Promise.all(
    chunks.map(async (chunk) => {
      if (chunk.status !== "ready") {
        return chunk;
      }
      if (!chunk.audioFilePath) {
        return chunk.audioUrl
          ? chunk
          : {
              ...chunk,
              status: "pending",
              durationSec: undefined,
              qualityReview: undefined,
            };
      }

      let exists = false;
      try {
        exists = await deps.fileExists(chunk.audioFilePath);
      } catch {
        exists = false;
      }

      if (!exists) {
        return {
          ...chunk,
          status: "pending",
          audioUrl: undefined,
          audioFilePath: undefined,
          durationSec: undefined,
          leadingSilenceMs: undefined,
          trailingSilenceMs: undefined,
          qualityReview: undefined,
          acknowledgedAt: undefined,
          acknowledgedAudioSignature: undefined,
        };
      }

      if (chunk.audioUrl) {
        return chunk;
      }

      try {
        const blobUrl = await deps.readBlobUrl(chunk.audioFilePath);
        return {
          ...chunk,
          audioUrl: blobUrl,
        };
      } catch {
        return {
          ...chunk,
          status: "pending",
          audioUrl: undefined,
          audioFilePath: undefined,
          durationSec: undefined,
          leadingSilenceMs: undefined,
          trailingSilenceMs: undefined,
          qualityReview: undefined,
        };
      }
    })
  );
}

export function saveDialogueSessionBackup(
  session: {
    stage: "prep" | "studio";
    rawScript: string;
    characters: DialogueCharacter[];
    segments: DialogueSegment[];
  },
  storage: KeyValueStorage | null = getDefaultStorage()
): void {
  if (!storage) return;

  try {
    if (session.segments.length === 0 && session.stage === "prep") {
      storage.removeItem(DIALOGUE_SESSION_STORAGE_KEY);
      return;
    }

    const sanitizedSegments: Array<Omit<DialogueSegment, "audioBuffer" | "audioBlobUrl">> =
      session.segments.map((seg) => {
        const { audioBuffer: _buf, audioBlobUrl: _url, ...rest } = seg;
        return {
          ...rest,
          status: seg.status === "generating" ? "pending" : seg.status,
          qualityReview:
            seg.qualityReview?.status === "checking" ? undefined : seg.qualityReview,
        };
      });

    const payload: DialogueSessionPayloadV1 = {
      version: 1,
      stage: session.stage,
      rawScript: session.rawScript,
      characters: session.characters,
      segments: sanitizedSegments,
      updatedAt: Date.now(),
    };
    storage.setItem(DIALOGUE_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("[workspaceSessionStorage] Failed to save Dialogue session:", err);
  }
}

export function loadDialogueSessionBackup(
  currentRawScript: string,
  storage: KeyValueStorage | null = getDefaultStorage()
): {
  stage: "prep" | "studio";
  characters: DialogueCharacter[];
  segments: DialogueSegment[];
} | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(DIALOGUE_SESSION_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<DialogueSessionPayloadV1>;
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.segments) ||
      parsed.segments.length === 0 ||
      typeof parsed.rawScript !== "string"
    ) {
      return null;
    }

    if (normalizeScriptKey(parsed.rawScript) !== normalizeScriptKey(currentRawScript)) {
      return null;
    }

    const stage = parsed.stage === "studio" ? "studio" : "prep";
    const characters = Array.isArray(parsed.characters) ? parsed.characters : [];
    const segments: DialogueSegment[] = parsed.segments.map((seg) => ({
      ...seg,
      audioBuffer: undefined,
      audioBlobUrl: undefined,
      status: seg.status === "generating" ? "pending" : seg.status,
      qualityReview: seg.qualityReview?.status === "checking" ? undefined : seg.qualityReview,
    }));

    return { stage, characters, segments };
  } catch (err) {
    console.warn("[workspaceSessionStorage] Failed to load Dialogue session:", err);
    return null;
  }
}

export async function hydrateDialogueSegmentsFromDisk(
  segments: DialogueSegment[],
  deps: ScratchAudioFsDeps
): Promise<DialogueSegment[]> {
  return Promise.all(
    segments.map(async (seg) => {
      if (seg.status !== "ready") {
        return seg;
      }
      if (!seg.audioFilePath) {
        return seg.audioBlobUrl || seg.audioBuffer
          ? seg
          : {
              ...seg,
              status: "pending",
              durationSec: undefined,
              qualityReview: undefined,
            };
      }

      let exists = false;
      try {
        exists = await deps.fileExists(seg.audioFilePath);
      } catch {
        exists = false;
      }

      if (!exists) {
        return {
          ...seg,
          status: "pending",
          audioBuffer: undefined,
          audioBlobUrl: undefined,
          audioFilePath: undefined,
          durationSec: undefined,
          qualityReview: undefined,
          acknowledgedAt: undefined,
          acknowledgedAudioSignature: undefined,
        };
      }

      if (seg.audioBlobUrl) {
        return seg;
      }

      try {
        const blobUrl = await deps.readBlobUrl(seg.audioFilePath);
        return {
          ...seg,
          audioBlobUrl: blobUrl,
        };
      } catch {
        return {
          ...seg,
          status: "pending",
          audioBuffer: undefined,
          audioBlobUrl: undefined,
          audioFilePath: undefined,
          durationSec: undefined,
          qualityReview: undefined,
        };
      }
    })
  );
}

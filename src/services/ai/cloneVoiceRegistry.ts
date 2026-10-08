/**
 * Clone voice registry (Gate E): the real reference material a local engine needs for zero-shot
 * cloning — an absolute reference-audio path plus its transcript. Stored in App Data
 * (`voices/clone_voices.json`); audio stays on disk, never inlined (zero-audio-binary invariant).
 *
 * Batch/Dialogue/Dubbing resolve `voiceId` → reference through `resolveCloneVoiceReference`.
 * Unknown ids return null, meaning "engine's own default voice"; engines that require a
 * reference (Qwen Base) then fail explicitly via checkEngineSupport — never silently.
 */
import { readAppDataFile, saveAppDataFile } from "../storage/tauriFsBridge";
import type { VoiceReference } from "./localAiServices";

export interface CloneVoiceEntry {
  id: string;
  name: string;
  refAudioPath: string;
  refText: string;
  language?: string;
  createdAt: number;
}

const FILE = "voices/clone_voices.json";
let cache: CloneVoiceEntry[] = [];

export function sanitizeCloneVoices(raw: unknown): CloneVoiceEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e): CloneVoiceEntry[] => {
    if (!e || typeof e !== "object") return [];
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.refAudioPath !== "string" || !o.refAudioPath) return [];
    return [{
      id: o.id,
      name: typeof o.name === "string" ? o.name : o.id,
      refAudioPath: o.refAudioPath,
      refText: typeof o.refText === "string" ? o.refText : "",
      language: typeof o.language === "string" ? o.language : undefined,
      createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
    }];
  });
}

export async function loadCloneVoiceRegistry(): Promise<CloneVoiceEntry[]> {
  try {
    cache = sanitizeCloneVoices(JSON.parse(await readAppDataFile(FILE)));
  } catch {
    cache = [];
  }
  return [...cache];
}

export function listCloneVoices(): CloneVoiceEntry[] {
  return [...cache];
}

export async function upsertCloneVoice(entry: CloneVoiceEntry): Promise<void> {
  cache = [...cache.filter((v) => v.id !== entry.id), entry];
  await saveAppDataFile(FILE, JSON.stringify(cache, null, 2));
}

export async function removeCloneVoice(id: string): Promise<void> {
  cache = cache.filter((v) => v.id !== id);
  await saveAppDataFile(FILE, JSON.stringify(cache, null, 2));
}

export function resolveCloneVoiceReference(voiceId: string): VoiceReference | null {
  const v = cache.find((e) => e.id === voiceId);
  if (!v) return null;
  return { refAudioPath: v.refAudioPath, refText: v.refText || undefined, language: v.language };
}

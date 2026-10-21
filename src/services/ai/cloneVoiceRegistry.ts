/**
 * Clone voice registry (Gate E): the real reference material a local engine needs for zero-shot
 * cloning — an absolute reference-audio path plus its transcript. Stored in App Data
 * (`voices/clone_voices.json`); audio stays on disk, never inlined (zero-audio-binary invariant).
 *
 * Batch/Dialogue/Dubbing resolve `voiceId` → reference through `resolveCloneVoiceReference`.
 * Unknown ids return null, meaning "engine's own default voice"; engines that require a
 * reference (Qwen Base) then fail explicitly via checkEngineSupport — never silently.
 */
import { getAppDataDir, readAppDataFile, saveAppDataFile } from "../storage/tauriFsBridge";
import { isTauriRuntime } from "./tauriBackend";
import type { VoiceReference } from "./localAiServices";
import type { VoiceProfile } from "../../types/ui";

export interface CloneVoiceEntry {
  id: string;
  name: string;
  refAudioPath: string;
  refText: string;
  language?: string;
  engine?: string;
  durationSec?: number;
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
      engine: typeof o.engine === "string" ? o.engine : undefined,
      durationSec: typeof o.durationSec === "number" && o.durationSec > 0 ? o.durationSec : undefined,
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

export async function updateCloneVoiceMetadata(
  id: string,
  patch: Partial<Pick<CloneVoiceEntry, "name" | "refText" | "language" | "engine" | "durationSec" | "refAudioPath">>
): Promise<void> {
  if (cache.length === 0) {
    await loadCloneVoiceRegistry();
  }
  const existing = cache.find((v) => v.id === id);
  if (!existing) return;
  const updated: CloneVoiceEntry = {
    ...existing,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.refText !== undefined ? { refText: patch.refText } : {}),
    ...(patch.language !== undefined ? { language: patch.language } : {}),
    ...(patch.engine !== undefined ? { engine: patch.engine } : {}),
    ...(patch.durationSec !== undefined ? { durationSec: patch.durationSec } : {}),
    ...(patch.refAudioPath !== undefined ? { refAudioPath: patch.refAudioPath } : {}),
  };
  await upsertCloneVoice(updated);
}

/**
 * Writes the decoded/trimmed WAV reference audio into `<AppData>/voices/clones/<voiceId>.wav`
 * and verifies that the file is present on disk before returning its absolute path.
 */
export async function persistCloneReferenceWav(
  voiceId: string,
  wavBlob: Blob
): Promise<string> {
  const safeId = voiceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const appDataDir = (await getAppDataDir()).replace(/[\\/]+$/, "");
  const targetPath = `${appDataDir}/voices/clones/${safeId}.wav`.replace(/\//g, "\\");

  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const arr = await wavBlob.arrayBuffer();
    await invoke<void>("fs_write_bytes", {
      path: targetPath,
      bytes: Array.from(new Uint8Array(arr)),
    });
    const exists = await invoke<boolean>("fs_exists", { path: targetPath });
    if (!exists) {
      throw new Error(`Không thể xác nhận tệp mẫu giọng đã lưu tại ${targetPath}`);
    }
    return targetPath;
  }

  return targetPath;
}

export async function removeCloneVoice(id: string): Promise<void> {
  if (cache.length === 0) {
    await loadCloneVoiceRegistry();
  }
  const existing = cache.find((v) => v.id === id);
  cache = cache.filter((v) => v.id !== id);
  await saveAppDataFile(FILE, JSON.stringify(cache, null, 2));

  // Clean up managed reference audio inside AppData/voices/clones if running in Tauri
  if (existing?.refAudioPath && isTauriRuntime()) {
    const normalized = existing.refAudioPath.replace(/\\/g, "/").toLowerCase();
    if (normalized.includes("/voices/clones/") || normalized.includes("/scratch/clone_ref/")) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke<void>("fs_remove_file", { path: existing.refAudioPath });
      } catch {
        // Ignore if file already deleted
      }
    }
  }
}

/**
 * Reconciles UI VoiceProfile list with the durable clone_voices.json registry:
 * - Synchronizes `sampleAudioPath`, `sampleDurationSec`, and `referenceTranscript` for existing cloned voices
 * - Restores any cloned voice entries present in `clone_voices.json` that are missing from `profiles`
 */
export async function reconcileCloneVoicesWithProfiles(
  profiles: VoiceProfile[]
): Promise<VoiceProfile[]> {
  const entries = await loadCloneVoiceRegistry();
  if (entries.length === 0) return profiles;

  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const seenIds = new Set<string>();

  const updatedProfiles = profiles.map((p) => {
    const entry = entryMap.get(p.id);
    if (!entry) return p;
    seenIds.add(p.id);
    return {
      ...p,
      name: p.name || entry.name,
      sampleAudioPath: entry.refAudioPath || p.sampleAudioPath,
      ...(entry.durationSec ? { sampleDurationSec: entry.durationSec } : {}),
      ...(entry.refText ? { referenceTranscript: entry.refText } : {}),
    };
  });

  // Restore any orphaned registry entries missing from UI localStorage
  for (const entry of entries) {
    if (!seenIds.has(entry.id)) {
      const iso = new Date(entry.createdAt || Date.now()).toISOString();
      const engine = entry.engine || "omnivoice";
      const modelLabel =
        engine === "chatterbox_turbo" || engine === "chatterbox"
          ? "Chatterbox Turbo"
          : engine === "qwen_tts_1_7b" || engine === "qwen"
          ? "Qwen TTS"
          : "OmniVoice";
      updatedProfiles.unshift({
        id: entry.id,
        name: entry.name,
        source: "local_clone",
        origin: "clone",
        engine,
        sourceType: "local",
        provider: "local",
        country: entry.language === "vi" ? "VN" : (entry.language || "EN").toUpperCase(),
        styles: ["natural"],
        style: "natural",
        category: "natural",
        tags: [],
        supportedLanguages: entry.language ? [entry.language] : ["vi", "en"],
        modelCompatibility: [modelLabel],
        availability: "available",
        previewAvailable: true,
        createdAt: iso,
        lastUsedAt: iso,
        isFavorite: false,
        avatarColor: "from-accent to-teal-500",
        sampleAudioPath: entry.refAudioPath,
        sampleDurationSec: entry.durationSec,
        ...(entry.refText ? { referenceTranscript: entry.refText } : {}),
      });
    }
  }

  return updatedProfiles;
}

export function resolveCloneVoiceReference(voiceId: string): VoiceReference | null {
  const v = cache.find((e) => e.id === voiceId);
  if (!v) return null;
  return { refAudioPath: v.refAudioPath, refText: v.refText || undefined, language: v.language };
}

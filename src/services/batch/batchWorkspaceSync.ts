/**
 * Synchronizes Batch global defaults with standalone workspace settings
 * (`Subtitles`, `TTS`, `Dialogue`, `Translation`, `Dubbing`) so Batch tasks
 * immediately mirror the active models, voices, and providers configured in the app.
 */

import { BatchTaskConfigMap } from "../../types/batch";
import { DubbingMode, normalizeDubbingMode } from "../../types/dubbing";
import { PunctuationPauses, VoiceProfile } from "../../types/ui";
import { DEFAULT_DIALOGUE_SETTINGS } from "../../types/dialogue";
import { MOCK_VOICES, mergeStoredVoicesWithCatalog } from "../../mock/data";
import { migrateLegacyVoice } from "../../constants/voiceFilters";
import {
  DEFAULT_PUNCTUATION_PAUSES,
  sanitizePunctuationPauses,
} from "../pause/punctuationPause";
import { loadSubtitleSettings } from "../subtitle/profiles";
import {
  loadTranslationSettings,
  translationManager,
  TranslationStyle,
} from "../translation";
import {
  resolveBatchModelForVoiceProfile,
  resolveBatchWhisperModelId,
} from "./batchModelResolver";

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (
      typeof globalThis !== "undefined" &&
      (globalThis as { localStorage?: Storage }).localStorage
    ) {
      return (globalThis as { localStorage?: Storage }).localStorage ?? null;
    }
  } catch {
    // ignore storage access errors
  }
  return null;
}

export function loadBatchCatalogVoices(): VoiceProfile[] {
  const storage = getSafeLocalStorage();
  if (storage) {
    try {
      const raw = storage.getItem("voxlab_voices_v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        return mergeStoredVoicesWithCatalog(parsed, migrateLegacyVoice);
      }
    } catch {
      // ignore corrupt storage
    }
  }
  return MOCK_VOICES.map(migrateLegacyVoice);
}

export function pickPreferredWorkspaceVoiceId(voices: VoiceProfile[]): string {
  if (voices.length === 0) return "edge_vi_hoaimy";
  let latestVoice: VoiceProfile | null = null;
  let latestTs = -1;
  for (const v of voices) {
    if (v.lastUsedAt) {
      const ts = Date.parse(v.lastUsedAt);
      if (!Number.isNaN(ts) && ts > latestTs) {
        latestTs = ts;
        latestVoice = v;
      }
    }
  }
  if (latestVoice) return latestVoice.id;
  return voices[0].id || "edge_vi_hoaimy";
}

function readStoredTtsSettingsSafe(): {
  speed?: number;
  pitch?: number;
  volume?: number;
  pauses?: PunctuationPauses;
  exportSrt?: boolean;
} {
  const storage = getSafeLocalStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem("voxlab_tts_inspector_settings_v1");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function readStoredDialogueSettingsSafe(): {
  model?: string;
  turnPauseMinSec?: number;
  turnPauseMaxSec?: number;
  sameSpeakerPauseSec?: number;
  pauses?: PunctuationPauses;
  exportSrt?: boolean;
  masterVolume?: number;
} {
  const storage = getSafeLocalStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem("voxlab_dialogue_settings");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function readStoredDubbingSettingsSafe(): {
  dubbingMode: DubbingMode;
  voiceId: string;
  speed: number;
  pitch: number;
  volume: number;
  pauses: PunctuationPauses;
} {
  let dubbingMode: DubbingMode = "source_sync";
  let voiceId = "";
  let speed = 1.0;
  let pitch = 1.0;
  let volume = 100;
  let pauses: PunctuationPauses = { ...DEFAULT_PUNCTUATION_PAUSES };

  const storage = getSafeLocalStorage();
  if (storage) {
    try {
      const savedMode = storage.getItem("voxlab_dubbing_mode");
      if (savedMode) dubbingMode = normalizeDubbingMode(savedMode);
      const savedVoice = storage.getItem("voxlab_dubbing_selected_voice");
      if (savedVoice) voiceId = savedVoice;
      const savedVoiceSettings = storage.getItem("voxlab_dubbing_voice_settings");
      if (savedVoiceSettings) {
        const parsed = JSON.parse(savedVoiceSettings);
        if (typeof parsed.speed === "number") speed = parsed.speed;
        if (typeof parsed.pitch === "number") pitch = parsed.pitch;
        if (typeof parsed.volume === "number") {
          volume =
            parsed.volume <= 2.0
              ? Math.round(parsed.volume * 100)
              : Math.round(parsed.volume);
        }
        if (parsed.pauses && typeof parsed.pauses === "object") {
          pauses = sanitizePunctuationPauses(parsed.pauses);
        }
      }
    } catch {
      // ignore
    }
  }
  return { dubbingMode, voiceId, speed, pitch, volume, pauses };
}

/**
 * Hydrates Batch global defaults from standalone workspace settings whenever
 * uncustomized schema placeholders (`omnivoice-auto`, `gemini`) are still present,
 * and always keeps `transcription.whisperModel` canonicalized with Subtitle settings.
 */
export function hydrateBatchGlobalDefaultsFromWorkspaces(
  existing: BatchTaskConfigMap = {}
): BatchTaskConfigMap {
  const voices = loadBatchCatalogVoices();
  const preferredVoiceId = pickPreferredWorkspaceVoiceId(voices);

  // 1. TTS
  const storedTts = readStoredTtsSettingsSafe();
  const existingTts = existing.tts;
  const ttsVoiceId =
    existingTts?.voiceId && existingTts.voiceId !== "omnivoice-auto"
      ? existingTts.voiceId
      : preferredVoiceId;
  const matchedTtsVoice = voices.find((v) => v.id === ttsVoiceId);
  const rawTtsPitch = existingTts?.pitch ?? storedTts.pitch;
  const ttsPitch =
    typeof rawTtsPitch === "number" && rawTtsPitch >= 0.5 && rawTtsPitch <= 1.5
      ? rawTtsPitch
      : 1.0;
  const rawTtsVol = existingTts?.volume ?? storedTts.volume ?? 100;
  const ttsVol =
    rawTtsVol <= 2.0 && rawTtsVol > 0 ? Math.round(rawTtsVol * 100) : Math.round(rawTtsVol);
  const ttsModel = resolveBatchModelForVoiceProfile(matchedTtsVoice, existingTts?.model);

  // 2. Dialogue
  const storedDlg = readStoredDialogueSettingsSafe();
  const existingDlg = existing.dialogue;
  const dlgVoiceId =
    existingDlg?.defaultVoiceId && existingDlg.defaultVoiceId !== "omnivoice-auto"
      ? existingDlg.defaultVoiceId
      : preferredVoiceId;
  const matchedDlgVoice = voices.find((v) => v.id === dlgVoiceId);
  const dlgModel = resolveBatchModelForVoiceProfile(
    matchedDlgVoice,
    storedDlg.model || existingDlg?.model
  );

  // 3. Transcription (Whisper ASR)
  const subSettings = loadSubtitleSettings();
  const existingSub = existing.transcription;
  const whisperModel = resolveBatchWhisperModelId(
    subSettings.whisperModel || existingSub?.whisperModel || "large-v3-turbo"
  );

  // 4. Translation
  const transSettings = loadTranslationSettings();
  const existingTrans = existing.translation;
  const style: TranslationStyle =
    transSettings.translationStyle || existingTrans?.style || "default";
  const allProviders = translationManager.listProviders();
  let providerId =
    existingTrans?.providerId && existingTrans.providerId !== "gemini"
      ? existingTrans.providerId
      : transSettings.translationProviderId || existingTrans?.providerId || "google";
  if (style === "cinema" && providerId === "google") {
    const supported = allProviders.filter((p) => p.type !== "google");
    if (supported.length > 0) {
      providerId = supported[0].id;
    }
  }

  // 5. Dubbing
  const storedDub = readStoredDubbingSettingsSafe();
  const existingDub = existing.dubbing;
  const dubVoiceId =
    existingDub?.voiceId && existingDub.voiceId !== "omnivoice-auto"
      ? existingDub.voiceId
      : storedDub.voiceId || preferredVoiceId;
  const matchedDubVoice = voices.find((v) => v.id === dubVoiceId);
  const dubModel = resolveBatchModelForVoiceProfile(
    matchedDubVoice,
    existingDub?.ttsModel
  );

  return {
    ...existing,
    tts: {
      model: ttsModel,
      voiceId: ttsVoiceId,
      speed: existingTts?.speed ?? storedTts.speed ?? 1.0,
      pitch: ttsPitch,
      volume: ttsVol,
      pauses:
        existingTts?.pauses ||
        (storedTts.pauses ? sanitizePunctuationPauses(storedTts.pauses) : undefined) ||
        { ...DEFAULT_PUNCTUATION_PAUSES },
      exportSrt: existingTts?.exportSrt ?? storedTts.exportSrt ?? false,
    },
    dialogue: {
      model: dlgModel,
      defaultVoiceId: dlgVoiceId,
      speed: existingDlg?.speed ?? 1.0,
      pitch: existingDlg?.pitch ?? 1.0,
      volume:
        existingDlg?.volume ??
        (typeof storedDlg.masterVolume === "number"
          ? Math.round(storedDlg.masterVolume * 100)
          : 100),
      turnPauseMinSec:
        existingDlg?.turnPauseMinSec ??
        storedDlg.turnPauseMinSec ??
        DEFAULT_DIALOGUE_SETTINGS.turnPauseMinSec,
      turnPauseMaxSec:
        existingDlg?.turnPauseMaxSec ??
        storedDlg.turnPauseMaxSec ??
        DEFAULT_DIALOGUE_SETTINGS.turnPauseMaxSec,
      turnPauseSec: existingDlg?.turnPauseSec ?? 0.5,
      sameSpeakerPauseSec:
        existingDlg?.sameSpeakerPauseSec ??
        storedDlg.sameSpeakerPauseSec ??
        DEFAULT_DIALOGUE_SETTINGS.sameSpeakerPauseSec,
      pauses:
        existingDlg?.pauses ||
        (storedDlg.pauses ? sanitizePunctuationPauses(storedDlg.pauses) : undefined) ||
        { ...DEFAULT_PUNCTUATION_PAUSES },
      exportSrt: existingDlg?.exportSrt ?? storedDlg.exportSrt ?? true,
      characterVoices: {
        ...(existingDlg?.characterVoices || {}),
      },
    },
    transcription: {
      audioLanguage: existingSub?.audioLanguage || subSettings.audioLanguage || "auto",
      whisperModel,
      speechSpeed: existingSub?.speechSpeed ?? subSettings.speechSpeed ?? 1.0,
      aspectRatio: existingSub?.aspectRatio || subSettings.aspectRatio || "16:9",
      maxLines: existingSub?.maxLines || subSettings.maxLines || 1,
      outputFormat: existingSub?.outputFormat || "srt",
    },
    translation: {
      providerId,
      sourceLanguage: existingTrans?.sourceLanguage || transSettings.sourceLanguage || "auto",
      targetLanguage: transSettings.targetLanguage || existingTrans?.targetLanguage || "vi",
      style,
      outputFormat: existingTrans?.outputFormat || "preserve_input",
    },
    dubbing: {
      ttsModel: dubModel,
      voiceId: dubVoiceId,
      dubbingMode: existingDub?.dubbingMode || storedDub.dubbingMode || "source_sync",
      speed: existingDub?.speed ?? storedDub.speed ?? 1.0,
      pitch: existingDub?.pitch ?? storedDub.pitch ?? 1.0,
      volume: existingDub?.volume ?? storedDub.volume ?? 100,
      pauses: existingDub?.pauses || storedDub.pauses || { ...DEFAULT_PUNCTUATION_PAUSES },
      autoFitEnabled: existingDub?.autoFitEnabled ?? false,
      speedMultiplier: existingDub?.speedMultiplier ?? 1.0,
      turnPauseSec: existingDub?.turnPauseSec ?? 0.3,
    },
  };
}

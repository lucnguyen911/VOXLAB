import {
  analyzeAudioQuality,
  audioBufferToWavBlob,
  getCloneEngineDurationRules,
} from "../../audio/audioDsp";
import {
  loadCloneVoiceRegistry,
  persistCloneReferenceWav,
  reconcileCloneVoicesWithProfiles,
  removeCloneVoice,
  resolveCloneVoiceReference,
  updateCloneVoiceMetadata,
  upsertCloneVoice,
} from "../cloneVoiceRegistry";
import type { VoiceProfile } from "../../../types/ui";

const memStore = new Map<string, string>();
if (typeof globalThis.localStorage === "undefined") {
  (globalThis as any).localStorage = {
    getItem: (k: string) => memStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memStore.set(k, String(v));
    },
    removeItem: (k: string) => {
      memStore.delete(k);
    },
    clear: () => {
      memStore.clear();
    },
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function createMockAudioBuffer(durationSec: number, sampleRate = 24000, amplitude = 0.25): AudioBuffer {
  const length = Math.max(1, Math.floor(durationSec * sampleRate));
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * amplitude;
  }
  return {
    duration: durationSec,
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

export async function runCloneVoiceWorkflowTests(): Promise<void> {
  memStore.clear();
  await loadCloneVoiceRegistry();

  // 1. Per-model empirically verified duration rules
  const omni = getCloneEngineDurationRules("omnivoice");
  assert(omni.minSec === 3.0 && omni.sweetMinSec === 6.0 && omni.sweetMaxSec === 10.0 && omni.maxRecommendedSec === 15.0, "OmniVoice rules mismatch");

  const chatter = getCloneEngineDurationRules("chatterbox_turbo");
  assert(chatter.minSec === 5.5 && chatter.sweetMinSec === 8.0 && chatter.sweetMaxSec === 15.0 && chatter.maxRecommendedSec === 20.0, "Chatterbox rules mismatch");

  const qwen = getCloneEngineDurationRules("qwen_tts_1_7b");
  assert(qwen.minSec === 3.0 && qwen.sweetMinSec === 6.0 && qwen.sweetMaxSec === 10.0 && qwen.maxRecommendedSec === 15.0, "Qwen rules mismatch");

  // 2. Audio quality evaluation per engine
  const buf45 = createMockAudioBuffer(4.5);
  assert(analyzeAudioQuality(buf45, "omnivoice").status === "warning", "4.5s on OmniVoice should be warning");
  assert(analyzeAudioQuality(buf45, "chatterbox_turbo").status === "poor", "4.5s on Chatterbox should be poor (<5.5s)");

  const buf8 = createMockAudioBuffer(8.0);
  assert(analyzeAudioQuality(buf8, "omnivoice").status === "good", "8.0s on OmniVoice should be good");
  assert(analyzeAudioQuality(buf8, "chatterbox_turbo").status === "good", "8.0s on Chatterbox should be good");
  assert(analyzeAudioQuality(buf8, "qwen_tts_1_7b").status === "good", "8.0s on Qwen should be good");

  const buf18 = createMockAudioBuffer(18.0);
  assert(analyzeAudioQuality(buf18, "chatterbox_turbo").status === "good", "18.0s on Chatterbox should be good (<=20s)");
  assert(analyzeAudioQuality(buf18, "omnivoice").status === "warning", "18.0s on OmniVoice should be warning (>15s)");
  assert(analyzeAudioQuality(buf18, "qwen_tts_1_7b").status === "warning", "18.0s on Qwen should be warning (>15s)");

  // 3. Durable WAV persistence + registry synchronization
  const trimmedBuffer = createMockAudioBuffer(8.0, 24000);
  const wavBlob = audioBufferToWavBlob(trimmedBuffer);
  assert(wavBlob.size === 8.0 * 24000 * 2 + 44, "WAV blob size mismatch");

  const voiceId = "clone_test_1001";
  const persistedPath = await persistCloneReferenceWav(voiceId, wavBlob);
  assert(persistedPath.includes("voices\\clones\\clone_test_1001.wav"), "Persisted WAV path mismatch");

  await upsertCloneVoice({
    id: voiceId,
    name: "Minh Anh Clone",
    refAudioPath: persistedPath,
    refText: "Xin chào các bạn.",
    language: "vi",
    engine: "omnivoice",
    durationSec: 8.0,
    createdAt: 1700000000000,
  });

  const resolved = resolveCloneVoiceReference(voiceId);
  assert(resolved?.refAudioPath === persistedPath && resolved?.refText === "Xin chào các bạn.", "Resolved reference mismatch");

  await updateCloneVoiceMetadata(voiceId, {
    name: "Minh Anh Pro",
    refText: "Xin chào các bạn thân mến.",
  });
  const afterUpdate = resolveCloneVoiceReference(voiceId);
  assert(afterUpdate?.refText === "Xin chào các bạn thân mến.", "Updated refText mismatch");

  const reconciled = await reconcileCloneVoicesWithProfiles([]);
  assert(reconciled.length === 1 && reconciled[0].sampleAudioPath === persistedPath && reconciled[0].sampleDurationSec === 8.0, "Reconciled orphan profile mismatch");

  const staleProfile: VoiceProfile = {
    ...reconciled[0],
    sampleAudioPath: "C:\\stale\\original_untrimmed.mp3",
    sampleDurationSec: undefined,
  };
  const synced = await reconcileCloneVoicesWithProfiles([staleProfile]);
  assert(synced[0].sampleAudioPath === persistedPath && synced[0].sampleDurationSec === 8.0, "Synced stale profile mismatch");

  await removeCloneVoice(voiceId);
  assert(resolveCloneVoiceReference(voiceId) === null, "Removed voice should return null");
}

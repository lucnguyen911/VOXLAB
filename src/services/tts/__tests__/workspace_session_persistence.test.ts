import assert from "node:assert/strict";
import { ChunkItem } from "../../../types/ui";
import {
  CHARACTER_COLOR_PALETTE,
  DialogueCharacter,
  DialogueSegment,
} from "../../../types/dialogue";
import {
  PROCESS_SESSION_ID_STORAGE_KEY,
  TTS_SESSION_STORAGE_KEY,
  TTS_WORKING_TEXT_STORAGE_KEY,
  DIALOGUE_SESSION_STORAGE_KEY,
  DIALOGUE_SCRIPT_STORAGE_KEY,
  reconcileChunksPreservingGeneratedAudio,
  saveTtsSessionBackup,
  loadTtsSessionBackup,
  hydrateTtsSessionChunksFromDisk,
  saveDialogueSessionBackup,
  loadDialogueSessionBackup,
  hydrateDialogueSegmentsFromDisk,
  loadTtsWorkingText,
  saveTtsWorkingText,
  loadDialogueWorkingScript,
  saveDialogueWorkingScript,
  syncWorkspaceSessionWithProcessId,
} from "../workspaceSessionStorage";

function createMemoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

async function runTests() {
  // 1. reconcileChunksPreservingGeneratedAudio keeps ready chunks across Prep <-> Studio & partial edits
  {
    const prevChunks: ChunkItem[] = [
      {
        id: "chunk_1",
        index: 1,
        text: "Hello world.",
        originalText: "Hello world.",
        pauseAfterMs: 400,
        status: "ready",
        durationSec: 1.8,
        audioUrl: "blob:http://localhost/1",
        audioFilePath: "C:/scratch/tts/chunk_1.wav",
        audioRevision: 2,
        leadingSilenceMs: 15,
        trailingSilenceMs: 40,
        voiceOverrideId: "kokoro_af_heart",
        qualityReview: {
          status: "pass",
          summary: "Đạt chuẩn",
          issues: [],
          checkedAt: 1000,
          validatorVersion: "4.5.2",
        },
      },
      {
        id: "chunk_2",
        index: 2,
        text: "Original second sentence.",
        originalText: "Original second sentence.",
        pauseAfterMs: 400,
        status: "ready",
        durationSec: 2.4,
        audioUrl: "blob:http://localhost/2",
        audioFilePath: "C:/scratch/tts/chunk_2.wav",
      },
      {
        id: "chunk_3",
        index: 3,
        text: "Hello world.",
        originalText: "Hello world.",
        pauseAfterMs: 400,
        status: "ready",
        durationSec: 1.9,
        audioUrl: "blob:http://localhost/3",
        audioFilePath: "C:/scratch/tts/chunk_3.wav",
      },
    ];

    const parsedAfterSingleEdit: ChunkItem[] = [
      {
        id: "new_1",
        index: 1,
        text: "Hello world.",
        originalText: "Hello world.",
        status: "pending",
        pauseAfterMs: 450,
      },
      {
        id: "new_2",
        index: 2,
        text: "Edited second sentence!",
        originalText: "Edited second sentence!",
        status: "pending",
        pauseAfterMs: 450,
      },
      {
        id: "new_3",
        index: 3,
        text: "Hello world.",
        originalText: "Hello world.",
        status: "pending",
        pauseAfterMs: 600,
      },
    ];

    const reconciled = reconcileChunksPreservingGeneratedAudio(prevChunks, parsedAfterSingleEdit);
    assert.equal(reconciled.length, 3);

    // First duplicate "Hello world." keeps chunk_1's audio & QC
    assert.equal(reconciled[0].id, "chunk_1");
    assert.equal(reconciled[0].status, "ready");
    assert.equal(reconciled[0].audioFilePath, "C:/scratch/tts/chunk_1.wav");
    assert.equal(reconciled[0].audioUrl, "blob:http://localhost/1");
    assert.equal(reconciled[0].leadingSilenceMs, 15);
    assert.equal(reconciled[0].trailingSilenceMs, 40);
    assert.equal(reconciled[0].pauseAfterMs, 450);
    assert.equal(reconciled[0].qualityReview?.status, "pass");

    // Edited middle sentence becomes fresh pending chunk
    assert.equal(reconciled[1].id, "new_2");
    assert.equal(reconciled[1].status, "pending");
    assert.equal(reconciled[1].audioFilePath, undefined);
    assert.equal(reconciled[1].audioUrl, undefined);

    // Second duplicate "Hello world." keeps chunk_3's distinct audio
    assert.equal(reconciled[2].id, "chunk_3");
    assert.equal(reconciled[2].status, "ready");
    assert.equal(reconciled[2].audioFilePath, "C:/scratch/tts/chunk_3.wav");
    assert.equal(reconciled[2].audioUrl, "blob:http://localhost/3");
    assert.equal(reconciled[2].pauseAfterMs, 600);
  }

  // 2. TTS Session Backup strips blob URLs, normalizes transient states, and hydrates from disk
  {
    const storage = createMemoryStorage();
    const script = "First line. Second line. Third line.";
    const chunks: ChunkItem[] = [
      {
        id: "c1",
        index: 1,
        text: "First line.",
        originalText: "First line.",
        pauseAfterMs: 400,
        status: "ready",
        durationSec: 1.5,
        audioUrl: "blob:ram-only-1",
        audioFilePath: "C:/scratch/tts/c1.wav",
        leadingSilenceMs: 10,
        trailingSilenceMs: 25,
        qualityReview: {
          status: "pass",
          summary: "OK",
          issues: [],
          checkedAt: 12345,
        },
      },
      {
        id: "c2",
        index: 2,
        text: "Second line.",
        originalText: "Second line.",
        pauseAfterMs: 400,
        status: "ready",
        durationSec: 2.1,
        audioUrl: "blob:ram-only-2",
        audioFilePath: "C:/scratch/tts/c2_deleted.wav",
        qualityReview: {
          status: "checking",
          summary: "Đang kiểm tra...",
          issues: [],
          checkedAt: 12346,
        },
      },
      {
        id: "c3",
        index: 3,
        text: "Third line.",
        originalText: "Third line.",
        pauseAfterMs: 400,
        status: "generating",
      },
    ];

    saveTtsSessionBackup({ stage: "studio", workingText: script, chunks }, storage);
    const raw = storage.getItem(TTS_SESSION_STORAGE_KEY);
    assert.ok(raw && !raw.includes("blob:ram-only"), "Blob URLs must never be written to storage");

    // Mismatched workingText returns null
    assert.equal(loadTtsSessionBackup("Completely different script", storage), null);

    // Matching workingText restores studio session
    const loaded = loadTtsSessionBackup(script, storage);
    assert.ok(loaded);
    assert.equal(loaded.stage, "studio");
    assert.equal(loaded.chunks.length, 3);
    assert.equal(loaded.chunks[0].status, "ready");
    assert.equal(loaded.chunks[0].audioUrl, undefined);
    assert.equal(loaded.chunks[0].audioFilePath, "C:/scratch/tts/c1.wav");
    assert.equal(loaded.chunks[0].qualityReview?.status, "pass");
    assert.equal(loaded.chunks[1].qualityReview, undefined, "Transient 'checking' QC must be cleared");
    assert.equal(loaded.chunks[2].status, "pending", "Interrupted 'generating' chunk must become 'pending'");

    // Hydrate from disk: c1 exists -> gets fresh blobUrl; c2 missing -> resets cleanly to pending
    const hydrated = await hydrateTtsSessionChunksFromDisk(loaded.chunks, {
      fileExists: async (p) => p === "C:/scratch/tts/c1.wav",
      readBlobUrl: async (p) => `blob:rehydrated:${p}`,
    });

    assert.equal(hydrated[0].status, "ready");
    assert.equal(hydrated[0].audioUrl, "blob:rehydrated:C:/scratch/tts/c1.wav");
    assert.equal(hydrated[0].leadingSilenceMs, 10);
    assert.equal(hydrated[0].qualityReview?.status, "pass");

    assert.equal(hydrated[1].status, "pending");
    assert.equal(hydrated[1].audioFilePath, undefined);
    assert.equal(hydrated[1].audioUrl, undefined);
    assert.equal(hydrated[1].durationSec, undefined);
  }

  // 3. Dialogue Session Backup preserves characters + segments and reconciles missing scratch files
  {
    const storage = createMemoryStorage();
    const rawScript = "Nam: Xin chào!\nLan: Chào bạn!";
    const characters: DialogueCharacter[] = [
      {
        id: "nam",
        name: "Nam",
        voiceId: "kokoro_am_adam",
        segmentCount: 1,
        colorTheme: CHARACTER_COLOR_PALETTE[0],
        speed: 1.0,
        pitch: 1.0,
        volume: 1.0,
      },
      {
        id: "lan",
        name: "Lan",
        voiceId: "kokoro_af_heart",
        segmentCount: 1,
        colorTheme: CHARACTER_COLOR_PALETTE[1],
        speed: 1.0,
        pitch: 1.0,
        volume: 1.0,
      },
    ];
    const segments: DialogueSegment[] = [
      {
        id: "seg_1",
        index: 0,
        characterId: "nam",
        characterName: "Nam",
        rawText: "Xin chào!",
        cleanText: "Xin chào!",
        pauseAfterSec: 0.4,
        status: "ready",
        durationSec: 1.2,
        audioBlobUrl: "blob:dialogue-1",
        audioFilePath: "C:/scratch/dialogue/seg_1.wav",
      },
      {
        id: "seg_2",
        index: 1,
        characterId: "lan",
        characterName: "Lan",
        rawText: "Chào bạn!",
        cleanText: "Chào bạn!",
        pauseAfterSec: 0.4,
        status: "generating",
      },
    ];

    saveDialogueSessionBackup({ stage: "studio", rawScript, characters, segments }, storage);
    const raw = storage.getItem(DIALOGUE_SESSION_STORAGE_KEY);
    assert.ok(raw && !raw.includes("blob:dialogue-1"));

    const loaded = loadDialogueSessionBackup(rawScript, storage);
    assert.ok(loaded);
    assert.equal(loaded.stage, "studio");
    assert.equal(loaded.characters[0].voiceId, "kokoro_am_adam");
    assert.equal(loaded.segments[0].status, "ready");
    assert.equal(loaded.segments[0].audioBlobUrl, undefined);
    assert.equal(loaded.segments[1].status, "pending");

    const hydrated = await hydrateDialogueSegmentsFromDisk(loaded.segments, {
      fileExists: async (p) => p === "C:/scratch/dialogue/seg_1.wav",
      readBlobUrl: async (p) => `blob:rehydrated:${p}`,
    });
    assert.equal(hydrated[0].status, "ready");
    assert.equal(hydrated[0].audioBlobUrl, "blob:rehydrated:C:/scratch/dialogue/seg_1.wav");
  }

  // 4. Process-Scoped Session Lifecycle: preserves across in-app tab switches / reloads, wipes on app exit & restart while keeping settings
  {
    const sessionStore = createMemoryStorage();
    const localStore = createMemoryStorage();

    // Seed durable app settings + legacy v1.0.6 ephemeral keys in localStorage
    localStore.setItem("voxlab_active_model", "OmniVoice");
    localStore.setItem("voxlab_active_voice_id", "clone_custom_en");
    localStore.setItem("voxlab_tts_inspector_settings_v1", JSON.stringify({ speed: 1.05 }));
    localStore.setItem("voxlab_dialogue_settings", JSON.stringify({ model: "Omni Voice" }));
    localStore.setItem("voxlab_theme", "dark");
    localStore.setItem(TTS_WORKING_TEXT_STORAGE_KEY, "Legacy stale script from v1.0.6");
    localStore.setItem(TTS_SESSION_STORAGE_KEY, '{"version":1,"stage":"studio"}');
    localStore.setItem(DIALOGUE_SCRIPT_STORAGE_KEY, "Nam: Old dialogue");
    localStore.setItem(DIALOGUE_SESSION_STORAGE_KEY, '{"version":1,"stage":"studio"}');

    let freshLaunchCount = 0;

    // First launch of Process #1 ("proc_1000_aaa"): purges legacy localStorage drafts & binds session
    const isFresh1 = await syncWorkspaceSessionWithProcessId({
      currentProcessId: "proc_1000_aaa",
      sessionStore,
      localStore,
      onFreshProcessLaunch: () => {
        freshLaunchCount += 1;
      },
    });
    assert.equal(isFresh1, true);
    assert.equal(freshLaunchCount, 1);
    assert.equal(sessionStore.getItem(PROCESS_SESSION_ID_STORAGE_KEY), "proc_1000_aaa");

    // Legacy localStorage drafts are purged, while all durable app settings stay 100% intact
    assert.equal(localStore.getItem(TTS_WORKING_TEXT_STORAGE_KEY), null);
    assert.equal(localStore.getItem(TTS_SESSION_STORAGE_KEY), null);
    assert.equal(localStore.getItem(DIALOGUE_SCRIPT_STORAGE_KEY), null);
    assert.equal(localStore.getItem(DIALOGUE_SESSION_STORAGE_KEY), null);
    assert.equal(localStore.getItem("voxlab_active_model"), "OmniVoice");
    assert.equal(localStore.getItem("voxlab_active_voice_id"), "clone_custom_en");
    assert.equal(localStore.getItem("voxlab_tts_inspector_settings_v1"), '{"speed":1.05}');
    assert.equal(localStore.getItem("voxlab_dialogue_settings"), '{"model":"Omni Voice"}');
    assert.equal(localStore.getItem("voxlab_theme"), "dark");

    // User works inside Process #1 (TTS + Dialogue + Dubbing drafts saved in sessionStore)
    saveTtsWorkingText("Current TTS draft in open session", sessionStore);
    saveTtsSessionBackup(
      {
        stage: "studio",
        workingText: "Current TTS draft in open session",
        chunks: [
          {
            id: "c_live",
            index: 1,
            text: "Current TTS draft in open session",
            originalText: "Current TTS draft in open session",
            pauseAfterMs: "auto",
            status: "ready",
            durationSec: 3.2,
            audioFilePath: "C:/scratch/tts/c_live.wav",
          },
        ],
      },
      sessionStore
    );
    saveDialogueWorkingScript("A: Live dialogue", sessionStore);
    sessionStore.setItem("voxlab_dubbing_session_backup", '{"originalCues":[{"index":1}]}');

    // Tab switches / WebView reload inside SAME Process #1 ("proc_1000_aaa"): session MUST survive 100%
    const isFreshReload = await syncWorkspaceSessionWithProcessId({
      currentProcessId: "proc_1000_aaa",
      sessionStore,
      localStore,
      onFreshProcessLaunch: () => {
        freshLaunchCount += 1;
      },
    });
    assert.equal(isFreshReload, false);
    assert.equal(freshLaunchCount, 1);
    assert.equal(loadTtsWorkingText("", sessionStore), "Current TTS draft in open session");
    assert.equal(loadTtsSessionBackup("Current TTS draft in open session", sessionStore)?.stage, "studio");
    assert.equal(loadDialogueWorkingScript("", sessionStore), "A: Live dialogue");
    assert.equal(sessionStore.getItem("voxlab_dubbing_session_backup"), '{"originalCues":[{"index":1}]}');

    // User exits VoxLab and launches a NEW Process #2 ("proc_2000_bbb"):
    // ALL workspace sessions MUST be wiped clean, while durable app settings remain 100% intact!
    const isFreshRestart = await syncWorkspaceSessionWithProcessId({
      currentProcessId: "proc_2000_bbb",
      sessionStore,
      localStore,
      onFreshProcessLaunch: () => {
        freshLaunchCount += 1;
      },
    });
    assert.equal(isFreshRestart, true);
    assert.equal(freshLaunchCount, 2);
    assert.equal(sessionStore.getItem(PROCESS_SESSION_ID_STORAGE_KEY), "proc_2000_bbb");
    assert.equal(loadTtsWorkingText("", sessionStore), "");
    assert.equal(loadTtsSessionBackup("Current TTS draft in open session", sessionStore), null);
    assert.equal(loadDialogueWorkingScript("", sessionStore), "");
    assert.equal(sessionStore.getItem("voxlab_dubbing_session_backup"), null);

    // Durable settings are still 100% preserved after app restart
    assert.equal(localStore.getItem("voxlab_active_model"), "OmniVoice");
    assert.equal(localStore.getItem("voxlab_active_voice_id"), "clone_custom_en");
    assert.equal(localStore.getItem("voxlab_tts_inspector_settings_v1"), '{"speed":1.05}');
    assert.equal(localStore.getItem("voxlab_dialogue_settings"), '{"model":"Omni Voice"}');
  }

  console.log("PASS: workspace_session_persistence tests (4 suites)");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});

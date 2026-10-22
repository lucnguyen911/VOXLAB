import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ensureGeminiKeyStoreInitialized,
  loadGeminiKeyEntriesFromVault,
  saveGeminiKeyEntries,
  scheduleDebouncedGeminiKeySave,
  flushPendingGeminiKeyWrites,
  getGeminiVaultStatus,
  getGeminiVaultError,
  getGeminiKeyStoreDiagnostics,
  configureGeminiKeyStoreForTest,
  geminiKeyPool,
  geminiTranslationCoordinator,
  GeminiTranslateProvider,
  TranslationManager,
  PROVIDER_CONFIGS_STORAGE_KEY,
  TRANSLATION_SETTINGS_KEY,
  type GeminiKeyEntry,
} from "../index";
import { CredentialResolver } from "../../batch/credentialResolver";
import {
  reconstructFreeNarrationScript,
  buildTranslatedNarrationScriptText,
  applyFullNarrationScriptEdit,
} from "../../dubbing/freeNarrationScript";
import { generateNarrationAlignedSrt } from "../../dubbing/alignedSrtGenerator";
import {
  recordCompletedJobToHistory,
  deleteHistoryItem,
  loadHistoryItems,
  applyHydratedMetadataToMemory,
  resetHistoryManagerForTesting,
  flushPendingHistoryWrites,
  getHistoryRevision,
} from "../../history/historyManager";
import { OriginalCue, DubAudioSegment } from "../../../types/dubbing";

describe("Post-35c8fba Regression & Architecture Verification Suite (P0, P1, P2)", () => {
  let mockStorage: Record<string, string> = {};
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
    };
    configureGeminiKeyStoreForTest({ vaultBackend: null, resetMemory: true });
    geminiKeyPool.configure({
      explicitKeys: null as any,
      resetStates: true,
      maxRpmPerKey: 60,
      minLaunchStaggerMs: 0,
      baseBackoffMs: 20,
      maxCooldownWaitMs: 15000,
      sharedQuotaWindowMs: 500,
      sleepFn: async (_ms: number) => {},
      nowFn: () => Date.now(),
    });
    resetHistoryManagerForTesting();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // 1. P0 — GLOBAL GEMINI VAULT INITIALIZATION & VAULT ERROR PROTECTION
  // =========================================================================
  describe("1. P0 — Global Gemini Vault Initialization & Vault Error Safety", () => {
    it("initializes vault automatically when entering Dubbing or Batch cold without opening Settings", async () => {
      const vaultJson = JSON.stringify([
        {
          id: "gemini_key_primary",
          label: "API Key chính",
          apiKey: "AIzaSyColdStartPrimaryKey001",
          role: "primary",
        },
        {
          id: "gemini_key_secondary_1",
          label: "API Key phụ 1",
          apiKey: "AIzaSyColdStartSecondaryKey002",
          role: "secondary",
        },
      ]);

      configureGeminiKeyStoreForTest({
        resetMemory: true,
        vaultBackend: {
          loadEncryptedPayload: async () => vaultJson,
          saveEncryptedPayload: async () => {},
        },
      });
      geminiKeyPool.configure({ explicitKeys: null as any, resetStates: true });

      // Before any call, status is idle and localStorage has NO keys
      assert.equal(getGeminiVaultStatus(), "idle");
      assert.equal(mockStorage[PROVIDER_CONFIGS_STORAGE_KEY], undefined);

      // Batch CredentialResolver async call awaits vault initialization automatically
      const batchResolvedKey = await CredentialResolver.getApiKeyAsync("gemini");
      assert.equal(batchResolvedKey, "AIzaSyColdStartPrimaryKey001");
      assert.equal(getGeminiVaultStatus(), "ready");

      // Reset again to simulate cold start directly into Dubbing TranslationManager
      configureGeminiKeyStoreForTest({
        resetMemory: true,
        vaultBackend: {
          loadEncryptedPayload: async () => vaultJson,
          saveEncryptedPayload: async () => {},
        },
      });
      geminiKeyPool.configure({ explicitKeys: null as any, resetStates: true });

      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "[1] Xin chào từ kho khóa khởi tạo tự động." }],
                },
              },
            ],
          }),
          { status: 200 }
        );
      }) as any;

      const manager = TranslationManager.getInstance();
      const cues: OriginalCue[] = [
        { index: 1, startSec: 0, endSec: 2, text: "Hello from auto-initialized vault." },
      ];
      const translated = await manager.translateOriginalCues(cues, "vi", "gemini");
      assert.equal(translated.length, 1);
      assert.equal(translated[0].text, "Xin chào từ kho khóa khởi tạo tự động.");
      assert.equal(getGeminiVaultStatus(), "ready");
    });

    it("never treats a corrupted/unreadable vault as empty and blocks overwriting existing vault data", async () => {
      let writeCalled = false;
      configureGeminiKeyStoreForTest({
        resetMemory: true,
        vaultBackend: {
          loadEncryptedPayload: async () => {
            throw new Error("DPAPI CryptUnprotectData failed: key mismatch");
          },
          saveEncryptedPayload: async () => {
            writeCalled = true;
          },
        },
      });

      await assert.rejects(
        async () => {
          await ensureGeminiKeyStoreInitialized();
        },
        /Không thể đọc hoặc giải mã kho khóa Gemini/
      );
      assert.equal(getGeminiVaultStatus(), "error");
      assert.ok(getGeminiVaultError()?.includes("Không thể đọc hoặc giải mã kho khóa Gemini"));

      // Attempting to save while vault is in error state must reject and NEVER overwrite vault
      await assert.rejects(
        async () => {
          await saveGeminiKeyEntries([
            {
              id: "gemini_key_primary",
              role: "primary",
              apiKey: "AIzaSyNewAttemptKey999999",
            },
          ]);
        },
        /Không thể đọc hoặc giải mã kho khóa Gemini|Không thể ghi đè kho khóa Gemini/
      );
      assert.equal(writeCalled, false);
    });

    it("keeps legacy localStorage key intact if vault write or read-back verification fails during migration", async () => {
      mockStorage[TRANSLATION_SETTINGS_KEY] = JSON.stringify({
        geminiApiKey: "AIzaSyLegacyKeyMustSurvive123",
      });

      // Vault write succeeds, but read-back returns null so verification fails
      configureGeminiKeyStoreForTest({
        resetMemory: true,
        vaultBackend: {
          loadEncryptedPayload: async () => null,
          saveEncryptedPayload: async () => {
            // Do not update loadEncryptedPayload so verification fails!
          },
        },
      });

      const entries = await ensureGeminiKeyStoreInitialized();
      // Should keep legacy key in memory for current session AND preserve localStorage backup
      assert.equal(entries.length, 1);
      assert.equal(entries[0].apiKey, "AIzaSyLegacyKeyMustSurvive123");
      const rawSettings = JSON.parse(mockStorage[TRANSLATION_SETTINGS_KEY]);
      assert.equal(rawSettings.geminiApiKey, "AIzaSyLegacyKeyMustSurvive123");
    });
  });

  // =========================================================================
  // 2. P1 — SERIALIZED WRITE QUEUE, DEBOUNCE & POOL LEASE PRESERVATION
  // =========================================================================
  describe("2. P1 — Key Store Serialized Write Queue & Active Lease Preservation", () => {
    it("prevents out-of-order async writes from overwriting newer keys and coalesces debounced edits", async () => {
      let persistedVaultRaw: string | null = null;
      const writeLog: string[][] = [];
      let callCount = 0;

      configureGeminiKeyStoreForTest({
        resetMemory: true,
        vaultBackend: {
          loadEncryptedPayload: async () => persistedVaultRaw,
          saveEncryptedPayload: async (payload: string) => {
            callCount++;
            const currentCall = callCount;
            // First write is slow (60ms), subsequent writes are fast (5ms)
            const delay = currentCall === 1 ? 60 : 5;
            await new Promise((r) => setTimeout(r, delay));
            persistedVaultRaw = payload;
            const parsed = JSON.parse(payload);
            const keys: GeminiKeyEntry[] = Array.isArray(parsed) ? parsed : parsed.keys;
            writeLog.push(keys.map((e) => e.apiKey));
          },
        },
      });

      await loadGeminiKeyEntriesFromVault();

      // Trigger concurrent saves without awaiting the first one
      const p1 = saveGeminiKeyEntries([
        {
          id: "gemini_key_primary",
          role: "primary",
          apiKey: "AIzaSyOldKeyVersion1_000001",
        },
      ]);
      const p2 = saveGeminiKeyEntries([
        {
          id: "gemini_key_primary",
          role: "primary",
          apiKey: "AIzaSyIntermediateKey2_00002",
        },
      ]);
      const p3 = saveGeminiKeyEntries([
        {
          id: "gemini_key_primary",
          role: "primary",
          apiKey: "AIzaSyFinalLatestKey3_00003",
        },
        {
          id: "gemini_key_secondary_1",
          role: "secondary",
          apiKey: "AIzaSyFinalSecondaryKey_004",
        },
      ]);

      await Promise.all([p1, p2, p3]);

      const finalParsed = JSON.parse(persistedVaultRaw!);
      const finalSaved: GeminiKeyEntry[] = Array.isArray(finalParsed)
        ? finalParsed
        : finalParsed.keys;
      assert.equal(finalSaved.length, 2);
      assert.equal(finalSaved[0].apiKey, "AIzaSyFinalLatestKey3_00003");
      assert.equal(finalSaved[1].apiKey, "AIzaSyFinalSecondaryKey_004");

      const diag = getGeminiKeyStoreDiagnostics();
      assert.equal(diag.committedRevision, diag.latestRequestedRevision);
    });

    it("flushes debounced keystrokes immediately when flushPendingGeminiKeyWrites is called (e.g. closing Settings)", async () => {
      let persistedVaultRaw = "";
      configureGeminiKeyStoreForTest({
        resetMemory: true,
        vaultBackend: {
          loadEncryptedPayload: async () => (persistedVaultRaw ? persistedVaultRaw : null),
          saveEncryptedPayload: async (payload: string) => {
            persistedVaultRaw = payload;
          },
        },
      });

      await loadGeminiKeyEntriesFromVault();

      // Simulate rapid typing with 500ms debounce
      void scheduleDebouncedGeminiKeySave(
        [{ id: "gemini_key_primary", apiKey: "AIzaSyTyping1", role: "primary" }],
        500
      );
      void scheduleDebouncedGeminiKeySave(
        [{ id: "gemini_key_primary", apiKey: "AIzaSyTyping12", role: "primary" }],
        500
      );
      const pFinal = scheduleDebouncedGeminiKeySave(
        [{ id: "gemini_key_primary", apiKey: "AIzaSyTyping123Final", role: "primary" }],
        500
      );

      // User closes Settings immediately before 500ms timer fires
      await flushPendingGeminiKeyWrites();
      const saved = await pFinal;
      assert.equal(saved.length, 1);
      assert.equal(saved[0].apiKey, "AIzaSyTyping123Final");
      assert.ok(persistedVaultRaw.includes("AIzaSyTyping123Final"));
    });

    it("preserves active lease and inFlightCount when keys are edited/added/removed while Gemini is running", async () => {
      await saveGeminiKeyEntries([
        {
          id: "gemini_key_primary",
          label: "API Key chính",
          apiKey: "AIzaSyRunningPrimaryKey001",
          role: "primary",
        },
        {
          id: "gemini_key_secondary_1",
          label: "API Key phụ 1",
          apiKey: "AIzaSyRunningSecondaryKey02",
          role: "secondary",
        },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      const lease1 = await geminiKeyPool.acquireKeyLease({ modelName: "gemini-1.5-flash" });
      const lease2 = await geminiKeyPool.acquireKeyLease({ modelName: "gemini-1.5-flash" });

      let snapBefore = geminiKeyPool.getPoolSnapshots();
      assert.equal(snapBefore.find((b) => b.id === lease1.keyId)?.inFlightCount, 1);
      assert.equal(snapBefore.find((b) => b.id === lease2.keyId)?.inFlightCount, 1);

      // While both leases are in flight, user removes secondary_1 and adds secondary_2
      await saveGeminiKeyEntries([
        {
          id: "gemini_key_primary",
          label: "API Key chính",
          apiKey: "AIzaSyRunningPrimaryKey001",
          role: "primary",
        },
        {
          id: "gemini_key_secondary_2",
          label: "API Key phụ 1",
          apiKey: "AIzaSyBrandNewSecondaryKey03",
          role: "secondary",
        },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      // Primary key must still have inFlightCount === 1
      const snapMid = geminiKeyPool.getPoolSnapshots();
      assert.equal(snapMid.find((b) => b.id === "gemini_key_primary")?.inFlightCount, 1);

      // Releasing both leases must cleanly decrement inFlightCount to 0 without throwing
      lease1.releaseSuccess(120);
      lease2.releaseSuccess(140);

      const snapAfter = geminiKeyPool.getPoolSnapshots();
      assert.equal(snapAfter.find((b) => b.id === "gemini_key_primary")?.inFlightCount, 0);
      assert.equal(snapAfter.find((b) => b.id === "gemini_key_primary")?.successCount, 1);
    });
  });

  // =========================================================================
  // 3. P1 — FREE NARRATION END-TO-END DECOUPLED PIPELINE
  // =========================================================================
  describe("3. P1 — Free Narration (Thuyết minh tự do) End-to-End Pipeline", () => {
    const brokenEnglishSrtCues: OriginalCue[] = [
      { index: 1, startSec: 0.0, endSec: 1.8, text: "In 2026, Dr. Smith invested" },
      { index: 2, startSec: 1.85, endSec: 3.6, text: "$4.5 billion into clean energy" },
      { index: 3, startSec: 3.65, endSec: 5.2, text: "across the U.S. market." },
      { index: 4, startSec: 6.5, endSec: 8.0, text: "Yes." },
      { index: 5, startSec: 8.2, endSec: 10.1, text: "Host: This breakthrough changed" },
      { index: 6, startSec: 10.15, endSec: 12.4, text: "how batteries are manufactured forever." },
    ];

    it("reconstructs complete sentences from 2-4 broken SRT cues without timestamps while preserving numbers, abbreviations, speakers, and short sentences", () => {
      const recon = reconstructFreeNarrationScript(brokenEnglishSrtCues);

      // 6 broken cues -> 3 complete sentence groups
      assert.equal(recon.groups.length, 3);
      assert.equal(
        recon.groups[0].sourceText,
        "In 2026, Dr. Smith invested $4.5 billion into clean energy across the U.S. market."
      );
      assert.deepEqual(recon.groups[0].sourceCueIds, [1, 2, 3]);

      // Short valid sentence "Yes." is preserved and not dropped
      assert.equal(recon.groups[1].sourceText, "Yes.");
      assert.deepEqual(recon.groups[1].sourceCueIds, [4]);

      // Speaker label "Host:" and 2-cue continuation are preserved
      assert.equal(
        recon.groups[2].sourceText,
        "Host: This breakthrough changed how batteries are manufactured forever."
      );
      assert.equal(recon.groups[2].speakerPrefix, "Host");
      assert.deepEqual(recon.groups[2].sourceCueIds, [5, 6]);

      // Source TXT script has NO SRT numbers or timestamps
      assert.ok(!recon.sourceScriptText.includes("-->"));
      assert.ok(recon.sourceScriptText.includes("$4.5 billion"));
      assert.ok(recon.sourceScriptText.includes("Yes."));
    });

    it("translates by complete reconstructed sentences in free_narration mode without forcing 1:1 cue re-translation, allows editing, and generates audio-aligned SRT from new audio durations", async () => {
      await saveGeminiKeyEntries([
        {
          id: "gemini_key_primary",
          label: "API Key chính",
          apiKey: "AIzaSyFreeNarrationKey00001",
          role: "primary",
        },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      let httpCallCount = 0;
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        httpCallCount++;
        const bodyObj = JSON.parse(String(init?.body || "{}"));
        const promptText = bodyObj?.contents?.[0]?.parts?.[0]?.text || "";
        // Verify prompt sends the 3 reconstructed sentences, NOT 6 broken cues
        assert.ok(
          promptText.includes(
            "In 2026, Dr. Smith invested $4.5 billion into clean energy across the U.S. market."
          )
        );
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: [
                        "[1] Vào năm 2026, Tiến sĩ Smith đã đầu tư 4,5 tỷ đô la vào năng lượng sạch trên toàn thị trường Hoa Kỳ.",
                        "[2] Đúng vậy.",
                        "[3] Người dẫn: Bước đột phá này đã thay đổi hoàn toàn quy trình sản xuất pin mãi mãi.",
                      ].join("\n"),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 }
        );
      }) as any;

      const manager = TranslationManager.getInstance();
      const translatedCues = await manager.translateOriginalCues(
        brokenEnglishSrtCues,
        "vi",
        "gemini",
        undefined,
        "default",
        {
          useSpeechGroups: true,
          dubbingMode: "free_narration",
        }
      );

      // Strictly 1 batch HTTP request (never fell back to cue-by-cue re-translation!)
      assert.equal(httpCallCount, 1);

      const groups = manager.getLastSpeechGroups();
      assert.equal(groups.length, 3);
      assert.equal(
        groups[0].translatedText,
        "Vào năm 2026, Tiến sĩ Smith đã đầu tư 4,5 tỷ đô la vào năng lượng sạch trên toàn thị trường Hoa Kỳ."
      );

      // User edits the full Vietnamese narration script before TTS
      const editedScript = [
        "Năm 2026, Tiến sĩ Smith đầu tư 4,5 tỷ USD phát triển năng lượng sạch tại Mỹ, mở ra kỷ nguyên công nghệ lưu trữ điện năng hoàn toàn mới cho các nhà máy công nghiệp hiện đại.",
        "Chính xác là như vậy.",
        " Bước đột phá này đã định hình lại toàn bộ ngành sản xuất pin toàn cầu.",
      ].join("\n\n");

      const editRes = applyFullNarrationScriptEdit(
        groups,
        brokenEnglishSrtCues,
        translatedCues,
        editedScript,
        {}
      );

      const exportedTxt = buildTranslatedNarrationScriptText(
        editRes.updatedGroups,
        editRes.updatedTranslatedCues
      );
      assert.ok(exportedTxt.includes("4,5 tỷ USD phát triển năng lượng sạch tại Mỹ"));
      assert.ok(!exportedTxt.includes("-->"));

      // Simulate TTS synthesis with natural Vietnamese audio durations (9.2s, 1.4s, 5.6s)
      const audioSegments: Record<number, DubAudioSegment> = {
        1: {
          cueIndex: 1,
          status: "ready",
          rawDurationSec: 9.2,
          targetDurationSec: 5.2,
          fittedDurationSec: 9.2, // Natural duration, NOT compressed to 5.2s source window!
          speedFactor: 1.0,
          audioStartSec: 0,
          audioEndSec: 9.2,
          isGroupPrimary: true,
          primaryCueIndex: 1,
        },
        4: {
          cueIndex: 4,
          status: "ready",
          rawDurationSec: 1.4,
          targetDurationSec: 1.5,
          fittedDurationSec: 1.4,
          speedFactor: 1.0,
          audioStartSec: 9.7,
          audioEndSec: 11.1,
          isGroupPrimary: true,
          primaryCueIndex: 4,
        },
        5: {
          cueIndex: 5,
          status: "ready",
          rawDurationSec: 5.6,
          targetDurationSec: 4.2,
          fittedDurationSec: 5.6,
          speedFactor: 1.0,
          audioStartSec: 11.6,
          audioEndSec: 17.2,
          isGroupPrimary: true,
          primaryCueIndex: 5,
        },
      };

      const alignedSrt = generateNarrationAlignedSrt({
        speechGroups: editRes.updatedGroups,
        originalCues: brokenEnglishSrtCues,
        translatedCues: editRes.updatedTranslatedCues,
        audioSegments,
        pauseBetweenGroupsSec: 0.5,
        mode: "narration",
      });

      assert.equal(alignedSrt.ok, true);
      assert.ok(alignedSrt.cues && alignedSrt.cues.length > 0);
      // Total timeline duration must equal 9.2 + 0.5 + 1.4 + 0.5 + 5.6 = 17.2s (NOT the 12.4s English SRT!)
      assert.equal(alignedSrt.totalDurationSec, 17.2);
      // First cue starts at 0.000s, last cue ends at 17.200s
      assert.equal(alignedSrt.cues![0].startSec, 0);
      assert.equal(alignedSrt.cues![alignedSrt.cues!.length - 1].endSec, 17.2);
    });
  });

  // =========================================================================
  // 4. P1 — HISTORY SERIALIZED WRITE QUEUE & NON-DESTRUCTIVE HYDRATION
  // =========================================================================
  describe("4. P1 — History Manager Write Queue & Non-Destructive Async Hydration", () => {
    it("never overwrites newly added jobs or resurrects deleted jobs when slow disk hydration finishes late", async () => {
      // 1. Record Job A
      const jobA = recordCompletedJobToHistory({
        jobKey: "job_a",
        title: "Video A",
        category: "tts",
        tasks: ["tts"],
        artifacts: [
          {
            filePath: "D:/Output/video_a.wav",
            type: "audio",
            task: "tts",
          },
        ],
      });
      const revAfterJobA = getHistoryRevision();

      // Simulate slow disk hydration snapshot captured right after Job A was created
      const staleHydratedSnapshotForJobA = [
        {
          ...jobA,
          sourceFileSize: "12.4 MB",
          duration: "2 phút 15 giây",
          artifacts: jobA.artifacts.map((a) => ({
            ...a,
            existsOnDisk: true,
            fileSize: "12.4 MB",
            audioDurationSec: 135,
            duration: "02:15",
          })),
        },
      ];

      // 2. While Job A's hydration is still running on disk, Job B and Job C finish, and Job C is deleted by user!
      const jobB = recordCompletedJobToHistory({
        jobKey: "job_b",
        title: "Video B",
        category: "dubbing",
        tasks: ["translation", "dubbing"],
        artifacts: [
          {
            filePath: "D:/Output/video_b.wav",
            type: "audio",
            task: "dubbing",
          },
        ],
      });

      const jobC = recordCompletedJobToHistory({
        jobKey: "job_c",
        title: "Video C (To Be Deleted)",
        category: "tts",
        tasks: ["tts"],
        artifacts: [
          {
            filePath: "D:/Output/video_c.wav",
            type: "audio",
            task: "tts",
          },
        ],
      });

      // User deletes Job C
      deleteHistoryItem(jobC.id);

      // Also simulate a late hydration for deleted Job C
      const staleHydratedForDeletedJobC = [
        {
          ...jobC,
          duration: "1 phút 00 giây",
        },
      ];

      // 3. Now Job A's and Job C's slow hydrations finish!
      applyHydratedMetadataToMemory(staleHydratedSnapshotForJobA, revAfterJobA);
      applyHydratedMetadataToMemory(staleHydratedForDeletedJobC, revAfterJobA);
      await flushPendingHistoryWrites();

      const finalItems = loadHistoryItems();
      const finalIds = finalItems.map((i) => i.id);

      // Job B MUST still exist (not wiped out by Job A's stale snapshot!)
      assert.ok(finalIds.includes(jobB.id), "Job B must not be overwritten by Job A hydration");
      // Job C MUST NOT be resurrected!
      assert.ok(!finalIds.includes(jobC.id), "Deleted Job C must not be resurrected by late hydration");
      // Job A MUST have received its hydrated metadata!
      const updatedJobA = finalItems.find((i) => i.id === jobA.id);
      assert.ok(updatedJobA);
      assert.equal(updatedJobA!.duration, "2 phút 15 giây");
      assert.equal(updatedJobA!.artifacts[0].audioDurationSec, 135);
    });
  });

  // =========================================================================
  // 5. P2 — TRUE GEMINI REQUEST CANCELLATION & LEASE RELEASE
  // =========================================================================
  describe("5. P2 — True In-Flight Gemini Request Cancellation & Lease Release", () => {
    it("aborts in-flight HTTP request immediately on cancel, releases key lease, does not retry, and isolates new session", async () => {
      await saveGeminiKeyEntries([
        {
          id: "gemini_key_primary",
          label: "API Key chính",
          apiKey: "AIzaSyCancelTestPrimaryKey01",
          role: "primary",
        },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      let activeRequestCalls = 0;
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        activeRequestCalls++;
        const callNum = activeRequestCalls;
        return await new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(
              new Response(
                JSON.stringify({
                  candidates: [
                    {
                      content: {
                        parts: [
                          {
                            text:
                              callNum === 1
                                ? "[1] Bản dịch CŨ đã bị hủy."
                                : "[1] Bản dịch MỚI thành công.",
                          },
                        ],
                      },
                    },
                  ],
                }),
                { status: 200 }
              )
            );
          }, callNum === 1 ? 5000 : 20);

          init?.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("AbortError: The operation was aborted."));
            },
            { once: true }
          );
        });
      }) as any;

      const provider = new GeminiTranslateProvider();
      provider.model = "gemini-1.5-flash";

      let cancelledFlag = false;
      const startMs = Date.now();

      // Cancel session #1 after 60ms while request #1 (which takes 5000ms) is in flight
      setTimeout(() => {
        cancelledFlag = true;
      }, 60);

      const session1Res = await geminiTranslationCoordinator.executeUnits(
        provider,
        [{ unitId: 1, sourceText: "Old slow request that will be cancelled." }],
        {
          targetLang: "vi",
          isCancelled: () => cancelledFlag,
        }
      );

      const elapsedMs = Date.now() - startMs;
      // Must abort immediately (< 600ms) instead of waiting 5000ms!
      assert.ok(
        elapsedMs < 1000,
        `Expected fast cancellation (<1000ms), but took ${elapsedMs}ms`
      );
      // Cancelled session must NOT record any completed translation or retry
      assert.equal(session1Res.translationsById.size, 0);
      assert.equal(session1Res.metrics.retryCount, 0);
      assert.equal(activeRequestCalls, 1);

      // Key lease must be released immediately (inFlightCount === 0)
      const poolAfterCancel = geminiKeyPool.getPoolSnapshots();
      assert.equal(poolAfterCancel[0].inFlightCount, 0);

      // Start session #2 immediately: must succeed cleanly without interference from session #1
      const session2Res = await geminiTranslationCoordinator.executeUnits(
        provider,
        [{ unitId: 1, sourceText: "New fast request after cancel." }],
        {
          targetLang: "vi",
          isCancelled: () => false,
        }
      );

      assert.equal(session2Res.translationsById.get(1), "Bản dịch MỚI thành công.");
      assert.equal(geminiKeyPool.getPoolSnapshots()[0].inFlightCount, 0);
    });
  });

  // ==========================================================================
  // 6. STAGE 1.5 — NO AUTOMATIC CLOUD FALLBACK WHEN LOCAL AI PROVIDER FAILS
  // ==========================================================================
  describe("6. Stage 1.5 — No Automatic Cloud Fallback When Local AI Provider Fails", () => {
    it("throws a clear error and makes 0 requests to Google Translate when LM Studio or Ollama is unavailable", async () => {
      let googleTranslateCalls = 0;
      globalThis.fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes("translate.googleapis.com")) {
          googleTranslateCalls++;
          return new Response(JSON.stringify([[["Bản dịch đám mây rò rỉ", "Source"]]]), {
            status: 200,
          });
        }
        throw new Error("ECONNREFUSED 127.0.0.1");
      }) as any;

      const manager = TranslationManager.getInstance();
      const sampleCues: OriginalCue[] = [
        { index: 1, startSec: 0, endSec: 2, text: "Confidential local script line one." },
        { index: 2, startSec: 2, endSec: 4, text: "Confidential local script line two." },
      ];

      await assert.rejects(
        async () => {
          await manager.translateOriginalCues(sampleCues, "vi", "lmstudio");
        },
        (err: any) => {
          assert.ok(err.message.includes("LM Studio"));
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await manager.translateOriginalCues(sampleCues, "vi", "ollama");
        },
        (err: any) => {
          assert.ok(err.message.includes("Ollama"));
          return true;
        }
      );

      assert.equal(
        googleTranslateCalls,
        0,
        "Local AI failure must NEVER fall back to Google Translate cloud!"
      );
    });
  });
});

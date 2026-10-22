import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadGeminiKeyEntriesFromVault,
  saveGeminiKeyEntries,
  getGeminiKeyEntriesSync,
  getActiveGeminiKeyEntriesSync,
  getPrimaryGeminiApiKeySync,
  normalizeGeminiKeyEntries,
  maskGeminiApiKey,
  redactGeminiKeysFromText,
  configureGeminiKeyStoreForTest,
  geminiKeyPool,
  extractGeminiRetryDelayMs,
  computeBackoffWithJitterMs,
  classifyGeminiError,
  geminiTranslationCoordinator,
  GeminiCoordinationError,
  GeminiTranslateProvider,
  TranslationManager,
  PROVIDER_CONFIGS_STORAGE_KEY,
  TRANSLATION_SETTINGS_KEY,
} from "../index";
import {
  estimateTokenCount,
  extractScriptGlossaryAndEntities,
  chunkItemsTokenAware,
} from "../batchTranslationHelper";
import { CredentialResolver } from "../../batch/credentialResolver";
import { OriginalCue } from "../../../types/dubbing";

describe("Google Gemini API Key Pool, Secure Storage & Concurrent Translation Suite", () => {
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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // 1. SECURE STORAGE, MIGRATION, DEDUPLICATION & WRITE-FAILURE SAFETY
  // =========================================================================
  describe("1. Secure Vault Migration, Deduplication & Failure Safety", () => {
    it("migrates legacy single Gemini key from localStorage to primary slot and scrubs plaintext only after vault write succeeds", async () => {
      mockStorage[PROVIDER_CONFIGS_STORAGE_KEY] = JSON.stringify({
        gemini: {
          apiKey: "AIzaSyLegacyPrimaryKey123456",
          model: "gemini-1.5-flash",
          timeout: 45,
          maxTokens: 4096,
        },
        deepseek: {
          apiKey: "sk-deepseek-untouched",
          model: "deepseek-chat",
        },
      });
      mockStorage[TRANSLATION_SETTINGS_KEY] = JSON.stringify({
        targetLanguage: "vi",
        geminiApiKey: "AIzaSyLegacyPrimaryKey123456",
        deepseekApiKey: "sk-deepseek-untouched",
      });

      const entries = await loadGeminiKeyEntriesFromVault();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].role, "primary");
      assert.equal(entries[0].label, "API Key chính");
      assert.equal(entries[0].apiKey, "AIzaSyLegacyPrimaryKey123456");

      // Verify localStorage no longer contains raw Gemini key
      const afterProviderCfg = JSON.parse(mockStorage[PROVIDER_CONFIGS_STORAGE_KEY]);
      assert.equal(afterProviderCfg.gemini.apiKey, undefined);
      assert.equal(afterProviderCfg.gemini.model, "gemini-1.5-flash");
      assert.equal(afterProviderCfg.deepseek.apiKey, "sk-deepseek-untouched");

      const afterTransCfg = JSON.parse(mockStorage[TRANSLATION_SETTINGS_KEY]);
      assert.equal(afterTransCfg.geminiApiKey, undefined);
      assert.equal(afterTransCfg.deepseekApiKey, "sk-deepseek-untouched");

      // Primary key remains accessible in memory for backward-compatible callers
      assert.equal(getPrimaryGeminiApiKeySync(), "AIzaSyLegacyPrimaryKey123456");
    });

    it("supports adding secondary keys, deleting secondary keys without touching primary, rejecting duplicates, and ignoring empty keys", async () => {
      const saved = await saveGeminiKeyEntries([
        { role: "primary", apiKey: "AIzaSyPrimaryKey000001" },
        { role: "secondary", apiKey: "AIzaSySecondaryKey0002" },
        { role: "secondary", apiKey: "   " }, // empty should be ignored in active list
        { role: "secondary", apiKey: "AIzaSySecondaryKey0003" },
      ]);

      assert.equal(saved.length, 3);
      assert.equal(saved[0].label, "API Key chính");
      assert.equal(saved[1].label, "API Key phụ 1");
      assert.equal(saved[2].label, "API Key phụ 2");

      const active = getActiveGeminiKeyEntriesSync();
      assert.equal(active.length, 3);

      // Deleting secondary key 1 re-indexes remaining secondary key cleanly and keeps primary intact
      const afterDelete = await saveGeminiKeyEntries([
        saved[0],
        saved[2],
      ]);
      assert.equal(afterDelete.length, 2);
      assert.equal(afterDelete[0].role, "primary");
      assert.equal(afterDelete[0].apiKey, "AIzaSyPrimaryKey000001");
      assert.equal(afterDelete[1].label, "API Key phụ 1");
      assert.equal(afterDelete[1].apiKey, "AIzaSySecondaryKey0003");

      // Rejects duplicate keys on save
      await assert.rejects(
        async () => {
          await saveGeminiKeyEntries([
            { role: "primary", apiKey: "AIzaSyPrimaryKey000001" },
            { role: "secondary", apiKey: "AIzaSyPrimaryKey000001" },
          ]);
        },
        /Không chấp nhận API Key trùng nhau/
      );

      // Normalization detects duplicate indices for UI inline warning
      const norm = normalizeGeminiKeyEntries(
        [
          { role: "primary", apiKey: "AIzaSyKeyA12345678" },
          { role: "secondary", apiKey: "AIzaSyKeyA12345678" },
        ],
        { keepEmptyForUi: true }
      );
      assert.deepEqual(norm.duplicateIndices, [1]);
    });

    it("preserves existing saved keys and never falls back to localStorage if encrypted vault write fails", async () => {
      const vault = configureGeminiKeyStoreForTest({ resetMemory: true });
      await saveGeminiKeyEntries([
        { role: "primary", apiKey: "AIzaSyExistingSafeKey01" },
        { role: "secondary", apiKey: "AIzaSyExistingSafeKey02" },
      ]);

      // Simulate OS DPAPI / disk write failure
      vault.simulateWriteError = new Error("DPAPI disk write error");

      await assert.rejects(
        async () => {
          await saveGeminiKeyEntries([
            { role: "primary", apiKey: "AIzaSyNewUnsavedKey99" },
          ]);
        },
        /DPAPI disk write error/
      );

      // Existing keys must NOT be lost or overwritten
      const currentEntries = getGeminiKeyEntriesSync();
      assert.equal(currentEntries.length, 2);
      assert.equal(currentEntries[0].apiKey, "AIzaSyExistingSafeKey01");
      assert.equal(currentEntries[1].apiKey, "AIzaSyExistingSafeKey02");

      // Must NEVER write plaintext fallback to localStorage
      assert.equal(mockStorage[PROVIDER_CONFIGS_STORAGE_KEY], undefined);
      assert.equal(mockStorage[TRANSLATION_SETTINGS_KEY], undefined);
    });

    it("masks and redacts raw Gemini API keys from logs and error messages", () => {
      const rawKey1 = "AIzaSySecretKeyNumberOne998877";
      const rawKey2 = "CustomSecretGeminiToken123456";

      assert.equal(maskGeminiApiKey(rawKey1), "AIza...8877");
      const dirtyLog = `Request failed for key=${rawKey1} and token=${rawKey2} with HTTP 429`;
      const sanitized = redactGeminiKeysFromText(dirtyLog, [rawKey1, rawKey2]);

      assert.equal(sanitized.includes(rawKey1), false);
      assert.equal(sanitized.includes(rawKey2), false);
      assert.equal(sanitized.includes("AIza...8877"), true);
      assert.equal(sanitized.includes("Cust...3456"), true);
    });
  });

  // =========================================================================
  // 2. CONNECTION TESTING PER KEY & STATUS RESET ON EDIT
  // =========================================================================
  describe("2. Per-Key Connection Test & Status Management", () => {
    it("tests each configured Gemini key individually and produces accurate summary (valid, rate_limited, invalid)", async () => {
      await saveGeminiKeyEntries([
        { id: "k_primary", role: "primary", apiKey: "AIzaSyValidKey0000001" },
        { id: "k_sub1", role: "secondary", apiKey: "AIzaSyRateLimitedKey2" },
        { id: "k_sub2", role: "secondary", apiKey: "AIzaSyInvalidKey00003" },
      ]);

      globalThis.fetch = (async (_url: any, init?: any) => {
        const apiKeyHeader = init?.headers?.["x-goog-api-key"] || "";
        if (apiKeyHeader === "AIzaSyValidKey0000001") {
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "OK" }] } }],
            }),
            { status: 200 }
          );
        }
        if (apiKeyHeader === "AIzaSyRateLimitedKey2") {
          return new Response(
            JSON.stringify({
              error: { code: 429, message: "Resource has been exhausted (e.g. check quota)." },
            }),
            { status: 429, headers: { "Retry-After": "12" } }
          );
        }
        return new Response(
          JSON.stringify({
            error: { code: 403, message: "API key not valid. Please pass a valid API key." },
          }),
          { status: 403 }
        );
      }) as any;

      const summary = await geminiKeyPool.testAllConfiguredKeys({
        modelName: "gemini-1.5-flash",
      });

      assert.equal(summary.totalConfigured, 3);
      assert.equal(summary.validCount, 1);
      assert.equal(summary.rateLimitedCount, 1);
      assert.equal(summary.invalidCount, 1);
      assert.equal(summary.results[0].status, "valid");
      assert.equal(summary.results[1].status, "rate_limited");
      assert.equal(summary.results[2].status, "invalid");
      assert.ok(summary.summaryText.includes("3 API Key"));
      assert.ok(summary.summaryText.includes("1 hợp lệ"));

      // Editing a key resets its runtime status back to "untested" without auto-testing
      await saveGeminiKeyEntries([
        { id: "k_primary", role: "primary", apiKey: "AIzaSyValidKey0000001" },
        { id: "k_sub1", role: "secondary", apiKey: "AIzaSyRateLimitedKey2" },
        { id: "k_sub2", role: "secondary", apiKey: "AIzaSyReplacedNewKey04" },
      ]);
      const states = geminiKeyPool.getPoolStatesSnapshot();
      assert.equal(states[0].status, "valid"); // Unchanged key preserves status
      assert.equal(states[2].status, "untested"); // Edited key resets to untested
    });
  });

  // =========================================================================
  // 3. KEY POOL SCHEDULER: LEAST-IN-FLIGHT, 429 RETRY-AFTER, 401/403, SHARED QUOTA
  // =========================================================================
  describe("3. GeminiKeyPool Scheduler & Rate-Limit Resilience", () => {
    it("distributes concurrent leases via least-in-flight + round-robin and tracks inFlightCount accurately", async () => {
      await saveGeminiKeyEntries([
        { id: "k1", role: "primary", apiKey: "AIzaSyPoolKeyOne000001" },
        { id: "k2", role: "secondary", apiKey: "AIzaSyPoolKeyTwo000002" },
        { id: "k3", role: "secondary", apiKey: "AIzaSyPoolKeyThree0003" },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      // Acquire two leases concurrently
      const [lease1, lease2] = await Promise.all([
        geminiKeyPool.acquireKeyLease({ modelName: "gemini-1.5-flash" }),
        geminiKeyPool.acquireKeyLease({ modelName: "gemini-1.5-flash" }),
      ]);

      assert.notEqual(lease1.keyId, lease2.keyId, "Concurrent workers must receive distinct keys");
      const snapMid = geminiKeyPool.getPoolStatesSnapshot();
      const totalInFlight = snapMid.reduce((sum, s) => sum + s.inFlightCount, 0);
      assert.equal(totalInFlight, 2);

      // Third lease must pick the 3rd idle key (inFlight = 0)
      const lease3 = await geminiKeyPool.acquireKeyLease({ modelName: "gemini-1.5-flash" });
      assert.notEqual(lease3.keyId, lease1.keyId);
      assert.notEqual(lease3.keyId, lease2.keyId);

      lease1.releaseSuccess(50);
      lease2.releaseSuccess(60);
      lease3.releaseSuccess(40);

      const snapAfter = geminiKeyPool.getPoolStatesSnapshot();
      assert.equal(snapAfter.reduce((sum, s) => sum + s.inFlightCount, 0), 0);
      assert.equal(snapAfter.every((s) => s.successCount === 1), true);
    });

    it("parses Retry-After & Google retryDelay accurately and rotates away from 429 key", async () => {
      assert.equal(extractGeminiRetryDelayMs("15", undefined), 15000);
      assert.equal(
        extractGeminiRetryDelayMs(undefined, '{"error":{"details":[{"retryDelay":"8.5s"}]}}'),
        8500
      );

      const backoff1 = computeBackoffWithJitterMs(1, 4000, 45000);
      const backoff2 = computeBackoffWithJitterMs(3, 4000, 45000);
      assert.ok(backoff2 > backoff1, "Exponential backoff must increase with consecutive 429s");

      let fakeNow = 1_000_000;
      const sleptDurations: number[] = [];
      geminiKeyPool.configure({
        nowFn: () => fakeNow,
        sleepFn: async (ms: number) => {
          sleptDurations.push(ms);
          fakeNow += ms;
        },
        resetStates: true,
      });

      await saveGeminiKeyEntries([
        { id: "k1", role: "primary", apiKey: "AIzaSyRotateKeyOne0001" },
        { id: "k2", role: "secondary", apiKey: "AIzaSyRotateKeyTwo0002" },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      const lease1 = await geminiKeyPool.acquireKeyLease({ modelName: "gemini-1.5-flash" });
      assert.equal(lease1.keyId, "k1");

      // Simulate 429 with Retry-After: 10s on k1
      const classified429 = classifyGeminiError({
        httpStatus: 429,
        retryAfterHeader: "10",
        bodyText: "Resource exhausted",
        consecutiveRateLimits: 1,
        baseBackoffMs: 4000,
        knownKeys: ["AIzaSyRotateKeyOne0001", "AIzaSyRotateKeyTwo0002"],
      });
      lease1.releaseFailure(classified429, 30);

      // Next lease request should immediately rotate to k2 without waiting 10s!
      const lease2 = await geminiKeyPool.acquireKeyLease({ modelName: "gemini-1.5-flash" });
      assert.equal(lease2.keyId, "k2");
      assert.equal(sleptDurations.length, 0, "Should not sleep when another healthy key is available");
      lease2.releaseSuccess(25);
    });

    it("detects shared Google Cloud Project quota when multiple keys hit 429 simultaneously and pauses the group", async () => {
      let fakeNow = 2_000_000;
      const sleptDurations: number[] = [];
      geminiKeyPool.configure({
        nowFn: () => fakeNow,
        sleepFn: async (ms: number) => {
          sleptDurations.push(ms);
          fakeNow += ms;
        },
        sharedQuotaWindowMs: 5000,
        maxCooldownWaitMs: 30000,
        resetStates: true,
      });

      await saveGeminiKeyEntries([
        { id: "k1", role: "primary", apiKey: "AIzaSySharedProjKey001" },
        { id: "k2", role: "secondary", apiKey: "AIzaSySharedProjKey002" },
        { id: "k3", role: "secondary", apiKey: "AIzaSySharedProjKey003" },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      const l1 = await geminiKeyPool.acquireKeyLease({ modelName: "gemini-1.5-flash" });
      const l2 = await geminiKeyPool.acquireKeyLease({ modelName: "gemini-1.5-flash" });

      const err429 = classifyGeminiError({
        httpStatus: 429,
        retryAfterHeader: "6",
        bodyText: "Quota exceeded for quota metric",
        consecutiveRateLimits: 1,
      });
      l1.releaseFailure(err429, 20);
      l2.releaseFailure(err429, 20);

      // Even though k3 wasn't tried yet, 2 keys hit 429 in the same window -> shared project cooldown active!
      const l3 = await geminiKeyPool.acquireKeyLease({ modelName: "gemini-1.5-flash" });
      const totalSleptMs = sleptDurations.reduce((a, b) => a + b, 0);
      assert.ok(
        totalSleptMs >= 6000,
        "Pool must pause when shared project quota is hit across multiple keys"
      );
      l3.releaseSuccess(20);
    });

    it("permanently disables 401/403 invalid keys for the session and never retries them", async () => {
      await saveGeminiKeyEntries([
        { id: "k_bad", role: "primary", apiKey: "AIzaSyBadAuthKey000001" },
        { id: "k_good", role: "secondary", apiKey: "AIzaSyGoodAuthKey00002" },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      const l1 = await geminiKeyPool.acquireKeyLease({ modelName: "gemini-1.5-flash" });
      assert.equal(l1.keyId, "k_bad");

      const err401 = classifyGeminiError({
        httpStatus: 401,
        bodyText: "API key not valid",
        consecutiveRateLimits: 0,
      });
      assert.equal(err401.permanentlyDisableKey, true);
      l1.releaseFailure(err401, 15);

      // Subsequent leases must only select k_good
      for (let i = 0; i < 4; i++) {
        const lease = await geminiKeyPool.acquireKeyLease({ modelName: "gemini-1.5-flash" });
        assert.equal(lease.keyId, "k_good");
        lease.releaseSuccess(10);
      }
    });
  });

  // =========================================================================
  // 4. CONCURRENT COORDINATOR: OUT-OF-ORDER ID REASSEMBLY, GRANULAR RETRY & CANCEL
  // =========================================================================
  describe("4. GeminiTranslationCoordinator: Out-of-Order Reassembly, Granular Retry & Cancellation", () => {
    it("reassembles out-of-order concurrent batches deterministically by ID and injects shared glossary & context", async () => {
      await saveGeminiKeyEntries([
        { id: "k1", role: "primary", apiKey: "AIzaSyCoordKey00000001" },
        { id: "k2", role: "secondary", apiKey: "AIzaSyCoordKey00000002" },
        { id: "k3", role: "secondary", apiKey: "AIzaSyCoordKey00000003" },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      const capturedPrompts: string[] = [];

      // Simulate batch 2 finishing faster than batch 0
      globalThis.fetch = (async (_url: any, init?: any) => {
        const body = JSON.parse(init.body);
        const promptText: string = body.contents[0].parts[0].text;
        capturedPrompts.push(promptText);

        // Extract requested [id] lines from prompt
        const idMatches = [...promptText.matchAll(/^\[(\d+)\]\s+/gm)].map((m) => Number(m[1]));
        const isFirstBatch = idMatches.includes(1);
        if (isFirstBatch) {
          await new Promise((r) => setTimeout(r, 35)); // Slow batch 0
        } else {
          await new Promise((r) => setTimeout(r, 5)); // Fast batch 1+
        }

        const outLines = idMatches
          .map((id) => `[${id}] Bản dịch chuẩn của nhóm #${id}`)
          .join("\n");

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: outLines }],
                },
              },
            ],
          }),
          { status: 200 }
        );
      }) as any;

      const units = Array.from({ length: 12 }, (_, idx) => ({
        unitId: idx + 1,
        sourceText: `Porsche 911 GT3 RS sentence number ${idx + 1} with twin-axle suspension.`,
      }));

      const provider = new GeminiTranslateProvider(undefined, "gemini-1.5-flash", 30, 4096);
      const result = await geminiTranslationCoordinator.executeUnits(provider, units, {
        targetLang: "vi",
        sourceLang: "en",
        singlePassMax: 4,
        targetBatchSize: 4,
      });

      assert.equal(result.translationsById.size, 12);
      // Verify exact deterministic order regardless of completion order
      for (let i = 1; i <= 12; i++) {
        assert.equal(
          result.translationsById.get(i),
          `Bản dịch chuẩn của nhóm #${i}`
        );
      }

      // Verify glossary terms ("Porsche 911", "GT3") and surrounding read-only context were injected
      assert.ok(
        capturedPrompts.some((p) => p.includes("Porsche") && p.includes("Shared Glossary & Proper Nouns")),
        "Prompt must include extracted recurring proper nouns / glossary"
      );
      assert.ok(
        capturedPrompts.some((p) => p.includes("Preceding Source Lines (READ-ONLY context")),
        "Subsequent batches must include read-only surrounding context"
      );
      assert.equal(result.metrics.totalBatches, 3);
      assert.equal(result.metrics.completedUnits, 12);
      assert.equal(result.metrics.missingUnitCount, 0);
    });

    it("retries ONLY missing items when a batch returns partial items, and never silently substitutes source text", async () => {
      await saveGeminiKeyEntries([
        { id: "k1", role: "primary", apiKey: "AIzaSyGranularKey00001" },
        { id: "k2", role: "secondary", apiKey: "AIzaSyGranularKey00002" },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      let fullFourItemCalls = 0;
      let granularRetryCalls = 0;

      globalThis.fetch = (async (_url: any, init?: any) => {
        const body = JSON.parse(init.body);
        const promptText: string = body.contents[0].parts[0].text;
        const idMatches = [...promptText.matchAll(/^\[(\d+)\]\s+/gm)].map((m) => Number(m[1]));

        if (idMatches.length === 4) {
          fullFourItemCalls++;
          // Intentionally omit item id=3 from the 4-item batch response
          const partialLines = idMatches
            .filter((id) => id !== 3)
            .map((id) => `[${id}] Dịch lô cho mục ${id}`)
            .join("\n");
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: partialLines }] } }],
            }),
            { status: 200 }
          );
        } else {
          granularRetryCalls++;
          const retryLines = idMatches
            .map((id) => `[${id}] Dịch bù thành công cho mục bị thiếu #${id}`)
            .join("\n");
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: retryLines || "Dịch bù thành công cho mục bị thiếu #3" }],
                  },
                },
              ],
            }),
            { status: 200 }
          );
        }
      }) as any;

      const units = [
        { unitId: 1, sourceText: "First line" },
        { unitId: 2, sourceText: "Second line" },
        { unitId: 3, sourceText: "Third line that was omitted by LLM output" },
        { unitId: 4, sourceText: "Fourth line" },
      ];

      const provider = new GeminiTranslateProvider(undefined, "gemini-1.5-flash", 30, 4096);
      const res = await geminiTranslationCoordinator.executeUnits(provider, units, {
        targetLang: "vi",
        sourceLang: "en",
        singlePassMax: 10,
        targetBatchSize: 10,
      });

      assert.equal(fullFourItemCalls, 1, "Should not re-run the entire 4-item batch");
      assert.ok(granularRetryCalls >= 1, "Should granularly retry only the missing item");
      assert.equal(res.translationsById.get(3), "Dịch bù thành công cho mục bị thiếu #3");
    });

    it("throws GeminiCoordinationError instead of returning untranslated source text when all keys fail", async () => {
      await saveGeminiKeyEntries([
        { id: "k1", role: "primary", apiKey: "AIzaSyFailingKey000001" },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            error: { code: 401, message: "Invalid key AIzaSyFailingKey000001 rejected" },
          }),
          { status: 401 }
        );
      }) as any;

      const provider = new GeminiTranslateProvider(undefined, "gemini-1.5-flash", 30, 4096);
      await assert.rejects(
        async () => {
          await geminiTranslationCoordinator.executeUnits(
            provider,
            [{ unitId: 1, sourceText: "Untranslated English sentence" }],
            {
              targetLang: "vi",
              sourceLang: "en",
            }
          );
        },
        (err: any) => {
          assert.ok(err instanceof GeminiCoordinationError);
          // Ensure raw key is redacted from the error message
          assert.equal(err.message.includes("AIzaSyFailingKey000001"), false);
          return true;
        }
      );
    });

    it("stops pending batches cleanly when cancelled mid-job via AbortController or isCancelled", async () => {
      await saveGeminiKeyEntries([
        { id: "k1", role: "primary", apiKey: "AIzaSyCancelKey0000001" },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      const abortController = new AbortController();
      let executedBatches = 0;

      globalThis.fetch = (async (_url: any, init?: any) => {
        executedBatches++;
        const body = JSON.parse(init.body);
        const promptText: string = body.contents[0].parts[0].text;
        const idMatches = [...promptText.matchAll(/^\[(\d+)\]\s+/gm)].map((m) => Number(m[1]));

        const outLines = idMatches.map((id) => `[${id}] Dịch ${id}`).join("\n");
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: outLines }] } }],
          }),
          { status: 200 }
        );
      }) as any;

      const units = Array.from({ length: 10 }, (_, i) => ({
        unitId: i + 1,
        sourceText: `Line number ${i + 1}`,
      }));

      const provider = new GeminiTranslateProvider(undefined, "gemini-1.5-flash", 30, 4096);
      const res = await geminiTranslationCoordinator.executeUnits(provider, units, {
        targetLang: "vi",
        sourceLang: "en",
        singlePassMax: 2,
        targetBatchSize: 2,
        maxConcurrency: 1,
        signal: abortController.signal,
        onProgressCues: (done) => {
          if (done >= 2) {
            abortController.abort();
          }
        },
      });

      assert.equal(executedBatches, 1, "Remaining batches must not be dispatched after abort");
      assert.equal(res.translationsById.size, 2);
    });
  });

  // =========================================================================
  // 5. REGRESSION: TTS, DUBBING (source_sync & free_narration), BATCH & OTHER PROVIDERS
  // =========================================================================
  describe("5. End-to-End Regression Across TTS, Dubbing Modes, Batch & Non-Gemini Providers", () => {
    it("translates TTS long scripts, Dubbing source_sync & free_narration cues, and resolves Batch credentials", async () => {
      await saveGeminiKeyEntries([
        { id: "k1", role: "primary", apiKey: "AIzaSyRegressKey000001" },
        { id: "k2", role: "secondary", apiKey: "AIzaSyRegressKey000002" },
      ]);
      geminiKeyPool.syncBucketsWithStore();

      globalThis.fetch = (async (_url: any, init?: any) => {
        const body = JSON.parse(init.body);
        const promptText: string = body.contents[0].parts[0].text;
        const idMatches = [...promptText.matchAll(/^\[(\d+)\]\s+/gm)].map((m) => Number(m[1]));
        if (idMatches.length > 0) {
          const outLines = idMatches
            .map((id) => `[${id}] Câu đã dịch số ${id}.`)
            .join("\n");
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: outLines }] } }],
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Đoạn văn TTS đã dịch sang tiếng Việt." }] } }],
          }),
          { status: 200 }
        );
      }) as any;

      const manager = TranslationManager.getInstance();

      // 1. TTS script translation
      const ttsTranslated = await manager.translateScriptText(
        "First paragraph of the script.\n\nSecond paragraph of the script.",
        "vi",
        "gemini"
      );
      assert.ok(ttsTranslated.includes("Câu đã dịch số 1."));
      assert.ok(ttsTranslated.includes("Câu đã dịch số 2."));

      // 2. Dubbing source_sync & free_narration via translateOriginalCues
      const originalCues: OriginalCue[] = [
        { index: 1, startSec: 0, endSec: 2.5, text: "Welcome to our car review." },
        { index: 2, startSec: 2.6, endSec: 5.0, text: "Today we test the new engine." },
      ];

      const syncRes = await manager.translateOriginalCues(
        originalCues,
        "vi",
        "gemini",
        undefined,
        "default",
        {
          sourceLang: "en",
          dubbingMode: "source_sync",
        }
      );
      assert.equal(syncRes.length, 2);

      const freeRes = await manager.translateOriginalCues(
        originalCues,
        "vi",
        "gemini",
        undefined,
        "default",
        {
          sourceLang: "en",
          dubbingMode: "free_narration",
        }
      );
      assert.equal(freeRes.length, 2);

      // 3. Batch CredentialResolver resolves active Gemini Key Pool
      const creds = CredentialResolver.getProviderCredentials("gemini");
      assert.equal(creds.apiKey, "AIzaSyRegressKey000001");

      // 4. Other providers (DeepSeek, OpenAI, LM Studio, Ollama) remain single-key and untouched
      mockStorage[PROVIDER_CONFIGS_STORAGE_KEY] = JSON.stringify({
        deepseek: { apiKey: "sk-deepseek-single", model: "deepseek-chat", timeout: 60, maxTokens: 4096 },
        openai: { apiKey: "sk-openai-single", model: "gpt-4o-mini", timeout: 60, maxTokens: 4096 },
      });
      const dsCreds = CredentialResolver.getProviderCredentials("deepseek");
      assert.equal(dsCreds.apiKey, "sk-deepseek-single");
      const oaCreds = CredentialResolver.getProviderCredentials("openai");
      assert.equal(oaCreds.apiKey, "sk-openai-single");
    });

    it("estimates token counts and extracts recurring glossary entities accurately", () => {
      const tokens = estimateTokenCount("Hello world, đây là câu tiếng Việt có dấu.");
      assert.ok(tokens > 5);

      const glossary = extractScriptGlossaryAndEntities([
        "Today we compare the Porsche Taycan Turbo with the Tesla Model S Plaid.",
        "The Porsche Taycan Turbo handles corners with remarkable precision.",
        "Meanwhile, the Tesla Model S Plaid delivers blistering straight-line speed.",
      ]);
      assert.ok(glossary.some((term) => term.includes("Porsche Taycan")));
      assert.ok(glossary.some((term) => term.includes("Tesla Model")));

      const chunks = chunkItemsTokenAware(
        Array.from({ length: 25 }, (_, i) => ({
          id: i,
          text: `Subtitle cue number ${i} with moderate length text for token budgeting.`,
        })),
        (item) => item.text,
        {
          singlePassMax: 10,
          targetBatchSize: 10,
          maxInputTokens: 200,
        }
      );
      assert.ok(chunks.length >= 3);
    });
  });

  // =========================================================================
  // 6. COMPARATIVE BENCHMARK: 1-KEY SEQUENTIAL VS 3-KEY CONCURRENT
  // =========================================================================
  describe("6. Empirical Benchmark: 1-Key Sequential vs 3-Key Concurrent Translation", () => {
    it("measures wall-clock speedup, 429 recovery, 100% line completeness, and deterministic ordering on 60 subtitle units", async () => {
      const SIMULATED_NETWORK_LATENCY_MS = 35;
      const units = Array.from({ length: 60 }, (_, idx) => ({
        unitId: idx + 1,
        sourceText: `In this segment #${idx + 1}, the reviewer tests the adaptive air suspension on rough mountain roads.`,
      }));

      // --- Case A: 1 Key Sequential (concurrency = 1) ---
      await saveGeminiKeyEntries([
        { id: "single_k1", role: "primary", apiKey: "AIzaSyBenchSingleKey01" },
      ]);
      geminiKeyPool.configure({
        resetStates: true,
        minLaunchStaggerMs: 0,
        sleepFn: async (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))),
      });
      geminiKeyPool.syncBucketsWithStore();

      globalThis.fetch = (async (_url: any, init?: any) => {
        await new Promise((r) => setTimeout(r, SIMULATED_NETWORK_LATENCY_MS));
        const body = JSON.parse(init.body);
        const promptText: string = body.contents[0].parts[0].text;
        const idMatches = [...promptText.matchAll(/^\[(\d+)\]\s+/gm)].map((m) => Number(m[1]));
        const outLines = idMatches.map((id) => `[${id}] Bản dịch #${id}`).join("\n");
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: outLines }] } }],
          }),
          { status: 200 }
        );
      }) as any;

      const providerSingle = new GeminiTranslateProvider(undefined, "gemini-1.5-flash", 30, 4096);
      const t0Single = performance.now();
      const resSingle = await geminiTranslationCoordinator.executeUnits(providerSingle, units, {
        targetLang: "vi",
        sourceLang: "en",
        singlePassMax: 10,
        targetBatchSize: 10, // 6 batches of 10
        maxConcurrency: 1,
      });
      const singleDurationMs = Math.round(performance.now() - t0Single);

      // --- Case B: 3 Keys Concurrent (concurrency = 3) with 1 simulated 429 on batch 2 ---
      await saveGeminiKeyEntries([
        { id: "multi_k1", role: "primary", apiKey: "AIzaSyBenchMultiKey001" },
        { id: "multi_k2", role: "secondary", apiKey: "AIzaSyBenchMultiKey002" },
        { id: "multi_k3", role: "secondary", apiKey: "AIzaSyBenchMultiKey003" },
      ]);
      geminiKeyPool.configure({
        resetStates: true,
        minLaunchStaggerMs: 2,
        sleepFn: async (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 15))),
      });
      geminiKeyPool.syncBucketsWithStore();

      let injected429 = false;
      globalThis.fetch = (async (_url: any, init?: any) => {
        await new Promise((r) => setTimeout(r, SIMULATED_NETWORK_LATENCY_MS));
        const body = JSON.parse(init.body);
        const promptText: string = body.contents[0].parts[0].text;
        const idMatches = [...promptText.matchAll(/^\[(\d+)\]\s+/gm)].map((m) => Number(m[1]));

        if (!injected429 && idMatches.includes(11)) {
          injected429 = true;
          return new Response(
            JSON.stringify({ error: { code: 429, message: "Rate limit hit, rotating key" } }),
            { status: 429, headers: { "Retry-After": "1" } }
          );
        }

        const outLines = idMatches.map((id) => `[${id}] Bản dịch #${id}`).join("\n");
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: outLines }] } }],
          }),
          { status: 200 }
        );
      }) as any;

      const providerMulti = new GeminiTranslateProvider(undefined, "gemini-1.5-flash", 30, 4096);
      const t0Multi = performance.now();
      const resMulti = await geminiTranslationCoordinator.executeUnits(providerMulti, units, {
        targetLang: "vi",
        sourceLang: "en",
        singlePassMax: 10,
        targetBatchSize: 10, // 6 batches of 10 across 3 concurrent workers
        maxConcurrency: 3,
      });
      const multiDurationMs = Math.round(performance.now() - t0Multi);

      console.log(
        `[BENCHMARK] 60 cues (6 batches): 1-Key Sequential = ${singleDurationMs}ms | 3-Key Concurrent (with 1x 429 rotation) = ${multiDurationMs}ms | 429 hits = ${resMulti.metrics.rateLimit429Count} | retries = ${resMulti.metrics.retryCount}`
      );

      assert.equal(resSingle.translationsById.size, 60);
      assert.equal(resMulti.translationsById.size, 60);
      assert.equal(resMulti.metrics.rateLimit429Count, 1);
      assert.ok(
        multiDurationMs < singleDurationMs,
        `3-key concurrent (${multiDurationMs}ms) should be faster than 1-key sequential (${singleDurationMs}ms)`
      );

      // Verify 100% deterministic ordering match between sequential and concurrent
      const singleEntries = [...resSingle.translationsById.entries()];
      const multiEntries = [...resMulti.translationsById.entries()];
      assert.deepEqual(multiEntries, singleEntries);
    });
  });
});

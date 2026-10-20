import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildBatchTranslationPrompt,
  parseBatchTranslationResponse,
  chunkArray,
  chunkArrayAdaptive,
  buildGlobalScriptSummary,
  stripThinkingTags,
  runWithConcurrency,
  BatchItem,
  BatchTranslationContext,
} from "../batchTranslationHelper";
import { TranslationManager } from "../manager";
import { OriginalCue } from "../../../types/dubbing";
import { TranslationProvider } from "../types";

describe("Batch Translation System Suite", () => {
  it("builds clear numbered prompts for batch translation", () => {
    const items: BatchItem[] = [
      { id: 1, text: "Good morning." },
      { id: 2, text: "Welcome to VoxLab." },
      { id: 3, text: "Let us start the demo." },
    ];

    const { system, user } = buildBatchTranslationPrompt(items, "vi", "default");
    assert.ok(system.includes("subtitle translator"));
    assert.ok(user.includes("[1] Good morning."));
    assert.ok(user.includes("[2] Welcome to VoxLab."));
    assert.ok(user.includes("[3] Let us start the demo."));
  });

  it("parses valid LLM batch responses correctly", () => {
    const items: BatchItem[] = [
      { id: 1, text: "Good morning." },
      { id: 2, text: "Welcome to VoxLab." },
      { id: 3, text: "Let us start the demo." },
    ];

    const response = `[1] Chào buổi sáng.
[2] Chào mừng đến với VoxLab.
[3] Hãy bắt đầu bản thử nghiệm.`;

    const parsed = parseBatchTranslationResponse(response, items);
    assert.equal(parsed.size, 3);
    assert.equal(parsed.get(1), "Chào buổi sáng.");
    assert.equal(parsed.get(2), "Chào mừng đến với VoxLab.");
    assert.equal(parsed.get(3), "Hãy bắt đầu bản thử nghiệm.");
  });

  it("strips <think>...</think> blocks from reasoning models cleanly", () => {
    const raw = `<think>
Let me analyze the numbered lines [1] Hello and [2] World.
[1] should be Xin chào.
</think>
[1] Xin chào
[2] Thế giới`;

    assert.equal(stripThinkingTags(raw), "[1] Xin chào\n[2] Thế giới");
    const parsed = parseBatchTranslationResponse(raw, [
      { id: 1, text: "Hello" },
      { id: 2, text: "World" },
    ]);
    assert.equal(parsed.get(1), "Xin chào");
    assert.equal(parsed.get(2), "Thế giới");
  });

  it("handles markdown code fences and unbracketed numbered fallbacks gracefully", () => {
    const items: BatchItem[] = [
      { id: 1, text: "One" },
      { id: 2, text: "Two" },
    ];

    const responseWithFences = `\`\`\`
1. [1] Một
2. [2] Hai
\`\`\``;

    const parsed = parseBatchTranslationResponse(responseWithFences, items);
    assert.equal(parsed.get(1), "Một");
    assert.equal(parsed.get(2), "Hai");
  });

  it("chunks arrays evenly with chunkArray and adaptively with chunkArrayAdaptive", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const chunks = chunkArray(arr, 4);
    assert.equal(chunks.length, 3);
    assert.deepEqual(chunks[0], [1, 2, 3, 4]);
    assert.deepEqual(chunks[1], [5, 6, 7, 8]);
    assert.deepEqual(chunks[2], [9, 10]);

    // <= 45 items -> 1 single request for the entire script
    const shortScript = Array.from({ length: 40 }, (_, i) => i + 1);
    const adaptiveShort = chunkArrayAdaptive(shortScript);
    assert.equal(adaptiveShort.length, 1);
    assert.equal(adaptiveShort[0].length, 40);

    // > 45 items (e.g. 60 items) -> balanced into 2 batches of 30 instead of 35 + 25
    const longScript = Array.from({ length: 60 }, (_, i) => i + 1);
    const adaptiveLong = chunkArrayAdaptive(longScript);
    assert.equal(adaptiveLong.length, 2);
    assert.equal(adaptiveLong[0].length, 30);
    assert.equal(adaptiveLong[1].length, 30);
  });

  it("executes tasks in parallel with runWithConcurrency", async () => {
    const items = [10, 20, 30, 40, 50];
    const results = await runWithConcurrency(
      items,
      async (val) => val * 2,
      3
    );
    assert.deepEqual(results, [20, 40, 60, 80, 100]);
  });

  it("accelerates TranslationManager.translateOriginalCues in 1 single request for <= 45 cues and injects global context for > 45 cues", async () => {
    const cues: OriginalCue[] = Array.from({ length: 30 }, (_, idx) => ({
      index: idx + 1,
      startSec: idx * 2,
      endSec: idx * 2 + 1.8,
      text: `Sentence number ${idx + 1}.`,
    }));

    const receivedContexts: (BatchTranslationContext | undefined)[] = [];
    const mockBatchProvider: TranslationProvider = {
      id: "mock_fast_provider",
      displayName: "Mock Fast Provider",
      type: "custom",
      badge: "Local",
      description: "Mock",
      async translate(text: string) {
        return `[Single] ${text}`;
      },
      async translateBatch(items: BatchItem[], _target, _source, _style, batchContext) {
        receivedContexts.push(batchContext);
        const map = new Map<number, string>();
        for (const item of items) {
          map.set(item.id, `[Dịch nhanh] ${item.text}`);
        }
        return map;
      },
    };

    const manager = TranslationManager.getInstance();
    (manager as any).builtInProviders.set("mock_fast_provider", mockBatchProvider);

    const progressReports: number[] = [];
    const translated = await manager.translateOriginalCues(
      cues,
      "vi",
      "mock_fast_provider",
      (done, _total) => {
        progressReports.push(done);
      },
      "default",
      { useSpeechGroups: false }
    );

    assert.equal(translated.length, 30);
    assert.equal(translated[0].text, "[Dịch nhanh] Sentence number 1.");
    assert.equal(translated[29].text, "[Dịch nhanh] Sentence number 30.");
    assert.equal(receivedContexts.length, 1, "30 cues should be translated in 1 single request!");
    assert.equal(receivedContexts[0]?.isFullScriptSinglePass, true);
    assert.equal(progressReports[progressReports.length - 1], 30);

    // Test multi-batch script (50 cues -> 2 balanced batches of 25 with Global Summary + PrevLines)
    receivedContexts.length = 0;
    const longCues: OriginalCue[] = Array.from({ length: 50 }, (_, idx) => ({
      index: idx + 1,
      startSec: idx * 2,
      endSec: idx * 2 + 1.8,
      text: `Dialogue line ${idx + 1}.`,
    }));

    const longTranslated = await manager.translateOriginalCues(
      longCues,
      "vi",
      "mock_fast_provider",
      undefined,
      "default",
      { useSpeechGroups: false }
    );

    assert.equal(longTranslated.length, 50);
    assert.equal(receivedContexts.length, 2, "50 cues should be split into 2 balanced batches!");
    assert.equal(receivedContexts[0]?.isFullScriptSinglePass, false);
    assert.ok(receivedContexts[0]?.globalSummary?.includes("Opening:"));
    assert.equal(receivedContexts[0]?.prevLines, undefined);
    assert.equal(receivedContexts[1]?.prevLines?.length, 3, "Batch #2 receives the last 3 translated lines from Batch #1!");
    assert.ok(buildGlobalScriptSummary(["A", "B"]).length > 0);
  });
});


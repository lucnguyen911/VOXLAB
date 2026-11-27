import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exportUnifiedMasterSubtitlesFromTts } from "../masterSubtitleExport";
import type { ChunkItem } from "../../../types/ui";
import type { LocalAiServices } from "../../ai/localAiServices";

describe("Master Subtitle Export — In-Chunk Trim & Seam Compaction Sync", () => {
  it("shifts Post-QC word timestamps by leadingTrimSec and compactedCuts before Tier-1 optimization", async () => {
    let capturedSegments: Array<{
      id: number;
      startSec: number;
      endSec: number;
      text: string;
      words?: Array<{ word: string; startSec: number; endSec: number; probability: number }>;
    }> = [];

    const mockAi = {
      optimizeSubtitlesV2: async (params: {
        segments: typeof capturedSegments;
      }) => {
        capturedSegments = params.segments;
        return {
          srt: "",
          totalCues: params.segments.length,
          cues: params.segments.map((seg, idx) => ({
            index: idx + 1,
            startSec: seg.startSec,
            endSec: seg.endSec,
            text: seg.text,
          })),
        };
      },
    } as unknown as LocalAiServices;

    // Chunk 1: untouched (0.00s -> 10.00s)
    // Chunk 2: starts at 10.50s in master WAV, had 0.585s leading artifact trimmed AND
    //          a 0.300s internal breath seam compacted at [4.00s..4.30s] (in post-lead-trim coords).
    const chunks: ChunkItem[] = [
      {
        id: "c1",
        index: 1,
        text: "First clean sentence.",
        originalText: "First clean sentence.",
        durationSec: 10.0,
        pauseAfterMs: "auto",
        status: "ready",
        qualityReview: {
          status: "pass",
          issues: [],
          summary: "OK",
          checkedAt: 1,
          words: [
            { word: "First", startSec: 0.2, endSec: 0.6 },
            { word: "clean", startSec: 0.6, endSec: 1.1 },
            { word: "sentence.", startSec: 1.1, endSec: 1.9 },
          ],
        },
      },
      {
        id: "c2",
        index: 2,
        text: "Lower food bills, Second program.",
        originalText: "Lower food bills, Second program.",
        durationSec: 8.0,
        pauseAfterMs: "auto",
        status: "ready",
        qualityReview: {
          status: "pass",
          issues: [],
          summary: "OK",
          checkedAt: 1,
          // Pre-assembly timestamps (before 0.585s leading trim and before 0.300s internal seam cut):
          // "Lower" starts at 0.610s raw -> 0.025s after 0.585s lead trim -> 10.525s in Master!
          // "Second" starts at 5.200s raw -> 4.615s after lead trim -> 4.315s after 0.300s seam cut -> 14.815s in Master!
          words: [
            { word: "Lower", startSec: 0.61, endSec: 1.05 },
            { word: "food", startSec: 1.05, endSec: 1.45 },
            { word: "bills,", startSec: 1.45, endSec: 2.1 },
            { word: "Second", startSec: 5.2, endSec: 5.7 },
            { word: "program.", startSec: 5.7, endSec: 6.4 },
          ],
        },
      },
    ];

    const cues = await exportUnifiedMasterSubtitlesFromTts({
      chunks,
      assembledSegments: [
        { index: 0, startSec: 0, endSec: 10.0, durationSec: 10.0 },
        {
          index: 1,
          startSec: 10.5,
          endSec: 17.615,
          durationSec: 7.115,
          leadingTrimSec: 0.585,
          compactedCuts: [{ startSec: 4.0, endSec: 4.3, removedSec: 0.3 }],
        },
      ],
      masterAudioPath: "master.wav",
      ai: mockAi,
      aspectRatio: "16:9",
      maxLines: 2,
    });

    assert.equal(capturedSegments.length, 2);
    const seg2Words = capturedSegments[1].words!;
    assert.equal(seg2Words.length, 5);
    // "Lower" must be at 10.50 + (0.61 - 0.585) = 10.525s (NOT 11.11s!)
    assert.ok(
      Math.abs(seg2Words[0].startSec - 10.525) < 0.005,
      `Expected ~10.525s, got ${seg2Words[0].startSec}`
    );
    // "Second" must be at 10.50 + (5.20 - 0.585 - 0.300) = 14.815s (NOT 15.70s!)
    assert.ok(
      Math.abs(seg2Words[3].startSec - 14.815) < 0.005,
      `Expected ~14.815s, got ${seg2Words[3].startSec}`
    );
    assert.equal(cues.length, 2);
  });
});

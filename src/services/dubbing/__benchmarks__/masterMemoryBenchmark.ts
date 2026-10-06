/**
 * Empirical Benchmark Harness for Master Audio WAV Assembly (TASK-21)
 * Measures Peak RAM, execution latency, and stability across 30m, 60m, and 120m workloads.
 * Run directly with: npx tsx src/services/dubbing/__benchmarks__/masterMemoryBenchmark.ts
 */

import { mergeMasterAudio } from "../masterAssembly";
import { OriginalCue, DubAudioSegment, TimingOverflowMetadata } from "../../../types/dubbing";
import { CANONICAL_SAMPLE_RATE } from "../audioNormalizer";

export interface BenchmarkMetrics {
  durationMinutes: number;
  cueCount: number;
  executionMs: number;
  initialHeapMb: number;
  peakHeapMb: number;
  heapDeltaMb: number;
  initialRssMb: number;
  peakRssMb: number;
  rssDeltaMb: number;
  outputWavBytes: number;
  outputWavMb: number;
  success: boolean;
}

/**
 * Generates synthetic benchmark workload for specified target duration.
 * Spacing: Each cue is ~5.0s speech followed by ~5.0s silence (1 cue every 10s).
 */
export function generateSyntheticWorkload(targetMinutes: number): {
  originalCues: OriginalCue[];
  audioSegments: Record<number, DubAudioSegment>;
  overflowAnalysis: Record<number, TimingOverflowMetadata>;
} {
  const targetSec = targetMinutes * 60;
  const cueIntervalSec = 10;
  const cueCount = Math.floor(targetSec / cueIntervalSec);

  const originalCues: OriginalCue[] = [];
  const audioSegments: Record<number, DubAudioSegment> = {};
  const overflowAnalysis: Record<number, TimingOverflowMetadata> = {};

  for (let i = 1; i <= cueCount; i++) {
    const startSec = (i - 1) * cueIntervalSec;
    const endSec = startSec + 5.0; // 5.0s cue duration

    originalCues.push({
      index: i,
      startSec,
      endSec,
      text: `Câu kiểm thử hiệu năng số ${i} cho mốc ${targetMinutes} phút.`,
    });

    audioSegments[i] = {
      cueIndex: i,
      status: "ready",
      rawDurationSec: 4.8,
      targetDurationSec: 5.0,
      fittedDurationSec: 4.8,
      speedFactor: 1.0,
      audioStartSec: startSec,
      audioEndSec: startSec + 4.8,
    };

    overflowAnalysis[i] = {
      cueIndex: i,
      hasOverflow: false,
      overflowSec: 0,
      hasCollision: false,
      collisionSec: 0,
      warningLevel: "none",
    };
  }

  return { originalCues, audioSegments, overflowAnalysis };
}

/**
 * Runs single benchmark measurement.
 */
export async function runMilestoneBenchmark(targetMinutes: number): Promise<BenchmarkMetrics> {
  // Trigger GC if available
  if (globalThis.gc) {
    globalThis.gc();
  }

  const { originalCues, audioSegments, overflowAnalysis } = generateSyntheticWorkload(targetMinutes);

  const memBefore = process.memoryUsage();
  const startTime = performance.now();

  let maxRss = memBefore.rss;
  let maxHeap = memBefore.heapUsed;

  // Sampler for memory polling
  const interval = setInterval(() => {
    const current = process.memoryUsage();
    if (current.rss > maxRss) maxRss = current.rss;
    if (current.heapUsed > maxHeap) maxHeap = current.heapUsed;
  }, 20);

  // Cached sample buffer to avoid reallocating during synthesis simulation
  const dummySampleCount = Math.round(4.8 * CANONICAL_SAMPLE_RATE);
  const sampleData = new Float32Array(dummySampleCount);
  for (let i = 0; i < dummySampleCount; i++) {
    sampleData[i] = Math.sin((2 * Math.PI * 440 * i) / CANONICAL_SAMPLE_RATE) * 0.2; // 440Hz tone
  }

  const result = mergeMasterAudio({
    originalCues,
    audioSegments,
    overflowAnalysis,
    sampleGetter: () => sampleData,
  });

  const endTime = performance.now();
  clearInterval(interval);

  const memAfter = process.memoryUsage();
  if (memAfter.rss > maxRss) maxRss = memAfter.rss;
  if (memAfter.heapUsed > maxHeap) maxHeap = memAfter.heapUsed;

  const executionMs = Math.round(endTime - startTime);
  const outputWavBytes = result.totalBytes || 0;

  return {
    durationMinutes: targetMinutes,
    cueCount: originalCues.length,
    executionMs,
    initialHeapMb: Number((memBefore.heapUsed / 1024 / 1024).toFixed(2)),
    peakHeapMb: Number((maxHeap / 1024 / 1024).toFixed(2)),
    heapDeltaMb: Number(((maxHeap - memBefore.heapUsed) / 1024 / 1024).toFixed(2)),
    initialRssMb: Number((memBefore.rss / 1024 / 1024).toFixed(2)),
    peakRssMb: Number((maxRss / 1024 / 1024).toFixed(2)),
    rssDeltaMb: Number(((maxRss - memBefore.rss) / 1024 / 1024).toFixed(2)),
    outputWavBytes,
    outputWavMb: Number((outputWavBytes / 1024 / 1024).toFixed(2)),
    success: result.ok,
  };
}

/**
 * Runner executing all 3 milestones: 30m, 60m, 120m.
 */
export async function runFullMasterBenchmarkSuite(): Promise<BenchmarkMetrics[]> {
  console.log("================================================================================");
  console.log("VOXLAB — EMPIRICAL MEMORY & PERFORMANCE BENCHMARK (TASK-21)");
  console.log("Evaluating: Master WAV Assembly (44.1kHz 16-bit Mono)");
  console.log(`OS: Windows x64 | Node: ${process.version} | Architecture: ${process.arch}`);
  console.log("================================================================================\n");

  const milestones = [30, 60, 120];
  const results: BenchmarkMetrics[] = [];

  for (const m of milestones) {
    console.log(`▶ Running Benchmark: Milestone ${m} minutes (~${m * 6} cues)...`);
    const metrics = await runMilestoneBenchmark(m);
    results.push(metrics);

    console.log(`  ✓ Status: ${metrics.success ? "PASSED" : "FAILED"}`);
    console.log(`  ✓ Latency: ${metrics.executionMs} ms`);
    console.log(`  ✓ Peak Heap: ${metrics.peakHeapMb} MB (Delta: +${metrics.heapDeltaMb} MB)`);
    console.log(`  ✓ Peak RSS: ${metrics.peakRssMb} MB (Delta: +${metrics.rssDeltaMb} MB)`);
    console.log(`  ✓ Output WAV: ${metrics.outputWavMb} MB (${metrics.outputWavBytes.toLocaleString()} bytes)`);
    console.log("");
  }

  console.log("--------------------------------------------------------------------------------");
  console.log("BENCHMARK SUMMARY MATRIX");
  console.log("--------------------------------------------------------------------------------");
  console.table(results.map((r) => ({
    "Milestone": `${r.durationMinutes} min`,
    "Cues": r.cueCount,
    "Execution (ms)": `${r.executionMs} ms`,
    "Peak Heap (MB)": `${r.peakHeapMb} MB`,
    "Peak RSS (MB)": `${r.peakRssMb} MB`,
    "Output WAV (MB)": `${r.outputWavMb} MB`,
    "Pass": r.success ? "PASS" : "FAIL",
  })));
  console.log("================================================================================\n");

  return results;
}

// Auto-run when invoked as CLI entry
if (typeof process !== "undefined" && process.argv && process.argv[1]?.includes("masterMemoryBenchmark")) {
  runFullMasterBenchmarkSuite().catch((err) => {
    console.error("Benchmark failed with error:", err);
    process.exit(1);
  });
}

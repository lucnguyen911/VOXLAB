/**
 * Micro-benchmark: cost of the pure chunking step behind "Chuyển sang tạo giọng"
 * (splitScriptWithPauses), isolated from React rendering. Used to attribute the long task
 * observed by webview-interaction-bench.mjs (Phase 11).
 *
 *   npx tsx scripts/perf/chunker-bench.ts
 */
import { splitScriptWithPauses } from "../../src/services/pause/chunker";

const sentences = [
  "To see why the charging delay myth falls apart in practice, you have to understand how commercial freight actually moves across America.",
  "Critics often imagine an eighteen wheeler pulling into a crowded highway rest stop and waiting three hours behind family sedans for an open plug.",
  "In reality, over eighty percent of regional and national retail freight runs on predictable, repeatable point to point routes.",
  "These trucks do not wander randomly across the map: they operate from depot to depot on strict schedules.",
  "Operating on the new Megawatt Charging System architecture, these cables deliver one point two megawatts of direct current power.",
  "By the time the dock doors close, the rig rolls, and the driver is back on the road in under thirty minutes.",
  "That vertical integration locks in stable energy prices for decades, which matters more than any single headline number.",
];
function makeDocument(n: number): string {
  let out = "";
  let i = 0;
  while (out.length < n) {
    out += sentences[i % sentences.length] + (i % 5 === 4 ? "\n\n" : " ");
    i++;
  }
  return out.slice(0, n);
}

for (const size of [5000, 30000, 100000]) {
  const doc = makeDocument(size);
  for (let w = 0; w < 3; w++) splitScriptWithPauses(doc); // JIT warm-up
  const times: number[] = [];
  let chunks = 0;
  for (let r = 0; r < 15; r++) {
    const t0 = performance.now();
    chunks = splitScriptWithPauses(doc).length;
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  console.log(JSON.stringify({ size, chunks, medianMs: +times[7].toFixed(2), maxMs: +times[14].toFixed(2) }));
}

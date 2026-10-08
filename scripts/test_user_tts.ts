import * as path from "node:path";
import * as fs from "node:fs";
import { ProcessAiBackend } from "../src/services/ai/testing/processAiBackend";
import { LocalAiServices } from "../src/services/ai/localAiServices";

async function main() {
  const backend = new ProcessAiBackend(process.cwd());
  const modelsDir = path.join(process.env.APPDATA || "", "com.voxlab.app", "models");
  const scratchDir = path.join(process.cwd(), "scratch");
  fs.mkdirSync(scratchDir, { recursive: true });

  const ai = new LocalAiServices(
    backend,
    {
      readText: async (p) => fs.readFileSync(p, "utf8"),
      writeText: async (p, c) => fs.writeFileSync(p, c, "utf8"),
      listDir: async (p) => fs.readdirSync(p),
      removeFile: async (p) => fs.unlinkSync(p),
      scratchDir: async (n) => path.join(scratchDir, n),
    },
    () => ({ modelsDir, device: "cuda", asrModelId: "faster-whisper-small" })
  );

  const text = "Xin chào, đây là bài kiểm tra giọng nói thật của VoxLab.";
  const outPath = path.join(scratchDir, "manual_proof.wav");
  console.log("Synthesizing text:", text);
  console.log("Output WAV target:", outPath);

  const res = await ai.synthesize({
    model: "OmniVoice",
    voiceId: "voice_01",
    text,
    outputPath: outPath,
    onProgress: (pct, stage) => {
      console.log(`[Progress] ${stage}: ${pct}%`);
    },
  });

  console.log("Synthesis Success!");
  console.log("Result:", res);
  console.log("File exists on disk:", fs.existsSync(outPath));
  console.log("File size bytes:", fs.statSync(outPath).size);
  await backend.shutdown();
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  extractParentDir,
  getLastExportDir,
  saveLastExportDirFromFilePath,
  buildDefaultExportPath,
  clearLastExportDir,
} from "../../storage/exportDirMemory";
import {
  buildPreviewTrackFilename,
  encodeMonoPcm16Wav,
  exportPreviewTrack,
  type PreviewTrackExportDeps,
} from "../previewTrackExport";

describe("Export Directory Memory & Single-Chunk Preview Export", () => {
  const storageBacking = new Map<string, string>();

  beforeEach(() => {
    storageBacking.clear();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (storageBacking.has(k) ? storageBacking.get(k)! : null),
      setItem: (k: string, v: string) => {
        storageBacking.set(k, String(v));
      },
      removeItem: (k: string) => {
        storageBacking.delete(k);
      },
    };
    clearLastExportDir();
  });

  it("extracts parent directory cleanly across Windows and POSIX paths", () => {
    assert.equal(
      extractParentDir("D:\\Outputs\\Project_A\\VoxLab_01_Matt.wav"),
      "D:\\Outputs\\Project_A"
    );
    assert.equal(
      extractParentDir("D:/Outputs/Project_A/VoxLab_01_Matt.wav"),
      "D:/Outputs/Project_A"
    );
    assert.equal(extractParentDir("D:\\VoxLab_01_Matt.wav"), "D:\\");
    assert.equal(extractParentDir("VoxLab_01_Matt.wav"), null);
  });

  it("remembers last chosen directory across Master and Single-Chunk exports", () => {
    assert.equal(getLastExportDir(), null);
    assert.equal(
      buildDefaultExportPath("VoxLab_14_Matt auto signals.wav"),
      "VoxLab_14_Matt auto signals.wav"
    );

    saveLastExportDirFromFilePath("E:\\Render_Audio\\Ep12\\VoxLab_Master.wav");
    assert.equal(getLastExportDir(), "E:\\Render_Audio\\Ep12");
    assert.equal(
      buildDefaultExportPath("VoxLab_14_Matt_auto_signals.wav"),
      "E:\\Render_Audio\\Ep12\\VoxLab_14_Matt_auto_signals.wav"
    );

    // Sanitizes illegal Windows filename characters in suggested basename
    assert.equal(
      buildDefaultExportPath('VoxLab_01_Google: English / US?.wav'),
      "E:\\Render_Audio\\Ep12\\VoxLab_01_Google_ English _ US_.wav"
    );
  });

  it("builds clean default filename for chunk preview tracks", () => {
    assert.equal(
      buildPreviewTrackFilename({
        id: "chunk_14",
        chunkIndex: 14,
        voiceName: "Matt auto signals",
        durationSec: 16.3,
      }),
      "VoxLab_14_Matt_auto_signals.wav"
    );
    assert.equal(
      buildPreviewTrackFilename({
        id: "chunk_4",
        chunkIndex: 4,
        voiceName: "Google: English (US)",
        durationSec: 12.5,
      }),
      "VoxLab_04_Google_English_(US).wav"
    );
  });

  it("opens Tauri Save dialog and aborts cleanly when user clicks Cancel (no Downloads dump)", async () => {
    let concatCalled = false;
    let writeBytesCalled = false;
    let browserDownloadCalled = false;

    const deps: PreviewTrackExportDeps = {
      isTauri: () => true,
      openSaveDialog: async () => null, // User pressed Cancel
      concatWavFast: async () => {
        concatCalled = true;
        return null;
      },
      assembleAudio: async () => {},
      writeBytes: async () => {
        writeBytesCalled = true;
      },
      fetchUrlBytes: async () => null,
      getFallbackPcmSamples: () => null,
      triggerBrowserDownload: () => {
        browserDownloadCalled = true;
      },
    };

    const res = await exportPreviewTrack(
      {
        id: "chunk_16",
        chunkIndex: 16,
        voiceName: "Matt auto signals",
        durationSec: 21.4,
        audioFilePath: "F:\\App Install\\VoxLab\\data\\scratch\\tts\\chunk_16.wav",
      },
      deps
    );

    assert.equal(res.status, "cancelled");
    assert.equal(concatCalled, false);
    assert.equal(writeBytesCalled, false);
    assert.equal(browserDownloadCalled, false);
  });

  it("copies exact on-disk WAV chunk to user-selected folder and updates remembered directory", async () => {
    saveLastExportDirFromFilePath("D:\\VoiceExports\\Batch1\\Master.wav");

    let dialogDefaultPath = "";
    let stitchedArgs: { inputs: Array<{ path: string; gapAfterMs?: number }>; outputPath: string } | null = null;
    let browserDownloadCalled = false;

    const deps: PreviewTrackExportDeps = {
      isTauri: () => true,
      openSaveDialog: async (defaultPath) => {
        dialogDefaultPath = defaultPath;
        return "D:\\VoiceExports\\Chunks\\VoxLab_61_Matt_auto_signals.wav";
      },
      concatWavFast: async (inputs, outputPath) => {
        stitchedArgs = { inputs, outputPath };
        return {
          outputPath,
          sampleRate: 24000,
          durationSec: 18.0,
          segments: [{ index: 0, startSec: 0, endSec: 18.0, durationSec: 18.0 }],
        };
      },
      assembleAudio: async () => {
        throw new Error("Should not call sidecar assemble when fast WAV copy succeeds");
      },
      writeBytes: async () => {
        throw new Error("Should not call JS writeBytes when native Rust WAV copy succeeds");
      },
      fetchUrlBytes: async () => null,
      getFallbackPcmSamples: () => null,
      triggerBrowserDownload: () => {
        browserDownloadCalled = true;
      },
    };

    const res = await exportPreviewTrack(
      {
        id: "chunk_61",
        chunkIndex: 61,
        voiceName: "Matt auto signals",
        durationSec: 18.0,
        audioFilePath: "F:\\App Install\\VoxLab\\data\\scratch\\tts\\chunk_61.wav",
      },
      deps
    );

    assert.equal(
      dialogDefaultPath,
      "D:\\VoiceExports\\Batch1\\VoxLab_61_Matt_auto_signals.wav"
    );
    assert.equal(res.status, "saved");
    assert.equal(res.savedPath, "D:\\VoiceExports\\Chunks\\VoxLab_61_Matt_auto_signals.wav");
    assert.deepEqual(stitchedArgs, {
      inputs: [{ path: "F:\\App Install\\VoxLab\\data\\scratch\\tts\\chunk_61.wav", gapAfterMs: 0 }],
      outputPath: "D:\\VoiceExports\\Chunks\\VoxLab_61_Matt_auto_signals.wav",
    });
    assert.equal(getLastExportDir(), "D:\\VoiceExports\\Chunks");
    assert.equal(browserDownloadCalled, false);
  });

  it("converts on-disk WAV chunk to MP3 via sidecar assemble when user selects .mp3", async () => {
    let assembledFormat = "";
    let assembledOutput = "";

    const deps: PreviewTrackExportDeps = {
      isTauri: () => true,
      openSaveDialog: async () => "D:\\Exports\\Chunk_14.mp3",
      concatWavFast: async () => null,
      assembleAudio: async (params) => {
        assembledFormat = params.format;
        assembledOutput = params.outputPath;
      },
      writeBytes: async () => {},
      fetchUrlBytes: async () => null,
      getFallbackPcmSamples: () => null,
      triggerBrowserDownload: () => {},
    };

    const res = await exportPreviewTrack(
      {
        id: "chunk_14",
        chunkIndex: 14,
        voiceName: "Matt auto signals",
        durationSec: 16.3,
        audioFilePath: "F:\\App Install\\VoxLab\\data\\scratch\\tts\\chunk_14.wav",
      },
      deps
    );

    assert.equal(res.status, "saved");
    assert.equal(assembledFormat, "mp3");
    assert.equal(assembledOutput, "D:\\Exports\\Chunk_14.mp3");
    assert.equal(getLastExportDir(), "D:\\Exports");
  });

  it("writes blob/PCM bytes to chosen Tauri path when track has no disk audioFilePath", async () => {
    let writtenPath = "";
    const capturedBytes: Uint8Array[] = [];
    let browserDownloadCalled = false;

    const pcm = encodeMonoPcm16Wav(new Float32Array([0, 0.5, -0.5, 0]), 24000);

    const deps: PreviewTrackExportDeps = {
      isTauri: () => true,
      openSaveDialog: async () => "D:\\PreviewOut\\Master_Preview.wav",
      concatWavFast: async () => null,
      assembleAudio: async () => {},
      writeBytes: async (path, bytes) => {
        writtenPath = path;
        capturedBytes.push(bytes);
      },
      fetchUrlBytes: async () => pcm,
      getFallbackPcmSamples: () => null,
      triggerBrowserDownload: () => {
        browserDownloadCalled = true;
      },
    };

    const res = await exportPreviewTrack(
      {
        id: "tts_master_preview",
        title: "Toàn bộ bài đọc (Master)",
        voiceName: "Matt auto signals",
        durationSec: 42.0,
        audioUrl: "blob:http://localhost/master-123",
      },
      deps
    );

    assert.equal(res.status, "saved");
    assert.equal(writtenPath, "D:\\PreviewOut\\Master_Preview.wav");
    assert.equal(capturedBytes.length, 1);
    assert.equal(capturedBytes[0].byteLength, pcm.byteLength);
    assert.equal(browserDownloadCalled, false);
  });
});

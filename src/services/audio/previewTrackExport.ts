import { isTauriRuntime } from "../ai/tauriBackend";
import { concatPcmWavsFast, getSharedAiServices, type WavConcatResult } from "../batch/batchRuntime";
import {
  buildDefaultExportPath,
  sanitizeExportFilename,
  saveLastExportDirFromFilePath,
} from "../storage/exportDirMemory";

export interface PreviewExportableTrack {
  id: string;
  chunkIndex?: number;
  voiceName?: string;
  title?: string;
  durationSec: number;
  audioUrl?: string;
  audioFilePath?: string;
  text?: string;
}

export interface PreviewTrackExportDeps {
  isTauri: () => boolean;
  openSaveDialog: (defaultPath: string) => Promise<string | null>;
  concatWavFast: (
    inputs: Array<{ path: string; gapAfterMs?: number }>,
    outputPath: string
  ) => Promise<WavConcatResult | null>;
  assembleAudio: (params: {
    inputs: Array<{ path: string; gapAfterMs?: number }>;
    outputPath: string;
    format: "wav" | "mp3";
  }) => Promise<void>;
  writeBytes: (path: string, bytes: Uint8Array) => Promise<void>;
  convertWavBytesToMp3?: (wavBytes: Uint8Array, outputPath: string) => Promise<void>;
  fetchUrlBytes: (url: string) => Promise<Uint8Array | null>;
  getFallbackPcmSamples: () => { samples: Float32Array | null; sampleRate: number } | null;
  triggerBrowserDownload: (bytes: Uint8Array, filename: string) => void;
}

export interface PreviewTrackExportResult {
  status: "saved" | "cancelled" | "browser_download";
  savedPath?: string;
}

function isLocalDiskPath(value?: string): boolean {
  if (!value) return false;
  return (
    value.startsWith("file://") ||
    /^[a-zA-Z]:[/\\]/.test(value) ||
    value.startsWith("\\\\")
  );
}

function normalizeLocalDiskPath(filePath: string): string {
  let cleanPath = filePath.trim();
  if (cleanPath.startsWith("file://")) {
    cleanPath = cleanPath.replace(/^file:\/\/\/?/, "");
    cleanPath = decodeURIComponent(cleanPath);
    if (/^\/[a-zA-Z]:/.test(cleanPath)) {
      cleanPath = cleanPath.slice(1);
    }
  }
  return cleanPath;
}

export function resolveTrackDiskPath(track: PreviewExportableTrack): string | null {
  if (track.audioFilePath && track.audioFilePath.trim()) {
    return normalizeLocalDiskPath(track.audioFilePath);
  }
  if (isLocalDiskPath(track.audioUrl)) {
    return normalizeLocalDiskPath(track.audioUrl!);
  }
  return null;
}

export function buildPreviewTrackFilename(track: PreviewExportableTrack): string {
  const chunkNumber =
    track.chunkIndex !== undefined
      ? track.chunkIndex < 10
        ? `0${track.chunkIndex}`
        : `${track.chunkIndex}`
      : track.id.replace(/^chunk_/, "");

  const cleanedSpeaker =
    (track.voiceName || "preview")
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, " ")
      .trim()
      .replace(/\s+/g, "_") || "preview";

  const diskPath = resolveTrackDiskPath(track);
  const ext = diskPath && diskPath.toLowerCase().endsWith(".mp3") ? "mp3" : "wav";
  return sanitizeExportFilename(`VoxLab_${chunkNumber}_${cleanedSpeaker}.${ext}`);
}

export function encodeMonoPcm16Wav(
  channelData: Float32Array | null,
  sampleRate: number = 44100,
  fallbackDurationSec: number = 1.0
): Uint8Array {
  const sr = sampleRate > 0 ? Math.round(sampleRate) : 44100;
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sr * blockAlign;
  const totalSamples = channelData
    ? channelData.length
    : Math.max(1, Math.floor(Math.max(0.1, fallbackDurationSec) * sr));
  const dataSize = totalSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  if (channelData) {
    let offset = 44;
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(offset, val, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

function createDefaultDeps(
  getFallbackPcmSamples: () => { samples: Float32Array | null; sampleRate: number } | null
): PreviewTrackExportDeps {
  return {
    isTauri: () => isTauriRuntime(),
    openSaveDialog: async (defaultPath: string) => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      return await save({
        defaultPath,
        filters: [
          { name: "Audio WAV (*.wav)", extensions: ["wav"] },
          { name: "Audio MP3 (*.mp3)", extensions: ["mp3"] },
          { name: "Tất cả các tệp (*.*)", extensions: ["*"] },
        ],
      });
    },
    concatWavFast: (inputs, outputPath) => concatPcmWavsFast(inputs, outputPath),
    assembleAudio: async ({ inputs, outputPath, format }) => {
      const ai = await getSharedAiServices();
      if (!ai) {
        throw new Error("Dịch vụ xử lý âm thanh cục bộ chưa sẵn sàng.");
      }
      await ai.assemble({
        inputs: inputs.map((item) => ({
          path: item.path,
          gapAfterMs: item.gapAfterMs ?? 0,
        })),
        outputPath,
        format,
        mode: "sequential",
      });
    },
    writeBytes: async (path: string, bytes: Uint8Array) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<void>("fs_write_bytes", { path, bytes: Array.from(bytes) });
    },
    convertWavBytesToMp3: async (wavBytes: Uint8Array, outputPath: string) => {
      const { invoke } = await import("@tauri-apps/api/core");
      const scratchDir = await invoke<string>("fs_scratch_dir", { name: "export" });
      const sep = scratchDir.includes("\\") ? "\\" : "/";
      const tmpWav = `${scratchDir.replace(/[\\/]+$/, "")}${sep}preview_${Date.now()}.wav`;
      await invoke<void>("fs_write_bytes", { path: tmpWav, bytes: Array.from(wavBytes) });
      try {
        const ai = await getSharedAiServices();
        if (!ai) {
          throw new Error("Dịch vụ xử lý âm thanh cục bộ chưa sẵn sàng.");
        }
        await ai.assemble({
          inputs: [{ path: tmpWav, gapAfterMs: 0 }],
          outputPath,
          format: "mp3",
          mode: "sequential",
        });
      } finally {
        await invoke<void>("fs_remove_file", { path: tmpWav }).catch(() => {});
      }
    },
    fetchUrlBytes: async (url: string) => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const arr = await resp.arrayBuffer();
        return arr.byteLength > 0 ? new Uint8Array(arr) : null;
      } catch {
        return null;
      }
    },
    getFallbackPcmSamples,
    triggerBrowserDownload: (bytes: Uint8Array, filename: string) => {
      const mime = filename.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
      const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };
}

export async function exportPreviewTrack(
  track: PreviewExportableTrack,
  customDeps?: PreviewTrackExportDeps,
  getFallbackPcmSamples: () => { samples: Float32Array | null; sampleRate: number } | null = () =>
    null
): Promise<PreviewTrackExportResult> {
  const deps = customDeps ?? createDefaultDeps(getFallbackPcmSamples);
  const defaultFilename = buildPreviewTrackFilename(track);

  if (deps.isTauri()) {
    const suggestedPath = buildDefaultExportPath(defaultFilename);
    const chosenRaw = await deps.openSaveDialog(suggestedPath);
    if (!chosenRaw) {
      return { status: "cancelled" };
    }

    const chosenPath = /\.[a-z0-9]{2,5}$/i.test(chosenRaw) ? chosenRaw : `${chosenRaw}.wav`;
    saveLastExportDirFromFilePath(chosenPath);

    const isMp3 = chosenPath.toLowerCase().endsWith(".mp3");
    const diskPath = resolveTrackDiskPath(track);

    if (diskPath) {
      if (!isMp3) {
        const fast = await deps.concatWavFast([{ path: diskPath, gapAfterMs: 0 }], chosenPath);
        if (fast) {
          return { status: "saved", savedPath: chosenPath };
        }
      }
      await deps.assembleAudio({
        inputs: [{ path: diskPath, gapAfterMs: 0 }],
        outputPath: chosenPath,
        format: isMp3 ? "mp3" : "wav",
      });
      return { status: "saved", savedPath: chosenPath };
    }

    let bytes =
      track.audioUrl && !isLocalDiskPath(track.audioUrl)
        ? await deps.fetchUrlBytes(track.audioUrl)
        : null;
    if (!bytes) {
      const fb = deps.getFallbackPcmSamples();
      bytes = encodeMonoPcm16Wav(fb?.samples ?? null, fb?.sampleRate ?? 44100, track.durationSec);
    }

    if (isMp3 && deps.convertWavBytesToMp3) {
      await deps.convertWavBytesToMp3(bytes, chosenPath);
    } else {
      await deps.writeBytes(chosenPath, bytes);
    }
    return { status: "saved", savedPath: chosenPath };
  }

  let webBytes = track.audioUrl ? await deps.fetchUrlBytes(track.audioUrl) : null;
  if (!webBytes) {
    const fb = deps.getFallbackPcmSamples();
    webBytes = encodeMonoPcm16Wav(fb?.samples ?? null, fb?.sampleRate ?? 44100, track.durationSec);
  }
  deps.triggerBrowserDownload(webBytes, defaultFilename);
  return { status: "browser_download" };
}

import {
  UnifiedHistoryItem,
  HistoryArtifactItem,
  HistoryFilterType,
  HistorySubtitleCue,
  HistoryTaskCategory,
  HistoryItemStatus,
} from "../../types/history";
import { BatchJob } from "../../types/batch";
import {
  saveAppDataFile,
  readAppDataFile,
  existsAppDataFile,
} from "../storage/tauriFsBridge";
import { isTauriRuntime } from "../ai/tauriBackend";

export const HISTORY_STORAGE_KEY = "voxlab_history_records_v2";
export const HISTORY_FILE = "history.json";

export const SAMPLE_UNIFIED_HISTORY: UnifiedHistoryItem[] = [
  {
    id: "hist-01",
    title: "video_gioi_thieu_khoa_hoc.mp4",
    sourceFilePath: "D:/Media/video_gioi_thieu_khoa_hoc.mp4",
    sourceFileSize: "92.0 MB",
    category: "batch",
    isBatch: true,
    tasks: ["transcription", "translation", "dubbing"],
    createdAt: "Hôm nay, 15:42",
    timestamp: Date.now() - 1000 * 60 * 30, // 30 mins ago
    status: "completed",
    duration: "3 phút 15 giây",
    outputDirectory: "D:/VoxLabOutput/Batch_Export/video_gioi_thieu_khoa_hoc",
    artifacts: [
      {
        id: "art-01-1",
        fileName: "video_gioi_thieu_khoa_hoc_sub.srt",
        filePath: "D:/VoxLabOutput/Batch_Export/video_gioi_thieu_khoa_hoc/video_gioi_thieu_khoa_hoc_sub.srt",
        fileSize: "18.4 KB",
        type: "subtitle",
        task: "transcription",
        label: "Phụ đề gốc",
        existsOnDisk: true,
        cues: [
          { index: 1, time: "00:00:00,500 --> 00:00:03,200", text: "Chào mừng các bạn đến với khóa học Trí tuệ Nhân tạo thực chiến." },
          { index: 2, time: "00:00:03,600 --> 00:00:07,150", text: "Trong bài học hôm nay, chúng ta sẽ tìm hiểu về mô hình xử lý giọng nói tự động." },
          { index: 3, time: "00:00:07,500 --> 00:00:11,000", text: "VoxLab cung cấp giải pháp xử lý hàng loạt nhanh chóng và chuẩn xác." },
        ],
      },
      {
        id: "art-01-2",
        fileName: "video_gioi_thieu_khoa_hoc_vi.srt",
        filePath: "D:/VoxLabOutput/Batch_Export/video_gioi_thieu_khoa_hoc/video_gioi_thieu_khoa_hoc_vi.srt",
        fileSize: "19.1 KB",
        type: "subtitle",
        task: "translation",
        label: "Bản dịch tiếng Việt",
        existsOnDisk: true,
        cues: [
          { index: 1, time: "00:00:00,500 --> 00:00:03,200", text: "Welcome everyone to the practical Artificial Intelligence course." },
          { index: 2, time: "00:00:03,600 --> 00:00:07,150", text: "In today's lesson, we will explore automatic speech processing models." },
          { index: 3, time: "00:00:07,500 --> 00:00:11,000", text: "VoxLab provides high-speed and accurate batch processing." },
        ],
      },
      {
        id: "art-01-3",
        fileName: "video_gioi_thieu_khoa_hoc_dub.wav",
        filePath: "D:/VoxLabOutput/Batch_Export/video_gioi_thieu_khoa_hoc/video_gioi_thieu_khoa_hoc_dub.wav",
        fileSize: "32.6 MB",
        duration: "03:15",
        type: "audio",
        task: "dubbing",
        label: "Audio Lồng tiếng (Minh Quang - Fit Timeline)",
        existsOnDisk: true,
        audioDurationSec: 195,
      },
    ],
  },
  {
    id: "hist-02",
    title: "kich_ban_hai_kich_tet.txt",
    sourceFilePath: "D:/KichBan/kich_ban_hai_kich_tet.txt",
    sourceFileSize: "28.6 KB",
    category: "batch",
    isBatch: true,
    tasks: ["dialogue", "transcription"],
    createdAt: "Hôm nay, 14:15",
    timestamp: Date.now() - 1000 * 60 * 120, // 2 hours ago
    status: "completed",
    duration: "4 phút 42 giây",
    outputDirectory: "D:/VoxLabOutput/Batch_Export/kich_ban_hai_kich_tet",
    artifacts: [
      {
        id: "art-02-1",
        fileName: "kich_ban_hai_kich_tet_master.wav",
        filePath: "D:/VoxLabOutput/Batch_Export/kich_ban_hai_kich_tet/kich_ban_hai_kich_tet_master.wav",
        fileSize: "44.2 MB",
        duration: "04:42",
        type: "audio",
        task: "dialogue",
        label: "Audio Hội thoại Phân vai Master (3 Nhân vật)",
        existsOnDisk: true,
        audioDurationSec: 282,
      },
      {
        id: "art-02-2",
        fileName: "kich_ban_hai_kich_tet.srt",
        filePath: "D:/VoxLabOutput/Batch_Export/kich_ban_hai_kich_tet/kich_ban_hai_kich_tet.srt",
        fileSize: "14.8 KB",
        type: "subtitle",
        task: "transcription",
        label: "Phụ đề Hội thoại đồng bộ ([Tên]: Lời thoại)",
        existsOnDisk: true,
        cues: [
          { index: 1, time: "00:00:00,000 --> 00:00:02,450", text: "[Nam]: Xin chào Lan, năm mới an khang thịnh vượng nhé!" },
          { index: 2, time: "00:00:03,050 --> 00:00:06,170", text: "[Lan]: Cảm ơn Nam, chúc cậu và gia đình vạn sự như ý." },
          { index: 3, time: "00:00:06,750 --> 00:00:09,800", text: "[Người dẫn chuyện]: Câu chuyện đầu xuân của đôi bạn trẻ bắt đầu từ đây." },
        ],
      },
    ],
  },
  {
    id: "hist-03",
    title: "baocao_tongket_quy3.docx",
    sourceFilePath: "D:/TaiLieu/baocao_tongket_quy3.docx",
    sourceFileSize: "15.4 KB",
    category: "tts",
    isBatch: false,
    tasks: ["tts"],
    createdAt: "Hôm nay, 11:20",
    timestamp: Date.now() - 1000 * 60 * 280, // ~4.5 hours ago
    status: "completed",
    chunkCount: 32,
    duration: "6 phút 10 giây",
    outputDirectory: "D:/VoxLabOutput/TTS_Single",
    artifacts: [
      {
        id: "art-03-1",
        fileName: "baocao_tongket_quy3.wav",
        filePath: "D:/VoxLabOutput/TTS_Single/baocao_tongket_quy3.wav",
        fileSize: "58.1 MB",
        duration: "06:10",
        type: "audio",
        task: "tts",
        label: "Audio Đọc bài TTS (Thảo Trinh - Hà Nội)",
        existsOnDisk: true,
        audioDurationSec: 370,
      },
    ],
  },
  {
    id: "hist-04",
    title: "audio_ban_tin_buoi_sang.mp3",
    sourceFilePath: "D:/Media/audio_ban_tin_buoi_sang.mp3",
    sourceFileSize: "18.3 MB",
    category: "transcription",
    isBatch: false,
    tasks: ["transcription"],
    createdAt: "Hôm qua, 18:05",
    timestamp: Date.now() - 1000 * 60 * 1300, // ~21 hours ago
    status: "completed",
    duration: "2 phút 50 giây",
    outputDirectory: "D:/VoxLabOutput/Subtitles",
    artifacts: [
      {
        id: "art-04-1",
        fileName: "audio_ban_tin_buoi_sang.srt",
        filePath: "D:/VoxLabOutput/Subtitles/audio_ban_tin_buoi_sang.srt",
        fileSize: "12.1 KB",
        type: "subtitle",
        task: "transcription",
        label: "Phụ đề trích xuất tự động (Whisper Large v3)",
        existsOnDisk: true,
        cues: [
          { index: 1, time: "00:00:00,200 --> 00:00:02,800", text: "Bản tin sáng ngày 4 tháng 10 năm 2026." },
          { index: 2, time: "00:00:03,100 --> 00:00:06,400", text: "Dự báo thời tiết hôm nay các tỉnh phía Bắc trời nhiều mây, có mưa rào nhẹ." },
        ],
      },
    ],
  },
  {
    id: "hist-05",
    title: "phim_tai_lieu_thien_nhien.mkv",
    sourceFilePath: "D:/Media/phim_tai_lieu_thien_nhien.mkv",
    sourceFileSize: "320.1 MB",
    category: "batch",
    isBatch: true,
    tasks: ["transcription", "translation", "dubbing"],
    createdAt: "03/10/2026, 16:30",
    timestamp: Date.now() - 1000 * 60 * 1600, // ~1 day ago
    status: "completed_with_warning",
    statusWarning: "WSOLA fit timeline có 2 câu tốc độ tăng > 1.25x do lời thoại tiếng Anh quá dài so với video gốc.",
    duration: "8 phút 12 giây",
    outputDirectory: "D:/VoxLabOutput/Batch_Export/phim_tai_lieu_thien_nhien",
    artifacts: [
      {
        id: "art-05-1",
        fileName: "phim_tai_lieu_thien_nhien_sub.srt",
        filePath: "D:/VoxLabOutput/Batch_Export/phim_tai_lieu_thien_nhien/phim_tai_lieu_thien_nhien_sub.srt",
        fileSize: "28.5 KB",
        type: "subtitle",
        task: "transcription",
        label: "Phụ đề gốc tiếng Anh",
        existsOnDisk: true,
        cues: [
          { index: 1, time: "00:00:01,000 --> 00:00:04,500", text: "Deep inside the Amazon rainforest, diverse ecosystems thrive." },
          { index: 2, time: "00:00:05,000 --> 00:00:09,200", text: "Centuries of evolution have created wonders beyond imagination." },
        ],
      },
      {
        id: "art-05-2",
        fileName: "phim_tai_lieu_thien_nhien_vi.srt",
        filePath: "D:/VoxLabOutput/Batch_Export/phim_tai_lieu_thien_nhien/phim_tai_lieu_thien_nhien_vi.srt",
        fileSize: "29.1 KB",
        type: "subtitle",
        task: "translation",
        label: "Bản dịch phụ đề tiếng Việt",
        existsOnDisk: true,
        cues: [
          { index: 1, time: "00:00:01,000 --> 00:00:04,500", text: "Sâu bên trong rừng rậm Amazon, các hệ sinh thái đa dạng phát triển mạnh mẽ." },
          { index: 2, time: "00:00:05,000 --> 00:00:09,200", text: "Hàng thế kỷ tiến hóa đã tạo nên những điều kỳ diệu vượt xa trí tưởng tượng." },
        ],
      },
      {
        id: "art-05-3",
        fileName: "phim_tai_lieu_thien_nhien_dub.wav",
        filePath: "D:/VoxLabOutput/Batch_Export/phim_tai_lieu_thien_nhien/phim_tai_lieu_thien_nhien_dub.wav",
        fileSize: "82.4 MB",
        duration: "08:12",
        type: "audio",
        task: "dubbing",
        label: "Audio Lồng tiếng tiếng Việt (WSOLA Speed Adjusted)",
        existsOnDisk: true,
        audioDurationSec: 492,
      },
    ],
  },
  {
    id: "hist-06",
    title: "audio_phong_van_chuyen_gia.wav",
    sourceFilePath: "D:/Media/audio_phong_van_chuyen_gia.wav",
    sourceFileSize: "68.4 MB",
    category: "batch",
    isBatch: true,
    tasks: ["transcription", "translation", "dubbing"],
    createdAt: "02/10/2026, 20:15",
    timestamp: Date.now() - 1000 * 60 * 2800, // ~2 days ago
    status: "failed_with_artifact",
    statusWarning: "Bước Dịch gặp lỗi timeout API, đã commit an toàn bản ghi Phụ đề ASR từ bước 1.",
    duration: "5 phút 20 giây",
    outputDirectory: "D:/VoxLabOutput/Batch_Export/audio_phong_van_chuyen_gia",
    artifacts: [
      {
        id: "art-06-1",
        fileName: "audio_phong_van_chuyen_gia_sub.srt",
        filePath: "D:/VoxLabOutput/Batch_Export/audio_phong_van_chuyen_gia/audio_phong_van_chuyen_gia_sub.srt",
        fileSize: "16.2 KB",
        type: "subtitle",
        task: "transcription",
        label: "Phụ đề ASR đã hoàn tất (Artifact bảo toàn)",
        existsOnDisk: true,
        cues: [
          { index: 1, time: "00:00:00,400 --> 00:00:03,800", text: "Thưa chuyên gia, ông đánh giá thế nào về xu hướng thị trường âm thanh số?" },
          { index: 2, time: "00:00:04,200 --> 00:00:08,100", text: "Đây là giai đoạn chuyển dịch bùng nổ của các công cụ AI hỗ trợ sáng tạo nội dung." },
        ],
      },
    ],
  },
  {
    id: "hist-07",
    title: "sach_noi_lich_su_am_thanh.txt",
    sourceFilePath: "D:/Audiobooks/sach_noi_lich_su_am_thanh.txt",
    sourceFileSize: "12.0 KB",
    category: "tts",
    isBatch: false,
    tasks: ["tts"],
    createdAt: "01/10/2026, 09:00",
    timestamp: Date.now() - 1000 * 60 * 4500, // ~3 days ago
    status: "completed",
    duration: "4 phút 10 giây",
    outputDirectory: "D:/VoxLabOutput/Audiobook_Archive",
    artifacts: [
      {
        id: "art-07-1",
        fileName: "sach_noi_lich_su_am_thanh.mp3",
        filePath: "D:/VoxLabOutput/Audiobook_Archive/sach_noi_lich_su_am_thanh.mp3",
        fileSize: "9.6 MB",
        type: "audio",
        task: "tts",
        label: "Audio Sách Nói MP3",
        existsOnDisk: false, // Flagged missing on disk to test missing-file UI alert
      },
    ],
  },
];

const SAMPLE_IDS = new Set(SAMPLE_UNIFIED_HISTORY.map((item) => item.id));

let inMemoryHistory: UnifiedHistoryItem[] | null = null;
let historyRevision = 0;
let committedHistoryRevision = 0;
let historyClearedRevision = 0;
const deletedHistoryIds = new Set<string>();
let historyWriteChain: Promise<void> = Promise.resolve();

function enqueueHistoryDiskWrite(): Promise<void> {
  const targetRevision = historyRevision;
  const runWrite = async () => {
    if (committedHistoryRevision >= targetRevision && targetRevision !== 0) {
      return;
    }
    const snapshotRevision = historyRevision;
    const snapshotItems = inMemoryHistory ? [...inMemoryHistory] : [];
    const payload = JSON.stringify(snapshotItems, null, 2);
    try {
      await saveAppDataFile(HISTORY_FILE, payload);
      committedHistoryRevision = Math.max(committedHistoryRevision, snapshotRevision);
    } catch {
      // Non-blocking in browser / test environments without Tauri FS
    }
  };
  const next = historyWriteChain.then(runWrite, runWrite);
  historyWriteChain = next.catch(() => {});
  return next;
}

export async function flushPendingHistoryWrites(): Promise<void> {
  await historyWriteChain;
}

export function getHistoryRevision(): number {
  return historyRevision;
}

export function resetHistoryManagerForTesting(): void {
  inMemoryHistory = null;
  historyRevision = 0;
  committedHistoryRevision = 0;
  historyClearedRevision = 0;
  deletedHistoryIds.clear();
  historyWriteChain = Promise.resolve();
}

function notifyHistoryUpdated(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent("voxlab_history_updated"));
    } catch {
      // ignore in non-DOM test environments
    }
  }
}

export function formatBytesLabel(bytes?: number): string | undefined {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDurationLabel(durationSec?: number): string | undefined {
  if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) {
    return undefined;
  }
  const total = Math.round(durationSec);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins > 0) {
    return `${mins} phút ${secs.toString().padStart(2, "0")} giây`;
  }
  return `${secs} giây`;
}

export function formatMmSsLabel(durationSec?: number): string | undefined {
  if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) {
    return undefined;
  }
  const total = Math.round(durationSec);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function formatHistoryCreatedAt(timestampMs: number): string {
  const d = new Date(timestampMs);
  const now = new Date();
  const timeStr = `${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return `Hôm nay, ${timeStr}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) {
    return `Hôm qua, ${timeStr}`;
  }

  const dayStr = d.getDate().toString().padStart(2, "0");
  const monthStr = (d.getMonth() + 1).toString().padStart(2, "0");
  return `${dayStr}/${monthStr}/${d.getFullYear()}, ${timeStr}`;
}

function parseSrtTimePartToSec(raw: string): number {
  const clean = raw.trim().replace(",", ".");
  const parts = clean.split(":");
  if (parts.length === 3) {
    return (parseFloat(parts[0]) || 0) * 3600 + (parseFloat(parts[1]) || 0) * 60 + (parseFloat(parts[2]) || 0);
  }
  if (parts.length === 2) {
    return (parseFloat(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
  }
  return parseFloat(clean) || 0;
}

/**
 * Parses SRT, VTT, or plain text content into structured HistorySubtitleCue items.
 */
export function parseSubtitleContentToHistoryCues(content: string): HistorySubtitleCue[] {
  const normalized = (content || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const cues: HistorySubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    if (lines[0].toUpperCase().startsWith("WEBVTT")) continue;

    const timeLineIdx = lines.findIndex((l) => l.includes("-->") || l.includes("→"));
    if (timeLineIdx !== -1) {
      const timeLine = lines[timeLineIdx];
      const textLines = lines.slice(timeLineIdx + 1);
      const text = textLines.join(" ").trim();
      if (!text) continue;
      const parts = timeLine.split(/-->|→/);
      const startSec = parts[0] ? parseSrtTimePartToSec(parts[0]) : undefined;
      const endSec = parts[1] ? parseSrtTimePartToSec(parts[1]) : undefined;
      cues.push({
        index: cues.length + 1,
        time: timeLine,
        text,
        startSec,
        endSec,
      });
    } else {
      // Plain text paragraph fallback (.txt exports)
      const text = lines.join(" ").trim();
      if (text) {
        cues.push({
          index: cues.length + 1,
          time: `Đoạn #${cues.length + 1}`,
          text,
        });
      }
    }
  }

  return cues;
}

export function extractDirectoryFromPath(filePath: string): string {
  const normalized = (filePath || "").replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return filePath;
  return filePath.slice(0, lastSlash);
}

export function loadHistoryItems(): UnifiedHistoryItem[] {
  if (inMemoryHistory !== null) {
    return [...inMemoryHistory];
  }

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed: UnifiedHistoryItem[] = JSON.parse(raw);
        const filtered = isTauriRuntime()
          ? parsed.filter((item) => !SAMPLE_IDS.has(item.id))
          : parsed;
        inMemoryHistory = filtered.sort((a, b) => b.timestamp - a.timestamp);
        return [...inMemoryHistory];
      }
    } catch {
      // ignore
    }
  }

  if (isTauriRuntime()) {
    inMemoryHistory = [];
    return [];
  }

  inMemoryHistory = [...SAMPLE_UNIFIED_HISTORY];
  return [...inMemoryHistory];
}

export function saveHistoryItems(items: UnifiedHistoryItem[]): void {
  historyRevision += 1;
  inMemoryHistory = [...items];
  for (const item of items) {
    deletedHistoryIds.delete(item.id);
  }

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error("Failed to save history items to localStorage:", e);
    }
  }

  // Persist to durable storage history.json sequentially via serialized write queue
  void enqueueHistoryDiskWrite();
  notifyHistoryUpdated();
}

/**
 * Safely merges asynchronously hydrated disk metadata (file size, WAV duration, cues, existsOnDisk)
 * into the live `inMemoryHistory` without overwriting newer records, clobbering newly merged artifacts,
 * or resurrecting deleted records.
 */
export function applyHydratedMetadataToMemory(
  hydratedItems: UnifiedHistoryItem[],
  baseRevision: number
): boolean {
  if (historyClearedRevision > baseRevision) {
    return false;
  }
  const current = loadHistoryItems();
  if (current.length === 0 || hydratedItems.length === 0) {
    return false;
  }

  const hydratedById = new Map<string, UnifiedHistoryItem>();
  for (const h of hydratedItems) {
    if (!deletedHistoryIds.has(h.id)) {
      hydratedById.set(h.id, h);
    }
  }

  let changed = false;
  const merged = current.map((liveJob) => {
    const hJob = hydratedById.get(liveJob.id);
    if (!hJob) return liveJob;

    const hArtByPath = new Map<string, HistoryArtifactItem>();
    const hArtById = new Map<string, HistoryArtifactItem>();
    for (const ha of hJob.artifacts) {
      hArtById.set(ha.id, ha);
      if (ha.filePath) {
        hArtByPath.set(ha.filePath.toLowerCase(), ha);
      }
    }

    let artifactsChanged = false;
    const nextArtifacts = liveJob.artifacts.map((liveArt) => {
      const hArt =
        hArtById.get(liveArt.id) ||
        (liveArt.filePath ? hArtByPath.get(liveArt.filePath.toLowerCase()) : undefined);
      if (!hArt) return liveArt;

      const nextExists = hArt.existsOnDisk ?? liveArt.existsOnDisk;
      const nextFileSize = liveArt.fileSize || hArt.fileSize;
      const nextAudioDur =
        liveArt.audioDurationSec && liveArt.audioDurationSec !== 60
          ? liveArt.audioDurationSec
          : hArt.audioDurationSec ?? liveArt.audioDurationSec;
      const nextDur = liveArt.duration || hArt.duration;
      const nextCues =
        liveArt.cues && liveArt.cues.length > 0 ? liveArt.cues : hArt.cues;

      if (
        nextExists !== liveArt.existsOnDisk ||
        nextFileSize !== liveArt.fileSize ||
        nextAudioDur !== liveArt.audioDurationSec ||
        nextDur !== liveArt.duration ||
        nextCues !== liveArt.cues
      ) {
        artifactsChanged = true;
        return {
          ...liveArt,
          existsOnDisk: nextExists,
          fileSize: nextFileSize,
          audioDurationSec: nextAudioDur,
          duration: nextDur,
          cues: nextCues,
        };
      }
      return liveArt;
    });

    const nextSourceSize = liveJob.sourceFileSize || hJob.sourceFileSize;
    const nextDuration = liveJob.duration || hJob.duration;

    if (
      artifactsChanged ||
      nextSourceSize !== liveJob.sourceFileSize ||
      nextDuration !== liveJob.duration
    ) {
      changed = true;
      return {
        ...liveJob,
        sourceFileSize: nextSourceSize,
        duration: nextDuration,
        artifacts: nextArtifacts,
      };
    }

    return liveJob;
  });

  if (changed) {
    saveHistoryItems(merged);
  }
  return changed;
}

/**
 * Verifies real disk existence, file size, WAV header duration, and subtitle cues
 * for all history items when running inside the Tauri desktop runtime.
 */
export async function hydrateHistoryItemsFromDisk(
  items: UnifiedHistoryItem[]
): Promise<UnifiedHistoryItem[]> {
  if (!isTauriRuntime() || items.length === 0) {
    return items;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");

    const hydrated = await Promise.all(
      items.map(async (job) => {
        // Probe source file size if missing and sourceFilePath is absolute
        let sourceFileSize = job.sourceFileSize;
        if (!sourceFileSize && job.sourceFilePath) {
          try {
            const stat = await invoke<{ size: number; mtimeMs: number } | null>("fs_stat", {
              path: job.sourceFilePath,
            });
            if (stat && stat.size > 0) {
              sourceFileSize = formatBytesLabel(stat.size);
            }
          } catch {
            // ignore
          }
        }

        const updatedArtifacts = await Promise.all(
          job.artifacts.map(async (art) => {
            if (!art.filePath) {
              return { ...art, existsOnDisk: false };
            }
            try {
              const stat = await invoke<{ size: number; mtimeMs: number } | null>("fs_stat", {
                path: art.filePath,
              });
              if (!stat) {
                return { ...art, existsOnDisk: false };
              }

              let fileSize = formatBytesLabel(stat.size) || art.fileSize;
              let audioDurationSec = art.audioDurationSec;
              let duration = art.duration;
              let cues = art.cues;

              if (
                art.type === "audio" &&
                art.filePath.toLowerCase().endsWith(".wav") &&
                (!audioDurationSec || audioDurationSec === 60)
              ) {
                try {
                  const probe = await invoke<{
                    durationSec: number;
                    sampleRate: number;
                    channels: number;
                    sizeBytes: number;
                  } | null>("fs_probe_wav_header", { path: art.filePath });
                  if (probe && probe.durationSec > 0) {
                    audioDurationSec = Math.round(probe.durationSec);
                    duration = formatMmSsLabel(probe.durationSec) || duration;
                  }
                } catch {
                  // ignore
                }
              }

              if (
                (art.type === "subtitle" || art.type === "text") &&
                (!cues || cues.length === 0)
              ) {
                try {
                  const rawText = await invoke<string>("fs_read_text", { path: art.filePath });
                  const parsedCues = parseSubtitleContentToHistoryCues(rawText);
                  if (parsedCues.length > 0) {
                    cues = parsedCues;
                  }
                } catch {
                  // ignore
                }
              }

              return {
                ...art,
                existsOnDisk: true,
                fileSize,
                audioDurationSec,
                duration,
                cues,
              };
            } catch {
              return { ...art, existsOnDisk: false };
            }
          })
        );

        const primaryAudio = updatedArtifacts.find((a) => a.type === "audio" && a.audioDurationSec);
        const jobDuration =
          job.duration ||
          (primaryAudio?.audioDurationSec
            ? formatDurationLabel(primaryAudio.audioDurationSec)
            : undefined);

        return {
          ...job,
          createdAt: job.timestamp ? formatHistoryCreatedAt(job.timestamp) : job.createdAt,
          sourceFileSize,
          duration: jobDuration,
          artifacts: updatedArtifacts,
        };
      })
    );

    return hydrated;
  } catch {
    return items;
  }
}

/**
 * Loads history items directly from durable history.json file if available,
 * reconciles with localStorage, and hydrates real disk state in Tauri.
 */
export async function loadHistoryFromFileAsync(): Promise<UnifiedHistoryItem[]> {
  const startRevision = historyRevision;
  let rawItems: UnifiedHistoryItem[] = [];
  try {
    const exists = await existsAppDataFile(HISTORY_FILE);
    if (exists) {
      const content = await readAppDataFile(HISTORY_FILE);
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        rawItems = parsed;
      }
    } else {
      rawItems = loadHistoryItems();
    }
  } catch {
    rawItems = loadHistoryItems();
  }

  if (isTauriRuntime()) {
    rawItems = rawItems.filter((item) => !SAMPLE_IDS.has(item.id));
  }

  const sorted = rawItems.sort((a, b) => b.timestamp - a.timestamp);
  const hydrated = await hydrateHistoryItemsFromDisk(sorted);

  // If clearAllHistory() was called while reading/hydrating from disk, keep only items added after clear
  if (historyClearedRevision > startRevision) {
    return loadHistoryItems();
  }

  // Reconcile disk items with any live in-memory mutations (additions, updates, or deletions)
  // that occurred while disk load/hydration was in flight.
  const currentLive = inMemoryHistory !== null ? [...inMemoryHistory] : [];
  const mergedMap = new Map<string, UnifiedHistoryItem>();

  for (const diskItem of hydrated) {
    if (deletedHistoryIds.has(diskItem.id)) continue;
    if (isTauriRuntime() && SAMPLE_IDS.has(diskItem.id)) continue;
    mergedMap.set(diskItem.id, diskItem);
  }

  for (const liveItem of currentLive) {
    if (deletedHistoryIds.has(liveItem.id)) continue;
    if (isTauriRuntime() && SAMPLE_IDS.has(liveItem.id)) continue;
    const diskVersion = mergedMap.get(liveItem.id);
    if (!diskVersion) {
      mergedMap.set(liveItem.id, liveItem);
    } else if (liveItem.timestamp >= diskVersion.timestamp) {
      // Live item is newer or equal: keep live item but backfill any hydrated disk metadata
      const diskArtByPath = new Map(
        diskVersion.artifacts.map((a) => [a.filePath.toLowerCase(), a])
      );
      const mergedArts = liveItem.artifacts.map((la) => {
        const da = diskArtByPath.get(la.filePath.toLowerCase());
        if (!da) return la;
        return {
          ...la,
          existsOnDisk: da.existsOnDisk ?? la.existsOnDisk,
          fileSize: la.fileSize || da.fileSize,
          audioDurationSec:
            la.audioDurationSec && la.audioDurationSec !== 60
              ? la.audioDurationSec
              : da.audioDurationSec ?? la.audioDurationSec,
          duration: la.duration || da.duration,
          cues: la.cues && la.cues.length > 0 ? la.cues : da.cues,
        };
      });
      mergedMap.set(liveItem.id, {
        ...liveItem,
        sourceFileSize: liveItem.sourceFileSize || diskVersion.sourceFileSize,
        duration: liveItem.duration || diskVersion.duration,
        artifacts: mergedArts,
      });
    }
  }

  const reconciled = Array.from(mergedMap.values()).sort(
    (a, b) => b.timestamp - a.timestamp
  );
  saveHistoryItems(reconciled);

  return [...reconciled];
}

/**
 * Reads and parses subtitle/text cues directly from disk for a single artifact if needed.
 */
export async function loadArtifactCuesFromDisk(
  artifact: HistoryArtifactItem
): Promise<HistorySubtitleCue[]> {
  if (artifact.cues && artifact.cues.length > 0) {
    return artifact.cues;
  }
  if (!isTauriRuntime() || !artifact.filePath) {
    return [];
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const rawText = await invoke<string>("fs_read_text", { path: artifact.filePath });
    return parseSubtitleContentToHistoryCues(rawText);
  } catch {
    return [];
  }
}

/**
 * Opens a file or directory in the OS native file explorer (Windows Explorer).
 */
export async function openHistoryPathInFolder(
  targetPath?: string,
  fallbackDirectory?: string
): Promise<boolean> {
  const candidate = (targetPath || fallbackDirectory || "").trim();
  if (!candidate) return false;

  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // Check if primary target exists; if not, fallback to parent/output directory
      if (targetPath) {
        const exists = await invoke<boolean>("fs_exists", { path: targetPath }).catch(() => false);
        if (exists) {
          await invoke<void>("fs_show_in_folder", { path: targetPath });
          return true;
        }
      }
      const dirToOpen = fallbackDirectory || extractDirectoryFromPath(candidate);
      await invoke<void>("fs_show_in_folder", { path: dirToOpen });
      return true;
    } catch (err) {
      console.warn("[History] fs_show_in_folder failed:", err);
      return false;
    }
  }

  return false;
}

export interface RecordCompletedJobParams {
  jobKey?: string; // Optional stable key to merge artifacts from the same session/media
  title: string;
  sourceFilePath?: string;
  sourceFileSize?: string;
  category: HistoryTaskCategory;
  isBatch?: boolean;
  tasks: ("tts" | "dialogue" | "transcription" | "translation" | "dubbing")[];
  status?: HistoryItemStatus;
  statusWarning?: string;
  durationSec?: number;
  chunkCount?: number;
  outputDirectory?: string;
  artifacts: Array<{
    filePath: string;
    fileName?: string;
    fileSize?: string;
    type: "audio" | "subtitle" | "text" | "video";
    task: "tts" | "dialogue" | "transcription" | "translation" | "dubbing";
    label?: string;
    audioDurationSec?: number;
    subtitleContent?: string;
    cues?: HistorySubtitleCue[];
    isTimelineSynced?: boolean;
  }>;
}

/**
 * Records a completed export from any workspace (TTS, Dialogue, Transcription, Dubbing)
 * into durable History (`history.json` + `localStorage`).
 * If `jobKey` matches an existing recent record (< 2 hours old), merges new artifacts
 * and tasks into that job record so multi-artifact workflows (e.g. Dubbing SRT + WAV)
 * stay unified under a single job card.
 */
export function recordCompletedJobToHistory(params: RecordCompletedJobParams): UnifiedHistoryItem {
  const existing = loadHistoryItems();
  const nowMs = Date.now();
  const histId = params.jobKey ? `hist-${params.jobKey}` : `hist-${nowMs}-${Math.random().toString(36).slice(2, 7)}`;

  const existingMatch = params.jobKey
    ? existing.find((item) => item.id === histId && nowMs - item.timestamp < 2 * 3600 * 1000)
    : undefined;

  const newArtifacts: HistoryArtifactItem[] = params.artifacts.map((a, idx) => {
    const fileName =
      a.fileName ||
      a.filePath.split("/").pop() ||
      a.filePath.split("\\").pop() ||
      `artifact_${idx + 1}`;
    const parsedCues =
      a.cues && a.cues.length > 0
        ? a.cues
        : a.subtitleContent
        ? parseSubtitleContentToHistoryCues(a.subtitleContent)
        : undefined;

    return {
      id: `${histId}-art-${nowMs}-${idx}`,
      fileName,
      filePath: a.filePath,
      fileSize: a.fileSize,
      duration: a.audioDurationSec ? formatMmSsLabel(a.audioDurationSec) : undefined,
      type: a.type,
      task: a.task,
      label: a.label,
      existsOnDisk: true,
      audioDurationSec: a.audioDurationSec ? Math.round(a.audioDurationSec) : undefined,
      cues: parsedCues,
      isTimelineSynced: a.isTimelineSynced,
    };
  });

  const firstPath = params.artifacts[0]?.filePath || "";
  const resolvedOutputDir =
    params.outputDirectory || (firstPath ? extractDirectoryFromPath(firstPath) : "");

  let finalItem: UnifiedHistoryItem;

  if (existingMatch) {
    // Merge artifacts by filePath (replace if same filePath was re-exported, append if new)
    const mergedArtifacts = [...existingMatch.artifacts];
    for (const incoming of newArtifacts) {
      const idx = mergedArtifacts.findIndex(
        (m) => m.filePath.toLowerCase() === incoming.filePath.toLowerCase()
      );
      if (idx !== -1) {
        mergedArtifacts[idx] = { ...incoming, id: mergedArtifacts[idx].id };
      } else {
        mergedArtifacts.push(incoming);
      }
    }

    const mergedTasks = Array.from(new Set([...existingMatch.tasks, ...params.tasks]));
    const primaryDurationSec =
      params.durationSec ||
      mergedArtifacts.find((a) => a.type === "audio" && a.audioDurationSec)?.audioDurationSec;

    finalItem = {
      ...existingMatch,
      title: params.title || existingMatch.title,
      sourceFilePath: params.sourceFilePath || existingMatch.sourceFilePath,
      sourceFileSize: params.sourceFileSize || existingMatch.sourceFileSize,
      tasks: mergedTasks,
      createdAt: formatHistoryCreatedAt(nowMs),
      timestamp: nowMs,
      status: params.status || existingMatch.status,
      statusWarning: params.statusWarning ?? existingMatch.statusWarning,
      duration: primaryDurationSec ? formatDurationLabel(primaryDurationSec) : existingMatch.duration,
      chunkCount: params.chunkCount ?? existingMatch.chunkCount,
      outputDirectory: resolvedOutputDir || existingMatch.outputDirectory,
      artifacts: mergedArtifacts,
    };
  } else {
    const primaryDurationSec =
      params.durationSec ||
      newArtifacts.find((a) => a.type === "audio" && a.audioDurationSec)?.audioDurationSec;

    finalItem = {
      id: histId,
      title: params.title,
      sourceFilePath: params.sourceFilePath,
      sourceFileSize: params.sourceFileSize,
      category: params.category,
      isBatch: Boolean(params.isBatch),
      tasks: [...params.tasks],
      createdAt: formatHistoryCreatedAt(nowMs),
      timestamp: nowMs,
      status: params.status || "completed",
      statusWarning: params.statusWarning,
      duration: primaryDurationSec ? formatDurationLabel(primaryDurationSec) : undefined,
      chunkCount: params.chunkCount,
      outputDirectory: resolvedOutputDir,
      artifacts: newArtifacts,
    };
  }

  const remaining = existing.filter((item) => item.id !== finalItem.id);
  const updated = [finalItem, ...remaining].sort((a, b) => b.timestamp - a.timestamp);
  saveHistoryItems(updated);
  const savedRevision = historyRevision;

  // Trigger background disk hydration for ONLY this job and merge metadata non-destructively
  if (isTauriRuntime()) {
    hydrateHistoryItemsFromDisk([finalItem])
      .then((hydrated) => {
        applyHydratedMetadataToMemory(hydrated, savedRevision);
      })
      .catch(() => {});
  }

  return finalItem;
}

/**
 * Saves history items directly to durable history.json file via the serialized write queue
 */
export async function saveHistoryToFileAsync(items: UnifiedHistoryItem[]): Promise<void> {
  saveHistoryItems(items);
  await flushPendingHistoryWrites();
}

export function deleteHistoryItem(id: string, current?: UnifiedHistoryItem[]): UnifiedHistoryItem[] {
  deletedHistoryIds.add(id);
  const sourceList = inMemoryHistory !== null ? inMemoryHistory : current || loadHistoryItems();
  const updated = sourceList.filter((item) => item.id !== id);
  saveHistoryItems(updated);
  return updated;
}

export function clearAllHistory(): void {
  historyRevision += 1;
  historyClearedRevision = historyRevision;
  if (inMemoryHistory) {
    for (const item of inMemoryHistory) {
      deletedHistoryIds.add(item.id);
    }
  }
  inMemoryHistory = [];
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.setItem(HISTORY_STORAGE_KEY, "[]");
  }
  void enqueueHistoryDiskWrite();
  notifyHistoryUpdated();
}

export function filterHistoryItems(
  items: UnifiedHistoryItem[],
  filter: HistoryFilterType,
  searchQuery: string
): UnifiedHistoryItem[] {
  const q = searchQuery.trim().toLowerCase();

  return items.filter((item) => {
    // 1. Task filter matching
    if (filter === "batch" && !item.isBatch) return false;
    if (filter === "tts" && !item.tasks.includes("tts")) return false;
    if (filter === "dialogue" && !item.tasks.includes("dialogue")) return false;
    if (filter === "transcription" && !item.tasks.includes("transcription")) return false;
    if (filter === "translation" && !item.tasks.includes("translation")) return false;
    if (filter === "dubbing" && !item.tasks.includes("dubbing")) return false;

    // 2. Search query matching
    if (q) {
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchSource = (item.sourceFilePath || "").toLowerCase().includes(q);
      const matchArtifact = item.artifacts.some(
        (a) => a.fileName.toLowerCase().includes(q) || (a.label || "").toLowerCase().includes(q)
      );
      if (!matchTitle && !matchSource && !matchArtifact) return false;
    }

    return true;
  });
}

export type BatchJobOrHistorical =
  | BatchJob
  | {
      id: string;
      fileName: string;
      filePath?: string;
      fileSize?: string;
      selectedTasks: ("tts" | "dialogue" | "transcription" | "translation" | "dubbing")[];
      status: string;
      statusWarning?: string;
      outputPath?: string;
      runId?: string;
      outputArtifacts?: {
        audioPath?: string;
        audioDuration?: number;
        subtitles?: Array<{ path: string; label: string; cues: Array<{ time: string; text: string }> }>;
      };
    };

export function syncBatchJobToHistory(job: BatchJobOrHistorical): UnifiedHistoryItem | null {
  if (
    job.status !== "completed" &&
    job.status !== "completed_with_warning" &&
    job.status !== "failed_with_artifact"
  ) {
    return null;
  }

  const existing = loadHistoryItems();
  const histId = `hist-${job.id}`;

  const isFullBatchJob = "sourceFileName" in job;
  const fileName = isFullBatchJob ? job.sourceFileName : job.fileName;
  const sourceFilePath = isFullBatchJob ? job.sourceFilePath : job.filePath;
  const sourceFileSize = isFullBatchJob
    ? `${(job.sourceFileSize / (1024 * 1024)).toFixed(1)} MB`
    : job.fileSize;
  const outputPath = isFullBatchJob
    ? job.outputSnapshot?.resolvedOutputDirectory || "D:/VoxLabOutput/Batch_Export"
    : job.outputPath || "D:/VoxLabOutput/Batch_Export";
  const statusWarning = isFullBatchJob ? job.warningMessage : job.statusWarning;
  const runId = "runId" in job ? job.runId : undefined;

  const artifacts: HistoryArtifactItem[] = [];

  if (isFullBatchJob) {
    const ownedPaths = job.artifacts?.ownedArtifactPaths || [];
    ownedPaths.forEach((path, idx) => {
      const artFileName = path.split("/").pop() || path.split("\\").pop() || `artifact_${idx}`;
      if (artFileName.endsWith(".wav") || artFileName.endsWith(".mp3")) {
        const task = job.selectedTasks.includes("dubbing")
          ? "dubbing"
          : job.selectedTasks.includes("dialogue")
          ? "dialogue"
          : "tts";
        artifacts.push({
          id: `${histId}-audio-${idx}`,
          fileName: artFileName,
          filePath: path,
          type: "audio",
          task,
          label:
            task === "dubbing"
              ? "Audio Lồng tiếng"
              : task === "dialogue"
              ? "Audio Hội thoại"
              : "Audio TTS",
          existsOnDisk: true,
          audioDurationSec: 60,
        });
      } else if (artFileName.endsWith(".srt") || artFileName.endsWith(".vtt")) {
        const isTrans = artFileName.includes("_vi") || artFileName.includes("dich");
        artifacts.push({
          id: `${histId}-sub-${idx}`,
          fileName: artFileName,
          filePath: path,
          type: "subtitle",
          task: isTrans ? "translation" : "transcription",
          label: isTrans ? "Bản dịch phụ đề" : "Phụ đề",
          existsOnDisk: true,
        });
      }
    });
  } else {
    if (job.outputArtifacts?.audioPath) {
      const artFileName = job.outputArtifacts.audioPath.split("/").pop() || "master.wav";
      const task = job.selectedTasks.includes("dubbing")
        ? "dubbing"
        : job.selectedTasks.includes("dialogue")
        ? "dialogue"
        : "tts";
      artifacts.push({
        id: `${histId}-audio`,
        fileName: artFileName,
        filePath: job.outputArtifacts.audioPath,
        type: "audio",
        task,
        label:
          task === "dubbing"
            ? "Audio Lồng tiếng"
            : task === "dialogue"
            ? "Audio Hội thoại"
            : "Audio TTS",
        existsOnDisk: true,
        audioDurationSec: job.outputArtifacts.audioDuration || 60,
      });
    }

    if (job.outputArtifacts?.subtitles) {
      job.outputArtifacts.subtitles.forEach((sub, sIdx) => {
        const artFileName = sub.path.split("/").pop() || `sub_${sIdx}.srt`;
        const isTrans = artFileName.includes("_vi") || artFileName.includes("dich");
        artifacts.push({
          id: `${histId}-sub-${sIdx}`,
          fileName: artFileName,
          filePath: sub.path,
          type: "subtitle",
          task: isTrans ? "translation" : "transcription",
          label: sub.label || (isTrans ? "Bản dịch phụ đề" : "Phụ đề"),
          existsOnDisk: true,
          cues: sub.cues?.map((c, cIdx) => ({
            index: cIdx + 1,
            time: c.time,
            text: c.text,
          })),
        });
      });
    }
  }

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  const historyItem: UnifiedHistoryItem = {
    id: histId,
    title: fileName,
    sourceFilePath,
    sourceFileSize,
    category: "batch",
    isBatch: true,
    tasks: [...job.selectedTasks],
    createdAt: `Hôm nay, ${timeStr}`,
    timestamp: Date.now(),
    status: job.status as any,
    statusWarning,
    outputDirectory: outputPath,
    artifacts,
    runId,
  };

  const filtered = existing.filter(
    (item) => item.id !== histId || (item.runId && item.runId !== runId)
  );
  const updated = [historyItem, ...filtered].sort((a, b) => b.timestamp - a.timestamp);
  saveHistoryItems(updated);
  const savedRevision = historyRevision;

  if (isTauriRuntime()) {
    hydrateHistoryItemsFromDisk([historyItem])
      .then((hydrated) => {
        applyHydratedMetadataToMemory(hydrated, savedRevision);
      })
      .catch(() => {});
  }

  return historyItem;
}


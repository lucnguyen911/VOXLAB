import {
  UnifiedHistoryItem,
  HistoryArtifactItem,
  HistoryFilterType,
} from "../../types/history";
import { BatchJob } from "../../types/batch";
import {
  saveAppDataFile,
  readAppDataFile,
  existsAppDataFile,
} from "../storage/tauriFsBridge";

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

let inMemoryHistory: UnifiedHistoryItem[] | null = null;

export function loadHistoryItems(): UnifiedHistoryItem[] {
  if (inMemoryHistory !== null) {
    return [...inMemoryHistory];
  }

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed: UnifiedHistoryItem[] = JSON.parse(raw);
        inMemoryHistory = parsed.sort((a, b) => b.timestamp - a.timestamp);
        return [...inMemoryHistory];
      }
    } catch {
      // ignore
    }
  }

  inMemoryHistory = [...SAMPLE_UNIFIED_HISTORY];
  return [...inMemoryHistory];
}

export function saveHistoryItems(items: UnifiedHistoryItem[]): void {
  inMemoryHistory = [...items];

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error("Failed to save history items to localStorage:", e);
    }
  }

  // Also persist to durable storage history.json asynchronously via Tauri FS Bridge
  saveAppDataFile(HISTORY_FILE, JSON.stringify(items, null, 2)).catch(() => {
    // Non-blocking in browser / test environments
  });
}

/**
 * Loads history items directly from durable history.json file if available
 */
export async function loadHistoryFromFileAsync(): Promise<UnifiedHistoryItem[]> {
  try {
    const exists = await existsAppDataFile(HISTORY_FILE);
    if (!exists) {
      return loadHistoryItems();
    }
    const content = await readAppDataFile(HISTORY_FILE);
    const parsed: UnifiedHistoryItem[] = JSON.parse(content);
    inMemoryHistory = parsed.sort((a, b) => b.timestamp - a.timestamp);
    return [...inMemoryHistory];
  } catch {
    return loadHistoryItems();
  }
}

/**
 * Saves history items directly to durable history.json file
 */
export async function saveHistoryToFileAsync(items: UnifiedHistoryItem[]): Promise<void> {
  saveHistoryItems(items);
  await saveAppDataFile(HISTORY_FILE, JSON.stringify(items, null, 2));
}

export function deleteHistoryItem(id: string, current: UnifiedHistoryItem[]): UnifiedHistoryItem[] {
  const updated = current.filter((item) => item.id !== id);
  saveHistoryItems(updated);
  return updated;
}

export function clearAllHistory(): void {
  inMemoryHistory = [];
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  }
  saveAppDataFile(HISTORY_FILE, "[]").catch(() => {});
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
  return historyItem;
}


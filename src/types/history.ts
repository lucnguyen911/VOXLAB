export type HistoryTaskCategory =
  | "tts"
  | "dialogue"
  | "transcription"
  | "translation"
  | "dubbing"
  | "batch"
  | "clone";

export type HistoryItemStatus =
  | "completed"
  | "completed_with_warning"
  | "failed_with_artifact"
  | "interrupted"
  | "failed";

export type HistoryFilterType =
  | "all"
  | "tts"
  | "dialogue"
  | "transcription"
  | "translation"
  | "dubbing"
  | "batch";

export interface HistorySubtitleCue {
  index: number;
  time: string;
  text: string;
  startSec?: number;
  endSec?: number;
}

export interface HistoryArtifactItem {
  id: string;
  fileName: string;
  filePath: string;
  fileSize?: string;
  duration?: string;
  format?: string; // e.g. "WAV", "MP3", "SRT", "VTT"
  type: "audio" | "subtitle" | "text" | "video";
  task: "tts" | "dialogue" | "transcription" | "translation" | "dubbing";
  label?: string; // e.g. "Audio Master", "Phụ đề gốc", "Bản dịch SRT", "Audio Lồng tiếng"
  existsOnDisk: boolean; // if false, warning state: missing file
  cues?: HistorySubtitleCue[];
  audioDurationSec?: number;
  isTimelineSynced?: boolean; // if true, cue timestamps accurately match audio
}

export interface UnifiedHistoryItem {
  id: string;
  title: string; // Source file name or job title (e.g. "video_gioi_thieu.mp4")
  sourceFilePath?: string;
  sourceFileSize?: string;
  category: HistoryTaskCategory;
  isBatch: boolean;
  tasks: ("tts" | "dialogue" | "transcription" | "translation" | "dubbing")[]; // Multi-task tag array
  createdAt: string; // Human display string e.g. "Hôm nay, 14:32"
  timestamp: number; // Raw epoch for accurate newest-first sorting
  status: HistoryItemStatus;
  statusWarning?: string; // Optional warning explanation
  duration?: string;
  chunkCount?: number;
  outputDirectory: string;
  artifacts: HistoryArtifactItem[];
  runId?: string; // Differentiates retried / re-exported runs without overwriting old history
}

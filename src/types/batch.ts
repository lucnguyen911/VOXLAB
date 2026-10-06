/**
 * VoxLab — Batch Processing Domain Types & State Models
 * Specification: SPEC-batch.md v3.2.0 (Gate D Approved)
 * Architecture: File-Centric Multi-Task Batch Orchestrator
 */

// 1. Task Types & Matrix
export type BatchTaskType = "tts" | "dialogue" | "transcription" | "translation" | "dubbing";

export type BatchFileKind = "text" | "media" | "subtitle";

/**
 * Phương thức thực thi tạo phụ đề (Subtitle Execution Mode)
 * - "media_asr": Dùng Whisper/ASR bóc băng âm thanh (chỉ áp dụng cho file Media)
 * - "synthesized_timing": Dùng thời lượng audio thực tế của TTS / Hội thoại (cho file Text)
 * - "imported_subtitle": Tái sử dụng timeline có sẵn từ tệp SRT/VTT nguồn
 */
export type BatchSubtitleMode = "media_asr" | "synthesized_timing" | "imported_subtitle";

// 2. Lifecycle Statuses

/**
 * Trạng thái cấp Bước Tác vụ (Step-Level Status - 8 trạng thái chuẩn)
 */
export type BatchStepStatus =
  | "waiting"                 // Đang chờ đến lượt trong chuỗi thực thi
  | "processing"              // Đang tích cực chạy bước này
  | "completed"               // Bước này hoàn tất 100%, artifact đã atomic commit
  | "completed_with_warning"  // Bước này hoàn tất có cảnh báo (ví dụ WSOLA collision danger)
  | "failed"                  // Bước này gặp lỗi kỹ thuật
  | "skipped"                 // Bị bỏ qua do conditional step không cần thiết hoặc bước trước lỗi
  | "cancelled"               // Bị người dùng chủ động hủy sau khi worker an toàn thoát
  | "interrupted";            // Bị gián đoạn do app tắt đột ngột/crash khi đang processing

/**
 * Trạng thái của toàn bộ Job (Job-Level Status - 9 trạng thái chuẩn)
 */
export type BatchJobStatus =
  | "waiting"                 // Đang chờ trong hàng đợi
  | "processing"              // Đang có ít nhất 1 step đang chạy
  | "paused"                  // Hàng đợi đang tạm dừng
  | "completed"               // Toàn bộ chuỗi task đã hoàn tất thành công 100%
  | "completed_with_warning"  // Hoàn tất nhưng có ít nhất 1 bước hoàn tất có cảnh báo
  | "failed_with_artifact"    // Bước sau lỗi nhưng các bước trước đã commit artifact thành công
  | "failed"                  // Lỗi ngay từ bước đầu tiên hoặc không có artifact nào hợp lệ
  | "cancelled"               // Job bị người dùng chủ động hủy
  | "interrupted";            // Gián đoạn do crash hoặc app bị tắt giữa chừng

/**
 * Trạng thái của Hàng đợi (Queue-Level Status - 6 trạng thái chuẩn)
 */
export type BatchQueueStatus =
  | "idle"                    // Không có job nào đang chạy
  | "running"                 // Hàng đợi đang tích cực điều phối job
  | "pausing"                 // Đang đợi active step an toàn nhường quyền để tạm dừng
  | "paused"                  // Đã tạm dừng hoàn toàn
  | "cancelling"              // Đang đợi active worker ngắt an toàn để hủy
  | "blocked";                // Bị chặn do lỗi hệ thống (hết đĩa, thiếu quyền ghi,...)

/**
 * 4 Khung nhìn thống nhất (4 Unified Workspace Views)
 */
export type BatchViewTab = "list" | "queued" | "completed" | "failed";
export type BatchWorkspaceView = BatchViewTab;

/**
 * Giai đoạn vòng đời của tệp tin (Staged Lifecycle)
 * - "staging": Đang nằm ở tab Danh sách để chuẩn bị, cấu hình
 * - "queued": Đã được chuyển sang Hàng đợi để xếp lượt thực thi
 */
export type BatchJobStage = "staging" | "queued";

/**
 * Hành động CTA động 3 nhánh tại tab Lỗi
 */
export type BatchDynamicCtaType = "retry" | "regenerate" | "reexport";

/**
 * Trạng thái checkbox đầu bảng (Tri-state Header Checkbox)
 */
export type HeaderSelectionState = "none" | "partial" | "all";

// 3. Step Results & Artifacts

export interface BatchStepResult {
  task: BatchTaskType;
  status: BatchStepStatus;
  progressPct: number;
  stageMessage?: string;
  outputArtifactPaths: string[]; // Các artifact sinh ra bởi riêng bước này
  error?: string;
  warning?: string;
  skipReason?: string;          // Ví dụ: "Không cần dịch vì ngôn ngữ nguồn trùng ngôn ngữ đích."
  startedAt?: number;
  completedAt?: number;
}

export interface ArtifactVersionMetadata {
  path: string;
  size: number;
  mtime: number;
  hash?: string;
}

export interface BatchJobOutputArtifacts {
  primaryPath?: string;
  secondaryPath?: string;
  warningMessage?: string;
  ownedArtifactPaths: string[];
  artifactFingerprints?: Record<string, ArtifactVersionMetadata>;
  stale?: boolean;              // True nếu file nguồn bị sửa đổi ngoài app sau khi đã commit
}

// 4. Snapshots & Configuration Models

export interface BatchTtsSnapshot {
  model: string;
  voiceId: string;
  speed: number;
  pitch: number;
  volume: number;
  sentencePauseMs?: number;
  emotion?: string;
}

export interface BatchDialogueSnapshot {
  model: string;
  defaultVoiceId: string;
  turnPauseSec: number;
  sameSpeakerPauseSec: number;
  exportSrt: boolean;
  characterVoices?: Record<string, string>; // Mapping: Tên nhân vật -> voiceId
}

export interface BatchTranscriptionSnapshot {
  audioLanguage: string;
  whisperModel: string;
  speechSpeed: 1.0 | 0.9 | 0.8;
  outputFormat: "srt" | "vtt";
  subtitleMode?: BatchSubtitleMode;
}

export interface BatchTranslationSnapshot {
  providerId: string;
  sourceLanguage?: string;
  targetLanguage: string;
  style: "default" | "cinema";
  outputFormat: "preserve_input" | "srt" | "vtt";
}

export interface BatchDubbingSnapshot {
  ttsModel: string;
  voiceId: string;
  speedMultiplier: number;
  turnPauseSec: number;
}

export interface BatchTaskConfigMap {
  tts?: BatchTtsSnapshot;
  dialogue?: BatchDialogueSnapshot;
  transcription?: BatchTranscriptionSnapshot;
  translation?: BatchTranslationSnapshot;
  dubbing?: BatchDubbingSnapshot;
}

export type BatchCollisionPolicy = "auto_rename" | "overwrite" | "skip";

export interface BatchJobOutputSnapshot {
  resolvedOutputDirectory: string;
  saveInSourceFolder: boolean;
  collisionPolicy: BatchCollisionPolicy;
  outputAudioFormat?: "wav" | "mp3";
  outputSubtitleFormat?: "srt" | "vtt";
}

/**
 * Đóng gói toàn bộ cấu hình hiệu lực tại thời điểm freeze
 */
export interface BatchEffectiveConfigSnapshot {
  tasks: BatchTaskConfigMap;
  output: BatchJobOutputSnapshot;
}

// 5. Config Diff & Invalidation

export interface ConfigDiffResult {
  hasChanged: boolean;
  aiConfigChanged: boolean;
  outputConfigChanged: boolean;
  changedTasks: BatchTaskType[];
  changedFields: string[];
  invalidatedFromStep?: BatchTaskType; // Bước đầu tiên cần chạy lại theo Config Invalidation Graph
  canReuseArtifacts: boolean;         // True nếu chỉ đổi output directory/format và artifact trung gian hợp lệ
  recommendedCta: BatchDynamicCtaType;
}

// 6. Main BatchJob State

export interface BatchJob {
  id: string;
  sourceFilePath: string;
  sourceFileName: string;
  sourceFileSize: number;
  sourceFileMtime: number;
  fileKind: BatchFileKind;
  subtitleMode?: BatchSubtitleMode;

  // Staged Lifecycle Stage & Queue Order
  stage: BatchJobStage;              // "staging" = Tab Danh sách; "queued" = Tab Hàng đợi / Đang chạy
  queueOrder: number;                // Thứ tự thực thi trong Hàng đợi (số nguyên dương, điều chỉnh tăng/giảm bằng nút ↑ / ↓)

  // Task Matrix & Sequence
  selectedTasks: BatchTaskType[];
  executionSequence: BatchTaskType[];
  currentStepIndex: number;

  // Cấu hình overrides và Snapshot bất biến khi chạy
  configOverrides: Partial<BatchTaskConfigMap>;
  effectiveConfigSnapshot?: BatchEffectiveConfigSnapshot;
  hasCustomConfig: boolean;

  // Trạng thái cấu hình phái sinh (Derived State - tính toán realtime khi render / check)
  configChanged?: boolean;           // Derived: true nếu jobWorkingConfig khác effectiveConfigSnapshot
  invalidatedFromStep?: BatchTaskType;
  dynamicCta?: BatchDynamicCtaType;

  // Trạng thái từng bước: Chỉ chứa các task được chọn (Unselected tasks KHÔNG tồn tại trong map)
  stepResults: Partial<Record<BatchTaskType, BatchStepResult>>;

  // Trạng thái tổng thể
  status: BatchJobStatus;
  progressPct: number;
  isCancelling?: boolean;            // Transient runtime/UI flag, tuyệt đối KHÔNG serialize vào state bền vững

  // Output & Artifacts
  outputSnapshot: BatchJobOutputSnapshot;
  artifacts: BatchJobOutputArtifacts;
  retryFromStep?: BatchTaskType;

  // Timestamps & Diagnostics
  createdAt: number;
  queuedAt?: number;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
  warningMessage?: string;
}

// 7. Session Settings & Durable State v3

export interface BatchSessionSettings {
  outputDirectory: string;
  saveInSourceFolder: boolean;
  collisionPolicy: "auto_rename" | "overwrite" | "skip";
  outputAudioFormat?: "wav" | "mp3";
  outputSubtitleFormat?: "srt" | "vtt";
  globalDefaults: BatchTaskConfigMap;
}

export interface BatchQueueDurableState {
  version: 3; // Schema version 3
  queueStatus: BatchQueueStatus;
  settings: BatchSessionSettings;
  jobs: BatchJob[];
  updatedAt: number;
}

// 8. Compatibility & Validator Types

export interface BatchTaskCompatibility {
  isCompatible: boolean;
  reason?: string;
}

export interface BatchFileCompatibilityReport {
  fileKind: BatchFileKind;
  isCompatible: boolean;
  reason?: string;
  isDialogueScript: boolean;
  dialogueCharacterCount: number;
  tasks: Record<BatchTaskType, BatchTaskCompatibility>;
}

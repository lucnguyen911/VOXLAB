import React from "react";
import {
  FileText,
  Video,
  FileCode,
  ArrowUp,
  ArrowDown,
  Pause,
  Play,
  X,
  Lock,
} from "lucide-react";
import { BatchJob, BatchFileKind } from "../../types/batch";
import { BatchFooter } from "../../components/batch/BatchFooter";

export interface QueueReorderTableProps {
  jobs: BatchJob[];
  onMoveJob: (jobId: string, direction: "up" | "down") => void;
  onPauseJob?: (jobId: string) => void;
  onResumeJob?: (jobId: string) => void;
  onCancelJob: (jobId: string) => void;
}

const renderFileIcon = (fileKind: BatchFileKind) => {
  switch (fileKind) {
    case "text":
      return <FileText className="w-4 h-4 text-emerald-400 shrink-0" />;
    case "media":
      return <Video className="w-4 h-4 text-sky-400 shrink-0" />;
    case "subtitle":
      return <FileCode className="w-4 h-4 text-amber-400 shrink-0" />;
    default:
      return <FileText className="w-4 h-4 text-textMuted shrink-0" />;
  }
};

export const QueueReorderTable: React.FC<QueueReorderTableProps> = ({
  jobs,
  onMoveJob,
  onPauseJob,
  onResumeJob,
  onCancelJob,
}) => {
  // Sort: processing job pinned at top, then waiting jobs sorted by queueOrder
  const sortedJobs = [...jobs].sort((a, b) => {
    if (a.status === "processing") return -1;
    if (b.status === "processing") return 1;
    return a.queueOrder - b.queueOrder;
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface1">
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[960px] text-left border-collapse table-fixed border-b border-borderDefault">
          <thead className="sticky top-0 bg-surface2 border-b border-borderDefault z-20 text-[13px] font-bold text-textSecondary">
            <tr>
              {/* Column 1: Order / Pin */}
              <th className="py-2.5 px-3 w-[10%] text-center border-r border-borderDefault">
                <div className="flex items-center justify-center min-h-[46px]">Thứ tự</div>
              </th>

              {/* Column 2: File Name */}
              <th className="py-2.5 px-3.5 w-[28%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                <div className="flex items-center justify-center min-h-[46px]">Tên tệp</div>
              </th>

              {/* Column 3: Workflow Sequence & Step Progress */}
              <th className="py-2.5 px-3 w-[32%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                <div className="flex items-center justify-center min-h-[46px]">Chuỗi tác vụ</div>
              </th>

              {/* Column 4: Status / Progress Bar */}
              <th className="py-2.5 px-3 w-[18%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                <div className="flex items-center justify-center min-h-[46px]">Tiến độ</div>
              </th>

              {/* Column 5: Actions */}
              <th className="py-2.5 px-2 w-[12%] text-center text-sm font-bold text-textPrimary">
                <div className="flex items-center justify-center min-h-[46px]">Thao tác</div>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-borderDefault text-xs">
            {sortedJobs.map((job, index) => {
              const isProcessing = job.status === "processing";
              const isWaiting = job.status === "waiting";
              const isPaused = job.status === "paused";

              return (
                <tr
                  key={job.id}
                  className={`transition-colors ${
                    isProcessing
                      ? "bg-accent/10 border-l-2 border-l-accent"
                      : "hover:bg-surface2/50"
                  }`}
                >
                  {/* Column 1: Priority Order / Pinned Badge */}
                  <td className="py-3 px-3 text-center border-r border-borderDefault">
                    <div className="flex items-center justify-center gap-1.5">
                      {isProcessing ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent text-slate-950">
                          <Lock className="w-3 h-3" />
                          <span>Đang chạy</span>
                        </span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="font-mono font-bold text-textSecondary w-5 text-center">
                            {index + 1}
                          </span>
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => onMoveJob(job.id, "up")}
                              disabled={index <= (sortedJobs[0]?.status === "processing" ? 1 : 0)}
                              className="p-0.5 rounded hover:bg-surface3 text-textMuted hover:text-textPrimary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                              title="Tăng thứ tự ưu tiên"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onMoveJob(job.id, "down")}
                              disabled={index >= sortedJobs.length - 1}
                              className="p-0.5 rounded hover:bg-surface3 text-textMuted hover:text-textPrimary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                              title="Giảm thứ tự ưu tiên"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Column 2: File Name */}
                  <td className="py-3 px-3.5 border-r border-borderDefault">
                    <div className="flex items-center gap-2 min-w-0">
                      {renderFileIcon(job.fileKind)}
                      <div className="min-w-0">
                        <div
                          className="font-semibold text-textPrimary truncate"
                          title={job.sourceFileName}
                        >
                          {job.sourceFileName}
                        </div>
                        <div className="text-[10px] text-textMuted font-mono truncate">
                          {(job.sourceFileSize / 1024).toFixed(0)} KB • {job.sourceFilePath}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Column 3: Workflow Buttons with Step Status */}
                  <td className="py-3 px-3 border-r border-borderDefault">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {job.executionSequence.map((task) => {
                        const step = job.stepResults[task];
                        const stepStatus = step?.status || "waiting";
                        const stepProgress = step?.progressPct || 0;

                        let badgeColor = "bg-surface2 text-textMuted border-borderDefault";
                        if (stepStatus === "processing") {
                          badgeColor = "bg-accent/20 text-accent border-accent/40 font-bold";
                        } else if (stepStatus === "completed") {
                          badgeColor = "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
                        } else if (stepStatus === "completed_with_warning") {
                          badgeColor = "bg-amber-500/15 text-amber-400 border-amber-500/30";
                        } else if (stepStatus === "failed") {
                          badgeColor = "bg-rose-500/15 text-rose-400 border-rose-500/30";
                        }

                        const taskName =
                          task === "tts"
                            ? "TTS"
                            : task === "dialogue"
                            ? "Hội thoại"
                            : task === "transcription"
                            ? "Phụ đề"
                            : task === "translation"
                            ? "Dịch"
                            : "Lồng tiếng";

                        return (
                          <div
                            key={task}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border flex items-center gap-1 ${badgeColor}`}
                          >
                            <span>{taskName}</span>
                            {stepStatus === "processing" && (
                              <span className="font-mono text-[9px]">{stepProgress}%</span>
                            )}
                            {stepStatus === "completed" && <span>✓</span>}
                          </div>
                        );
                      })}
                    </div>
                  </td>

                  {/* Column 4: Progress Bar */}
                  <td className="py-3 px-3 border-r border-borderDefault">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-textSecondary font-medium">
                          {isProcessing
                            ? "Đang chạy"
                            : isPaused
                            ? "Tạm dừng"
                            : isWaiting
                            ? "Đang chờ"
                            : job.status}
                        </span>
                        <span className="font-mono font-bold text-textPrimary">
                          {job.progressPct}%
                        </span>
                      </div>
                      <div className="w-full bg-surface2 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isProcessing
                              ? "bg-accent"
                              : isPaused
                              ? "bg-amber-400"
                              : "bg-surface3"
                          }`}
                          style={{ width: `${Math.max(2, job.progressPct)}%` }}
                        />
                      </div>
                    </div>
                  </td>

                  {/* Column 5: Actions */}
                  <td className="py-3 px-2 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {isProcessing && onPauseJob && (
                        <button
                          type="button"
                          onClick={() => onPauseJob(job.id)}
                          className="p-1 rounded text-amber-400 hover:bg-amber-500/10 cursor-pointer"
                          title="Tạm dừng tệp này"
                        >
                          <Pause className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {isPaused && onResumeJob && (
                        <button
                          type="button"
                          onClick={() => onResumeJob(job.id)}
                          className="p-1 rounded text-accent hover:bg-accent/10 cursor-pointer"
                          title="Tiếp tục xử lý"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onCancelJob(job.id)}
                        className="p-1 rounded text-textMuted hover:text-danger hover:bg-danger/10 cursor-pointer"
                        title="Hủy khỏi hàng đợi"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Shared BatchFooter Status Bar (AC-43) */}
      <BatchFooter totalCount={jobs.length} />
    </div>
  );
};

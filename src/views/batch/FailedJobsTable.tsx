import React from "react";
import {
  FileText,
  Video,
  FileCode,
  RotateCcw,
  Zap,
  FolderOpen,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { BatchJob, BatchFileKind, ConfigDiffResult } from "../../types/batch";
import { BatchFooter } from "../../components/batch/BatchFooter";

export interface FailedJobsTableProps {
  jobs: BatchJob[];
  getJobDiff: (job: BatchJob) => ConfigDiffResult;
  onRetry: (jobId: string) => void;
  onRegenerate: (jobId: string) => void;
  onReexport: (jobId: string) => void;
  onRetryAll: () => void;
  onOpenDrawer?: (job: BatchJob) => void;
  onDeleteJob?: (jobId: string) => void;
  onClearFailedJobs?: () => void;
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

export const FailedJobsTable: React.FC<FailedJobsTableProps> = ({
  jobs,
  getJobDiff,
  onRetry,
  onRegenerate,
  onReexport,
  onRetryAll,
  onDeleteJob,
  onClearFailedJobs,
}) => {
  return (
    <div className="@container flex-1 flex flex-col min-h-0 overflow-hidden bg-surface1">
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[640px] text-left border-collapse table-fixed border-b border-borderDefault">
          <thead className="sticky top-0 bg-surface2 border-b border-borderDefault z-20 text-[13px] font-bold text-textSecondary">
            <tr>
              <th className="py-2.5 px-2 w-[42px] @[960px]:w-[48px] text-center border-r border-borderDefault overflow-hidden">#</th>
              <th className="py-2.5 px-3.5 w-auto text-center border-r border-borderDefault text-sm font-bold text-textPrimary overflow-hidden">
                Tên tệp
              </th>
              <th className="py-2.5 px-2 w-[104px] @[920px]:w-[124px] text-center border-r border-borderDefault text-sm font-bold text-textPrimary overflow-hidden">
                Bước lỗi
              </th>
              <th className="py-2.5 px-3 w-[30%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary overflow-hidden">
                Chi tiết sự cố
              </th>
              <th className="py-2.5 px-2 w-[116px] @[920px]:w-[148px] text-center border-r border-borderDefault text-sm font-bold text-textPrimary overflow-hidden">
                <span className="@[920px]:hidden">Khôi phục</span>
                <span className="hidden @[920px]:inline">Hành động khôi phục</span>
              </th>
              <th className="py-2.5 px-2 w-[56px] @[920px]:w-[76px] text-center text-sm font-bold text-textPrimary overflow-hidden">
                <span className="@[920px]:hidden">Xóa</span>
                <span className="hidden @[920px]:inline">Thao tác</span>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-borderDefault text-xs">
            {jobs.map((job, index) => {
              const diff = getJobDiff(job);
              const failedTask =
                job.retryFromStep ||
                Object.values(job.stepResults).find((s) => s?.status === "failed")?.task ||
                job.executionSequence[job.currentStepIndex] ||
                job.selectedTasks[0] ||
                "tts";

              return (
                <tr key={job.id} className="hover:bg-surface2/50 transition-colors">
                  <td className="py-3 px-2 text-center text-textMuted font-mono border-r border-borderDefault overflow-hidden">
                    {index + 1}
                  </td>

                  {/* File Name */}
                  <td className="py-3 px-3.5 border-r border-borderDefault overflow-hidden">
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
                          {job.sourceFilePath}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Failed Step */}
                  <td className="py-3 px-2 border-r border-borderDefault text-center overflow-hidden">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 whitespace-nowrap">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>
                        {failedTask === "tts"
                          ? "TTS"
                          : failedTask === "dialogue"
                          ? "Hội thoại"
                          : failedTask === "transcription"
                          ? "Phụ đề"
                          : failedTask === "translation"
                          ? "Dịch"
                          : "Lồng tiếng"}
                      </span>
                    </span>
                  </td>

                  {/* Error Message */}
                  <td className="py-3 px-3 border-r border-borderDefault overflow-hidden">
                    <div
                      className="text-textSecondary text-xs leading-relaxed truncate"
                      title={job.errorMessage || "Lỗi xử lý tác vụ"}
                    >
                      {job.errorMessage || "Sự cố kỹ thuật trong quá trình xử lý."}
                    </div>
                  </td>

                  {/* 3-Way Dynamic CTA Button */}
                  <td className="py-3 px-2 border-r border-borderDefault text-center overflow-hidden">
                    <div className="flex items-center justify-center">
                      {diff.recommendedCta === "retry" && (
                        <button
                          type="button"
                          onClick={() => onRetry(job.id)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 @[920px]:px-3 @[920px]:py-1.5 text-xs font-semibold rounded-lg bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault transition-colors cursor-pointer whitespace-nowrap"
                          title="Tái sử dụng cấu hình cũ, chạy tiếp từ bước lỗi"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-textMuted shrink-0" />
                          <span>Thử lại</span>
                        </button>
                      )}

                      {diff.recommendedCta === "regenerate" && (
                        <button
                          type="button"
                          onClick={() => onRegenerate(job.id)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 @[920px]:px-3 @[920px]:py-1.5 text-xs font-bold rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-colors cursor-pointer whitespace-nowrap"
                          title="Áp dụng cấu hình mới và chạy lại từ bước bị ảnh hưởng"
                        >
                          <Zap className="w-3.5 h-3.5 fill-current shrink-0" />
                          <span>Tạo lại</span>
                        </button>
                      )}

                      {diff.recommendedCta === "reexport" && (
                        <button
                          type="button"
                          onClick={() => onReexport(job.id)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 @[920px]:px-3 @[920px]:py-1.5 text-xs font-bold rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-colors cursor-pointer whitespace-nowrap"
                          title="Xuất lại sang đích hoặc định dạng mới (0 chạy lại AI)"
                        >
                          <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                          <span>Xuất lại</span>
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Delete Button */}
                  <td className="py-3 px-2 text-center overflow-hidden">
                    <div className="flex items-center justify-center gap-1.5">
                      {onDeleteJob && (
                        <button
                          type="button"
                          onClick={() => onDeleteJob(job.id)}
                          className="p-1 rounded text-textMuted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer shrink-0"
                          title="Xóa tệp khỏi danh sách lỗi"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Shared BatchFooter Status Bar (AC-43) */}
      <BatchFooter
        totalCount={jobs.length}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRetryAll}
              disabled={jobs.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-accent hover:bg-accent/10 border border-accent/30 transition-all cursor-pointer disabled:opacity-40"
              title="Thử lại tất cả tệp lỗi"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Thử lại tất cả</span>
            </button>
            {onClearFailedJobs && (
              <button
                type="button"
                onClick={onClearFailedJobs}
                disabled={jobs.length === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-danger/80 hover:text-danger bg-danger/5 hover:bg-danger/10 border border-danger/20 hover:border-danger/30 transition-all cursor-pointer disabled:opacity-40"
                title="Dọn dẹp toàn bộ danh sách lỗi"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Dọn dẹp</span>
              </button>
            )}
          </div>
        }
      />
    </div>
  );
};

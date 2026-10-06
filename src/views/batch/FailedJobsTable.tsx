import React from "react";
import {
  FileText,
  Video,
  FileCode,
  RotateCcw,
  Zap,
  FolderOpen,
  Sliders,
  AlertTriangle,
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
  onOpenDrawer: (job: BatchJob) => void;
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
  onOpenDrawer,
}) => {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface1">
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[960px] text-left border-collapse table-fixed border-b border-borderDefault">
          <thead className="sticky top-0 bg-surface2 border-b border-borderDefault z-20 text-[13px] font-bold text-textSecondary">
            <tr>
              <th className="py-2.5 px-3 w-[4%] text-center border-r border-borderDefault">#</th>
              <th className="py-2.5 px-3.5 w-[26%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                Tên tệp
              </th>
              <th className="py-2.5 px-3 w-[15%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                Bước lỗi
              </th>
              <th className="py-2.5 px-3 w-[30%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                Chi tiết sự cố
              </th>
              <th className="py-2.5 px-2 w-[15%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                Hành động khôi phục
              </th>
              <th className="py-2.5 px-2 w-[10%] text-center text-sm font-bold text-textPrimary">
                Tùy chỉnh
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-borderDefault text-xs">
            {jobs.map((job, index) => {
              const diff = getJobDiff(job);
              const failedTask = job.retryFromStep || "tts";

              return (
                <tr key={job.id} className="hover:bg-surface2/50 transition-colors">
                  <td className="py-3 px-3 text-center text-textMuted font-mono border-r border-borderDefault">
                    {index + 1}
                  </td>

                  {/* File Name */}
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
                          {job.sourceFilePath}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Failed Step */}
                  <td className="py-3 px-3 border-r border-borderDefault text-center">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                      <AlertTriangle className="w-3 h-3" />
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
                  <td className="py-3 px-3 border-r border-borderDefault">
                    <div
                      className="text-textSecondary text-xs leading-relaxed truncate"
                      title={job.errorMessage || "Lỗi xử lý tác vụ"}
                    >
                      {job.errorMessage || "Sự cố kỹ thuật trong quá trình xử lý."}
                    </div>
                  </td>

                  {/* 3-Way Dynamic CTA Button */}
                  <td className="py-3 px-2 border-r border-borderDefault text-center">
                    <div className="flex items-center justify-center">
                      {diff.recommendedCta === "retry" && (
                        <button
                          type="button"
                          onClick={() => onRetry(job.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault transition-colors cursor-pointer"
                          title="Tái sử dụng cấu hình cũ, chạy tiếp từ bước lỗi"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-textMuted" />
                          <span>Thử lại</span>
                        </button>
                      )}

                      {diff.recommendedCta === "regenerate" && (
                        <button
                          type="button"
                          onClick={() => onRegenerate(job.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-colors cursor-pointer"
                          title="Áp dụng cấu hình mới và chạy lại từ bước bị ảnh hưởng"
                        >
                          <Zap className="w-3.5 h-3.5 fill-current" />
                          <span>Tạo lại</span>
                        </button>
                      )}

                      {diff.recommendedCta === "reexport" && (
                        <button
                          type="button"
                          onClick={() => onReexport(job.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-colors cursor-pointer"
                          title="Xuất lại sang đích hoặc định dạng mới (0 chạy lại AI)"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          <span>Xuất lại</span>
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Drawer Open Button */}
                  <td className="py-3 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => onOpenDrawer(job)}
                      className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-surface2 transition-colors cursor-pointer"
                      title="Mở cấu hình nâng cao để chỉnh sửa"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                    </button>
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
          <button
            type="button"
            onClick={onRetryAll}
            disabled={jobs.length === 0}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-accent hover:bg-accent/10 border border-accent/30 transition-all cursor-pointer disabled:opacity-40"
            title="Thử lại tất cả tệp lỗi"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Thử lại tất cả lỗi</span>
          </button>
        }
      />
    </div>
  );
};

import React from "react";
import {
  FileText,
  Video,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  FolderOpen,
  Eye,
  Trash2,
} from "lucide-react";
import { BatchJob, BatchFileKind } from "../../types/batch";
import { BatchFooter } from "../../components/batch/BatchFooter";
import { resolveJobOutputDirectory } from "../../services/batch/outputResolver";
import { showPathInFolder } from "../../services/batch/batchRuntime";

export interface CompletedJobsTableProps {
  jobs: BatchJob[];
  onInspectJob: (job: BatchJob) => void;
  onDeleteJob?: (jobId: string) => void;
  onClearCompletedJobs?: () => void;
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

export const CompletedJobsTable: React.FC<CompletedJobsTableProps> = ({
  jobs,
  onInspectJob,
  onDeleteJob,
  onClearCompletedJobs,
}) => {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface1">
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[960px] text-left border-collapse table-fixed border-b border-borderDefault">
          <thead className="sticky top-0 bg-surface2 border-b border-borderDefault z-20 text-[13px] font-bold text-textSecondary">
            <tr>
              {/* Column 1: # */}
              <th className="py-2.5 px-3 w-[4%] text-center border-r border-borderDefault">
                <div className="flex items-center justify-center min-h-[46px]">#</div>
              </th>

              {/* Column 2: File Name */}
              <th className="py-2.5 px-3.5 w-[26%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                <div className="flex items-center justify-center min-h-[46px]">Tên tệp</div>
              </th>

              {/* Column 3: Workflow Sequence */}
              <th className="py-2.5 px-3 w-[20%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                <div className="flex items-center justify-center min-h-[46px]">Chuỗi tác vụ</div>
              </th>

              {/* Column 4: Quality / QC Status */}
              <th className="py-2.5 px-3 w-[18%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                <div className="flex items-center justify-center min-h-[46px]">Chất lượng (QC)</div>
              </th>

              {/* Column 5: Output Artifacts */}
              <th className="py-2.5 px-3 w-[13%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                <div className="flex items-center justify-center min-h-[46px]">Kết quả xuất</div>
              </th>

              {/* Column 6: Actions */}
              <th className="py-2.5 px-2 w-[19%] text-center text-sm font-bold text-textPrimary">
                <div className="flex items-center justify-center min-h-[46px]">Thao tác</div>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-borderDefault text-xs">
            {jobs.map((job, index) => {
              const qcStep = job.stepResults.tts?.qcChunks?.length
                ? job.stepResults.tts
                : job.stepResults.dialogue?.qcChunks?.length
                ? job.stepResults.dialogue
                : job.stepResults.dubbing?.qcChunks?.length
                ? job.stepResults.dubbing
                : undefined;
              const errCount = qcStep?.qcStats?.errorCount ?? 0;
              const warnCount = qcStep?.qcStats?.warningCount ?? 0;
              const outputDir = resolveJobOutputDirectory(job);
              const artifactExts = Array.from(
                new Set(
                  job.artifacts.ownedArtifactPaths
                    .map((p) => {
                      const ext = p.split(".").pop()?.toLowerCase();
                      return ext ? `.${ext}` : "";
                    })
                    .filter(Boolean)
                )
              );

              const handleOpenJobFolder = () => {
                const targetPath = job.artifacts.ownedArtifactPaths[0] || outputDir;
                showPathInFolder(targetPath).catch((err) =>
                  console.error("Không thể mở thư mục:", err)
                );
              };

              return (
                <tr
                  key={job.id}
                  className={`transition-colors ${
                    errCount > 0
                      ? "bg-danger/5 hover:bg-danger/10"
                      : warnCount > 0 || job.warningMessage
                      ? "bg-warning/5 hover:bg-warning/10"
                      : "hover:bg-surface2/50"
                  }`}
                >
                  {/* Column 1: # */}
                  <td className="py-3 px-3 text-center text-textMuted font-mono border-r border-borderDefault">
                    {index + 1}
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
                        <div
                          className="text-[10px] text-textMuted font-mono truncate"
                          title={outputDir}
                        >
                          {(job.sourceFileSize / 1024).toFixed(0)} KB • {outputDir}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Column 3: Workflow Sequence */}
                  <td className="py-3 px-3 border-r border-borderDefault">
                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                      {job.executionSequence.map((task) => {
                        const step = job.stepResults[task];
                        const stepStatus = step?.status || "completed";

                        let badgeColor =
                          "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
                        if (stepStatus === "completed_with_warning") {
                          badgeColor = "bg-amber-500/15 text-amber-400 border-amber-500/30";
                        } else if (stepStatus === "skipped") {
                          badgeColor = "bg-surface2 text-textMuted border-borderDefault";
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
                            {stepStatus !== "skipped" && <span>✓</span>}
                          </div>
                        );
                      })}
                    </div>
                  </td>

                  {/* Column 4: Quality / QC Status */}
                  <td className="py-3 px-3 border-r border-borderDefault text-center">
                    <div className="flex flex-col items-center justify-center gap-1">
                      {qcStep ? (
                        errCount > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-danger/15 text-danger border border-danger/30">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            <span>
                              {errCount} đoạn lỗi
                              {warnCount > 0 ? `, ${warnCount} cảnh báo` : ""}
                            </span>
                          </span>
                        ) : warnCount > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning/15 text-warning border border-warning/30">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>{warnCount} đoạn cảnh báo</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                            <span>Đạt chuẩn ({qcStep.qcChunks?.length || 0} câu)</span>
                          </span>
                        )
                      ) : job.warningMessage ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning/15 text-warning border border-warning/30 max-w-full truncate"
                          title={job.warningMessage}
                        >
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span className="truncate">{job.warningMessage}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                          <span>Hoàn tất</span>
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Column 5: Output Artifacts */}
                  <td className="py-3 px-3 border-r border-borderDefault text-center">
                    <div className="font-mono font-semibold text-textPrimary">
                      {job.artifacts.ownedArtifactPaths.length} tệp
                    </div>
                    {artifactExts.length > 0 && (
                      <div className="text-[10px] text-textMuted font-mono truncate">
                        {artifactExts.join(", ")}
                      </div>
                    )}
                  </td>

                  {/* Column 6: Actions */}
                  <td className="py-3 px-2 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleOpenJobFolder}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-surface3 hover:bg-surface2 text-textPrimary border border-borderDefault transition-colors cursor-pointer whitespace-nowrap"
                        title="Mở thư mục lưu tệp kết quả xuất"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-accent shrink-0" />
                        <span>Mở thư mục</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onInspectJob(job)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                          errCount > 0
                            ? "bg-danger/15 hover:bg-danger/25 text-danger border-danger/35"
                            : warnCount > 0
                            ? "bg-warning/15 hover:bg-warning/25 text-warning border-warning/35"
                            : "bg-surface3 hover:bg-surface2 text-textPrimary border-borderDefault"
                        }`}
                        title="Xem chi tiết các tác vụ (TTS, Hội thoại, Phụ đề...), chỉnh sửa câu chữ, tạo lại câu cảnh báo và nghe thử"
                      >
                        <Eye className="w-3.5 h-3.5 shrink-0" />
                        <span>Chi tiết</span>
                      </button>

                      {onDeleteJob && (
                        <button
                          type="button"
                          onClick={() => onDeleteJob(job.id)}
                          className="p-1 rounded text-textMuted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                          title="Xóa tệp khỏi danh sách hoàn tất (không xóa tệp trên ổ đĩa)"
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
          onClearCompletedJobs ? (
            <button
              type="button"
              onClick={onClearCompletedJobs}
              disabled={jobs.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-danger/80 hover:text-danger bg-danger/5 hover:bg-danger/10 border border-danger/20 hover:border-danger/30 transition-all cursor-pointer disabled:opacity-40"
              title="Dọn dẹp danh sách các tệp đã hoàn tất (không xóa tệp đã xuất trên ổ đĩa)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Dọn dẹp</span>
            </button>
          ) : undefined
        }
      />
    </div>
  );
};

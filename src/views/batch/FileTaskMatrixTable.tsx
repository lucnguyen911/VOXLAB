import React from "react";
import {
  FileText,
  Video,
  FileCode,
  Sliders,
  Trash2,
} from "lucide-react";
import {
  BatchJob,
  BatchFileKind,
  BatchTaskType,
} from "../../types/batch";
import { TaskMatrixCell } from "./TaskMatrixCell";
import { BatchFooter } from "../../components/batch/BatchFooter";

export interface FileTaskMatrixTableProps {
  jobs: BatchJob[];
  selectedJobIds: Set<string>;
  onToggleSelectRow: (jobId: string) => void;
  onToggleSelectAll: () => void;
  isAllSelected: boolean;
  isIndeterminate: boolean;
  onToggleJobTask: (jobId: string, task: BatchTaskType) => void;
  onToggleAllColumnTask: (task: BatchTaskType) => void;
  isTaskAllEnabled: (task: BatchTaskType) => boolean;
  isTaskSomeEnabled: (task: BatchTaskType) => boolean;
  getTaskCompatibility: (
    job: BatchJob,
    task: BatchTaskType
  ) => { isCompatible: boolean; reason?: string };
  onOpenDrawer: (job: BatchJob) => void;
  onDeleteJob: (jobId: string) => void;
  onClearAllJobs: () => void;
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

export const FileTaskMatrixTable: React.FC<FileTaskMatrixTableProps> = ({
  jobs,
  selectedJobIds,
  onToggleSelectRow,
  onToggleSelectAll,
  isAllSelected,
  isIndeterminate,
  onToggleJobTask,
  onToggleAllColumnTask,
  isTaskAllEnabled,
  isTaskSomeEnabled,
  getTaskCompatibility,
  onOpenDrawer,
  onDeleteJob,
  onClearAllJobs,
}) => {
  const renderTaskHeader = (task: BatchTaskType, label: string) => {
    const isAll = isTaskAllEnabled(task);
    const isSome = isTaskSomeEnabled(task);

    return (
      <th className="py-2.5 px-2 w-[10%] text-center border-r border-borderDefault select-none">
        <div className="flex flex-col items-center justify-center gap-1 min-h-[46px]">
          <span className="text-xs font-bold text-textPrimary">{label}</span>
          <input
            type="checkbox"
            ref={(el) => {
              if (el) el.indeterminate = isSome && !isAll;
            }}
            checked={isAll}
            onChange={() => onToggleAllColumnTask(task)}
            className="w-3.5 h-3.5 rounded border-borderDefault text-accent accent-accent focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer"
            title={`Chọn / bỏ chọn tất cả ${label}`}
          />
        </div>
      </th>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface1">
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[960px] text-left border-collapse table-fixed border-b border-borderDefault">
          <thead className="sticky top-0 bg-surface2 border-b border-borderDefault z-20 text-[13px] font-bold text-textSecondary">
            <tr>
              {/* Column 1: Row Selection Checkbox */}
              <th className="py-2.5 px-2 w-[4%] text-center border-r border-borderDefault">
                <div className="flex items-center justify-center min-h-[46px]">
                  <input
                    type="checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = isIndeterminate;
                    }}
                    checked={isAllSelected}
                    onChange={onToggleSelectAll}
                    className="w-4 h-4 rounded border-borderDefault text-accent accent-accent focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer"
                    title={isAllSelected ? "Bỏ chọn tất cả" : "Chọn tất cả tệp"}
                  />
                </div>
              </th>

              {/* Column 2: Index */}
              <th className="py-2.5 px-2 w-[3.5%] text-center font-mono border-r border-borderDefault text-sm font-bold text-textSecondary">
                <div className="flex items-center justify-center min-h-[46px]">#</div>
              </th>

              {/* Column 3: File Name */}
              <th className="py-2.5 px-3.5 w-[26.5%] text-center border-r border-borderDefault text-sm font-bold text-textPrimary">
                <div className="flex items-center justify-center min-h-[46px]">Tên tệp</div>
              </th>

              {/* Column 4-8: 5 Task Columns */}
              {renderTaskHeader("tts", "TTS")}
              {renderTaskHeader("dialogue", "Hội thoại")}
              {renderTaskHeader("transcription", "Phụ đề")}
              {renderTaskHeader("translation", "Dịch")}
              {renderTaskHeader("dubbing", "Lồng tiếng")}

              {/* Column 9: Status / Config */}
              <th className="py-2.5 px-3 w-[10%] text-center border-r border-borderDefault text-xs font-bold text-textPrimary">
                <div className="flex items-center justify-center min-h-[46px]">Cấu hình</div>
              </th>

              {/* Column 10: Actions */}
              <th className="py-2.5 px-2 w-[6%] text-center text-xs font-bold text-textPrimary">
                <div className="flex items-center justify-center min-h-[46px]">Thao tác</div>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-borderDefault text-xs">
            {jobs.map((job, index) => {
              const isSelectedRow = selectedJobIds.has(job.id);
              const ttsCompat = getTaskCompatibility(job, "tts");
              const dialCompat = getTaskCompatibility(job, "dialogue");
              const asrCompat = getTaskCompatibility(job, "transcription");
              const transCompat = getTaskCompatibility(job, "translation");
              const dubCompat = getTaskCompatibility(job, "dubbing");

              return (
                <tr
                  key={job.id}
                  className={`transition-colors ${
                    isSelectedRow
                      ? "bg-accent/5 hover:bg-accent/10"
                      : "hover:bg-surface2/50"
                  }`}
                >
                  {/* Column 1: Row Checkbox */}
                  <td className="py-2.5 px-2 text-center border-r border-borderDefault">
                    <div className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={isSelectedRow}
                        onChange={() => onToggleSelectRow(job.id)}
                        className="w-4 h-4 rounded border-borderDefault text-accent accent-accent focus:ring-0 focus:outline-none focus-visible:outline-none outline-none ring-0 cursor-pointer"
                      />
                    </div>
                  </td>

                  {/* Column 2: Index */}
                  <td className="py-2.5 px-2 text-center text-[11px] text-textMuted font-mono border-r border-borderDefault">
                    {index + 1}
                  </td>

                  {/* Column 3: File Name & Warning */}
                  <td className="py-2.5 px-3.5 border-r border-borderDefault">
                    <div className="flex items-center gap-2 min-w-0">
                      {renderFileIcon(job.fileKind)}
                      <div className="min-w-0">
                        <div
                          className="font-semibold text-textPrimary truncate flex items-center gap-1.5"
                          title={job.sourceFileName}
                        >
                          <span className="truncate">{job.sourceFileName}</span>
                          {job.warningMessage && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.2 text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded shrink-0"
                              title={job.warningMessage}
                            >
                              {job.warningMessage}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-textMuted font-mono truncate">
                          {(job.sourceFileSize / 1024).toFixed(0)} KB • {job.sourceFilePath}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Column 4: TTS */}
                  <td className="py-2.5 px-2 text-center border-r border-borderDefault">
                    <TaskMatrixCell
                      job={job}
                      task="tts"
                      isCompatible={ttsCompat.isCompatible}
                      incompatibilityReason={ttsCompat.reason}
                      isSelected={job.selectedTasks.includes("tts")}
                      onToggle={() => onToggleJobTask(job.id, "tts")}
                    />
                  </td>

                  {/* Column 5: Dialogue */}
                  <td className="py-2.5 px-2 text-center border-r border-borderDefault">
                    <TaskMatrixCell
                      job={job}
                      task="dialogue"
                      isCompatible={dialCompat.isCompatible}
                      incompatibilityReason={dialCompat.reason}
                      isSelected={job.selectedTasks.includes("dialogue")}
                      onToggle={() => onToggleJobTask(job.id, "dialogue")}
                    />
                  </td>

                  {/* Column 6: Transcription */}
                  <td className="py-2.5 px-2 text-center border-r border-borderDefault">
                    <TaskMatrixCell
                      job={job}
                      task="transcription"
                      isCompatible={asrCompat.isCompatible}
                      incompatibilityReason={asrCompat.reason}
                      isSelected={job.selectedTasks.includes("transcription")}
                      onToggle={() => onToggleJobTask(job.id, "transcription")}
                    />
                  </td>

                  {/* Column 7: Translation */}
                  <td className="py-2.5 px-2 text-center border-r border-borderDefault">
                    <TaskMatrixCell
                      job={job}
                      task="translation"
                      isCompatible={transCompat.isCompatible}
                      incompatibilityReason={transCompat.reason}
                      isSelected={job.selectedTasks.includes("translation")}
                      onToggle={() => onToggleJobTask(job.id, "translation")}
                    />
                  </td>

                  {/* Column 8: Dubbing */}
                  <td className="py-2.5 px-2 text-center border-r border-borderDefault">
                    <TaskMatrixCell
                      job={job}
                      task="dubbing"
                      isCompatible={dubCompat.isCompatible}
                      incompatibilityReason={dubCompat.reason}
                      isSelected={job.selectedTasks.includes("dubbing")}
                      onToggle={() => onToggleJobTask(job.id, "dubbing")}
                    />
                  </td>

                  {/* Column 9: Config Status */}
                  <td className="py-2.5 px-3 text-center border-r border-borderDefault">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        job.hasCustomConfig
                          ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                          : "bg-surface3 text-textMuted"
                      }`}
                    >
                      {job.hasCustomConfig ? "Tùy chỉnh riêng" : "Kế thừa chung"}
                    </span>
                  </td>

                  {/* Column 10: Row Actions */}
                  <td className="py-2.5 px-2 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenDrawer(job)}
                        className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-surface2 transition-colors cursor-pointer"
                        title="Tùy chỉnh cấu hình riêng cho tệp này"
                      >
                        <Sliders className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteJob(job.id)}
                        className="p-1 rounded text-textMuted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                        title="Xóa tệp khỏi danh sách"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
      <BatchFooter
        totalCount={jobs.length}
        selectedCount={selectedJobIds.size}
        actions={
          <button
            type="button"
            onClick={onClearAllJobs}
            disabled={jobs.length === 0}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-danger/80 hover:text-danger bg-danger/5 hover:bg-danger/10 border border-danger/20 hover:border-danger/30 transition-all cursor-pointer disabled:opacity-40"
            title="Xóa toàn bộ tệp trong danh sách"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xóa danh sách</span>
          </button>
        }
      />
    </div>
  );
};

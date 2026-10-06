import React from "react";
import { BookOpen, Sparkles } from "lucide-react";

interface EmptyDialogueStateProps {
  onUseSample: () => void;
}

export const EmptyDialogueState: React.FC<EmptyDialogueStateProps> = ({
  onUseSample,
}) => {
  return (
    <div className="p-4 rounded-xl bg-surface1/60 border border-borderDefault/70 space-y-4 text-xs">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0 text-accent">
          <BookOpen className="w-4 h-4" />
        </div>
        <div>
          <h4 className="font-semibold text-textPrimary text-sm">
            Hướng dẫn
          </h4>
          <p className="text-[11px] text-textMuted">
            Tự động phát hiện và gán giọng đọc cho từng nhân vật trong kịch bản
          </p>
        </div>
      </div>

      <div className="space-y-3 pt-1">
        {/* Step 1 */}
        <div className="flex items-start gap-2.5">
          <span className="w-5 h-5 rounded-full bg-surface2 border border-borderDefault flex items-center justify-center text-[10px] font-mono font-bold text-accent shrink-0 mt-0.5">
            1
          </span>
          <div>
            <span className="font-semibold text-textPrimary block">
              Bước 1: Đặt tên nhân vật
            </span>
            <span className="text-[11px] text-textSecondary">
              Mở đầu câu thoại bằng định dạng <code className="text-accent bg-accent/10 px-1 py-0.5 rounded font-mono">[Tên]:</code> (Ví dụ: <code className="text-textPrimary bg-surface2 px-1 py-0.5 rounded font-mono">[An]: Chào bạn</code>)
            </span>
          </div>
        </div>

        {/* Step 2 */}
        <div className="flex items-start gap-2.5">
          <span className="w-5 h-5 rounded-full bg-surface2 border border-borderDefault flex items-center justify-center text-[10px] font-mono font-bold text-accent shrink-0 mt-0.5">
            2
          </span>
          <div>
            <span className="font-semibold text-textPrimary block">
              Bước 2: Hệ thống nhận diện
            </span>
            <span className="text-[11px] text-textSecondary">
              Danh sách nhân vật sẽ tự động xuất hiện tại đây ngay khi bạn gõ kịch bản.
            </span>
          </div>
        </div>

        {/* Step 3 */}
        <div className="flex items-start gap-2.5">
          <span className="w-5 h-5 rounded-full bg-surface2 border border-borderDefault flex items-center justify-center text-[10px] font-mono font-bold text-accent shrink-0 mt-0.5">
            3
          </span>
          <div>
            <span className="font-semibold text-textPrimary block">
              Bước 3: Chọn giọng & tùy chỉnh
            </span>
            <span className="text-[11px] text-textSecondary">
              Gán giọng đọc phù hợp từ thư viện, điều chỉnh tốc độ và cao độ cho từng vai.
            </span>
          </div>
        </div>
      </div>

      <div className="pt-2">
        <button
          type="button"
          onClick={onUseSample}
          className="w-full py-2 px-3 rounded-lg border border-dashed border-accent/40 bg-accent/5 hover:bg-accent/15 text-accent font-semibold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98]"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Sử dụng văn bản mẫu</span>
        </button>
      </div>
    </div>
  );
};

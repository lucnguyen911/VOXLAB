import React from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { VoiceProfile } from "../../types/ui";

interface DeleteVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  voice: VoiceProfile | null;
  onConfirmDelete: (voiceId: string) => void;
}

export const DeleteVoiceModal: React.FC<DeleteVoiceModalProps> = ({
  isOpen,
  onClose,
  voice,
  onConfirmDelete,
}) => {
  if (!isOpen || !voice) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-surface1 border border-borderDefault rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-borderDefault flex items-center justify-between bg-surface2/40">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertTriangle className="w-4 h-4" />
            <h3 className="text-sm font-bold text-textPrimary">Xác nhận xóa giọng</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-textMuted hover:text-textPrimary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-2 text-xs">
          <p className="text-textSecondary leading-relaxed">
            Bạn có chắc chắn muốn xóa giọng <strong className="text-textPrimary font-semibold">"{voice.name}"</strong>?
          </p>
          <p className="text-[11px] text-textMuted leading-relaxed">
            Mục này sẽ bị xóa vĩnh viễn khỏi danh sách giọng nhân bản và Thư viện giọng (Voice Library). Thao tác này không thể hoàn tác.
          </p>
        </div>

        {/* Actions */}
        <div className="px-5 py-3.5 border-t border-borderDefault flex items-center justify-end gap-2.5 bg-surface2/40">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-surface2 hover:bg-surface3 border border-borderDefault text-textSecondary hover:text-textPrimary rounded-lg text-xs font-medium transition-colors"
          >
            Hủy
          </button>
          <button
            onClick={() => {
              onConfirmDelete(voice.id);
              onClose();
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xóa giọng</span>
          </button>
        </div>
      </div>
    </div>
  );
};

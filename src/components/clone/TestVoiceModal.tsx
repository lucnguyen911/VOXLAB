import React, { useState } from "react";
import { X, Sparkles, Volume2, Mic, FolderOpen, AlertCircle, RefreshCw } from "lucide-react";
import { VoiceProfile } from "../../types/ui";
import {
  getSharedAiServices,
  readAudioFileBlobUrl,
  showPathInFolder,
} from "../../services/batch/batchRuntime";

interface TestVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  voice: VoiceProfile | null;
  onPlayTestTrack: (track: {
    id: string;
    voiceName: string;
    title: string;
    durationSec: number;
    audioUrl?: string;
    text?: string;
  }) => void;
}

export const TestVoiceModal: React.FC<TestVoiceModalProps> = ({
  isOpen,
  onClose,
  voice,
  onPlayTestTrack,
}) => {
  const [testText, setTestText] = useState(
    "Xin chào, đây là đoạn văn bản thử nghiệm để kiểm tra âm sắc và nhịp điệu của giọng nói vừa được nhân bản."
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressStage, setProgressStage] = useState<string>("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null);
  const [lastOutputPath, setLastOutputPath] = useState<string | null>(null);

  if (!isOpen || !voice) return null;

  const handleCancelTest = async () => {
    try {
      const ai = await getSharedAiServices();
      await ai?.cancelActive();
    } catch {}
    setIsGenerating(false);
    setProgressStage("Đã hủy");
  };

  const handleGenerateTest = async () => {
    if (!testText.trim()) return;

    setIsGenerating(true);
    setErrorText(null);
    setProgressStage("Bắt đầu khởi tạo...");
    try {
      const ai = await getSharedAiServices();
      if (!ai) throw new Error("Local AI runtime chưa khởi tạo.");

      const scratchDir = await ai.scratchPath("clone_test", "");
      const outputPath = `${scratchDir}\\test_${voice.id}_${Date.now()}.wav`;

      const res = await ai.synthesize({
        model: voice.engine || "omnivoice",
        voiceId: voice.id,
        text: testText,
        outputPath,
        language: voice.supportedLanguages.includes("vi") ? "vi" : "en",
        onProgress: (pct, stage) => {
          setProgressStage(`${stage} (${pct}%)`);
        },
      });

      const blobUrl = await readAudioFileBlobUrl(res.outputPath);
      setLastOutputPath(res.outputPath);

      // Trigger global bottom audio preview player with real audio!
      onPlayTestTrack({
        id: `test_${voice.id}_${Date.now()}`,
        voiceName: voice.name,
        title: `${voice.name} (Bản thử giọng)`,
        durationSec: res.durationSec,
        audioUrl: blobUrl,
        text: testText,
      });

      setLastGeneratedAt(new Date().toLocaleTimeString());
    } catch (err: any) {
      setErrorText(err?.message || "Lỗi khi tạo bản thử giọng.");
    } finally {
      setIsGenerating(false);
      setProgressStage("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-surface1 border border-borderDefault rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-borderDefault flex items-center justify-between bg-surface2/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-textPrimary">
                Thử giọng "{voice.name}"
              </h3>
              <p className="text-[11px] text-textMuted">
                Tạo một câu mẫu nhanh và nghe thử trên thanh phát âm thanh phía dưới
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-textMuted hover:text-textPrimary hover:bg-surface3 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Voice meta chips */}
          <div className="flex items-center gap-2 p-2.5 bg-surface2/60 rounded-lg border border-borderDefault">
            <span className="font-semibold text-textPrimary">{voice.name}</span>
            <span className="text-borderDefault">·</span>
            <span className="px-2 py-0.5 rounded bg-accent/15 text-accent font-medium text-[11px]">
              {voice.modelCompatibility?.[0] || voice.engine || "OmniVoice"}
            </span>
            <span className="text-textMuted text-[11px] ml-auto">
              {voice.supportedLanguages.includes("vi") ? "Tiếng Việt" : "Đa ngôn ngữ"}
            </span>
          </div>

          {/* Test Text Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-textSecondary font-medium">Nội dung câu nói thử nghiệm</label>
              <span className="text-[11px] text-textMuted">{testText.length} ký tự</span>
            </div>
            <textarea
              rows={3}
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              className="w-full bg-surface2 border border-borderDefault rounded-lg p-3 text-xs text-textPrimary focus:border-accent focus:outline-none resize-none leading-relaxed cursor-text caret-accent"
              placeholder="Nhập câu bạn muốn giọng đọc..."
            />
          </div>

          {errorText && (
            <div className="flex items-center gap-2 p-2.5 bg-danger/15 text-danger border border-danger/30 rounded-lg text-[11px]">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{errorText}</span>
            </div>
          )}

          {isGenerating && progressStage && (
            <div className="flex items-center gap-2 p-2.5 bg-accent/15 text-accent border border-accent/30 rounded-lg text-[11px]">
              <RefreshCw className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              <span>{progressStage}</span>
            </div>
          )}

          {lastGeneratedAt && (
            <div className="flex items-center justify-between p-2.5 bg-emerald-950/20 text-emerald-400 border border-emerald-800/30 rounded-lg text-[11px]">
              <div className="flex items-center gap-2">
                <Volume2 className="w-3.5 h-3.5 flex-shrink-0" />
                <span>
                  Đã tạo bản thử lúc {lastGeneratedAt}. Nghe thử trên thanh phát dưới đáy màn hình.
                </span>
              </div>
              {lastOutputPath && (
                <button
                  type="button"
                  onClick={() => showPathInFolder(lastOutputPath)}
                  className="flex items-center gap-1 px-2 py-0.5 bg-surface2 hover:bg-surface3 text-textPrimary rounded text-[11px] border border-borderDefault transition-colors cursor-pointer shrink-0"
                >
                  <FolderOpen className="w-3 h-3 text-accent" />
                  <span>Mở file</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-borderDefault flex items-center justify-between bg-surface2/40">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-surface2 hover:bg-surface3 border border-borderDefault text-textSecondary hover:text-textPrimary rounded-lg text-xs font-medium transition-colors"
          >
            Đóng
          </button>
          <div className="flex items-center gap-2">
            {isGenerating ? (
              <button
                type="button"
                onClick={handleCancelTest}
                className="flex items-center gap-1.5 px-4 py-2 bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30 rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Hủy</span>
              </button>
            ) : (
              <button
                onClick={handleGenerateTest}
                disabled={!testText.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-accent hover:bg-accent/90 text-background rounded-lg text-xs font-bold shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Tạo bản thử</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

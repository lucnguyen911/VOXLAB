import React from "react";
import { Mic, Volume2, RotateCcw } from "lucide-react";
import { DialogueCharacter } from "../../types/dialogue";
import { VoiceProfile } from "../../types/ui";

export interface CharacterCardProps {
  character: DialogueCharacter;
  assignedVoice?: VoiceProfile | null;
  isCustomVoice?: boolean;
  onSelectVoice: () => void;
  onUpdateSpeed: (speed: number) => void;
  onUpdatePitch: (pitch: number) => void;
  onTestVoice?: () => void;
  onReset?: () => void;
  disabled?: boolean;
}

export const CharacterCard: React.FC<CharacterCardProps> = ({
  character,
  assignedVoice,
  isCustomVoice = false,
  onSelectVoice,
  onUpdateSpeed,
  onUpdatePitch,
  onTestVoice,
  onReset,
  disabled = false,
}) => {
  const { colorTheme, name, segmentCount, speed, pitch } = character;
  const isCustomized = isCustomVoice || Math.abs(speed - 1.0) > 0.01 || Math.abs(pitch - 1.0) > 0.01;

  const handleReset = () => {
    if (onReset) {
      onReset();
    } else {
      onUpdateSpeed(1.0);
      onUpdatePitch(1.0);
    }
  };

  return (
    <div
      className="p-3 rounded-xl border border-l-[3.5px] transition-all bg-surface1/70 hover:bg-surface1 hover:shadow-xs space-y-2.5"
      style={{
        borderLeftColor: colorTheme.rawHex,
        borderColor: `${colorTheme.rawHex}35`,
      }}
    >
      {/* Top Header: Badge + Segment count + Reset + Mic action */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`px-2 py-0.5 rounded-md text-xs font-semibold tracking-wide truncate ${colorTheme.badgeClass}`}
            title={`[${name}]`}
          >
            [{name}]
          </span>
          <span className="text-[11px] text-textMuted whitespace-nowrap">
            Gồm {segmentCount} câu thoại
          </span>
        </div>

        <div className="flex items-center gap-1">
          {isCustomized && (
            <button
              type="button"
              disabled={disabled}
              onClick={handleReset}
              className="flex items-center gap-1 text-[10px] text-textMuted hover:text-accent transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-surface2 disabled:opacity-40 disabled:pointer-events-none"
              title="Đặt lại về mặc định"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>Đặt lại</span>
            </button>
          )}

          {onTestVoice && (
            <button
              type="button"
              onClick={onTestVoice}
              disabled={disabled || !assignedVoice}
              className="p-1.5 text-textMuted hover:text-accent hover:bg-surface2 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              title="Nghe thử giọng mẫu"
            >
              <Mic className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Voice Selection Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={onSelectVoice}
        className={`w-full py-2 px-3 rounded-lg border text-xs font-medium transition-all text-left flex items-center justify-between gap-2 cursor-pointer outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 disabled:opacity-50 disabled:cursor-not-allowed ${
          isCustomVoice
            ? "border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/15 text-purple-300 font-semibold"
            : assignedVoice
            ? "border-accent/40 bg-accent/5 hover:bg-accent/10 text-textPrimary"
            : "border-sky-500/40 bg-sky-500/5 hover:bg-sky-500/10 text-sky-400 font-semibold"
        }`}
      >
        <div className="flex items-center gap-2 truncate min-w-0">
          <Volume2 className="w-3.5 h-3.5 shrink-0" style={{ color: colorTheme.rawHex }} />
          <span className="truncate">
            {assignedVoice ? assignedVoice.name : "Chọn giọng nói"}
          </span>
        </div>
        {isCustomVoice && (
          <span className="text-[10px] font-bold text-purple-400 bg-purple-500/15 px-1.5 py-0.5 rounded border border-purple-500/30 shrink-0">
            Giọng riêng
          </span>
        )}
      </button>

      {/* Speed & Pitch Controls */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-textSecondary">
            <span>Tốc độ</span>
            <span
              className="font-mono font-semibold"
              style={{ color: speed !== 1.0 ? colorTheme.rawHex : undefined }}
            >
              {speed.toFixed(speed % 1 === 0 ? 0 : 1)}x
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            disabled={disabled}
            value={speed}
            onChange={(e) => onUpdateSpeed(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-surface3 rounded-full appearance-none cursor-pointer accent-accent disabled:opacity-40 disabled:cursor-not-allowed"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-textSecondary">
            <span>Cao độ</span>
            <span
              className="font-mono font-semibold"
              style={{ color: pitch !== 1.0 ? colorTheme.rawHex : undefined }}
            >
              {pitch.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            disabled={disabled}
            value={pitch}
            onChange={(e) => onUpdatePitch(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-surface3 rounded-full appearance-none cursor-pointer accent-accent disabled:opacity-40 disabled:cursor-not-allowed"
          />
        </div>
      </div>
    </div>
  );
};

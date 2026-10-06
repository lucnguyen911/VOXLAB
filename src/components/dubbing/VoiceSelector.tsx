import React, { useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { VoiceProfile } from "../../types/ui";
import { useI18n } from "../../i18n/context";
import {
  getVoiceLanguageInfo,
  normalizeAccent,
  getAccentLabel,
  getVoiceSecondaryTags,
} from "../../constants/voiceFilters";
import { CountryFlag } from "../common/CountryFlag";

const DUBBING_VOICE_STORAGE_KEY = "voxlab_dubbing_selected_voice";

export interface VoiceSelectorProps {
  voices: VoiceProfile[];
  selectedVoiceId: string;
  onSelectVoice: (id: string) => void;
  onOpenVoiceModal?: () => void;
  activeModel?: string;
  onChangeModel?: (model: string) => void;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  voices,
  selectedVoiceId,
  onSelectVoice,
  onOpenVoiceModal,
  activeModel = "Omni Voice",
  onChangeModel,
}) => {
  const { t, lang } = useI18n();

  // Sync with localStorage on load
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      const saved = localStorage.getItem(DUBBING_VOICE_STORAGE_KEY);
      if (saved && voices.some((v) => v.id === saved)) {
        if (saved !== selectedVoiceId) {
          onSelectVoice(saved);
        }
      } else if (!selectedVoiceId && voices.length > 0) {
        onSelectVoice(voices[0].id);
      }
    } catch {
      // ignore
    }
  }, [voices, selectedVoiceId, onSelectVoice]);

  // Persist selected voice
  useEffect(() => {
    if (typeof localStorage === "undefined" || !selectedVoiceId) return;
    try {
      localStorage.setItem(DUBBING_VOICE_STORAGE_KEY, selectedVoiceId);
    } catch {
      // ignore
    }
  }, [selectedVoiceId]);

  const selectedVoice =
    voices.find((v) => v.id === selectedVoiceId) || voices[0] || {
      id: "voice_01",
      name: "Thảo Trinh (Hà Nội)",
      gender: "female",
      language: "vi-VN",
      accent: "Bắc",
      avatarColor: "from-pink-500 to-rose-600",
    };

  return (
    <div className="space-y-3">
      {/* 1. GIỌNG LỒNG TIẾNG (Voice Card with Avatar, Name, Flag, Accent & "Đổi giọng >") */}
      <div className="space-y-1.5">
        <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
          {lang === "en" ? "Select Voice" : "Chọn giọng"}
        </label>
        <div
          id="dubbing-voice-picker-trigger"
          role="button"
          tabIndex={0}
          onClick={onOpenVoiceModal}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenVoiceModal?.();
            }
          }}
          className="p-3 bg-surface1 hover:bg-surface2/60 border border-borderDefault hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl transition-all cursor-pointer flex items-center justify-between gap-3 group shadow-2xs"
          title={t.inspector.fromLibrary}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-full bg-gradient-to-tr ${
                selectedVoice.avatarColor || "from-pink-500 to-rose-600"
              } flex items-center justify-center text-white font-bold text-xs shadow-sm flex-shrink-0`}
            >
              {selectedVoice.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <h4 className="font-semibold text-[13px] text-textPrimary truncate group-hover:text-accent transition-colors">
                {selectedVoice.name}
              </h4>
              {(() => {
                const langInfo = getVoiceLanguageInfo(selectedVoice, lang);
                let accentOrTag = "";
                if (selectedVoice.accent) {
                  const normAcc = normalizeAccent(selectedVoice.accent);
                  accentOrTag = getAccentLabel(normAcc, lang);
                }
                if (!accentOrTag) {
                  const secondaryTags = getVoiceSecondaryTags(selectedVoice, lang);
                  accentOrTag =
                    secondaryTags.length > 0
                      ? secondaryTags[0]
                      : lang === "vi"
                      ? "Tiêu chuẩn"
                      : "Standard";
                }
                return (
                  <div className="flex items-center gap-1.5 mt-0.5 text-xs text-textSecondary font-medium truncate">
                    <CountryFlag countryCode={langInfo.countryCode || langInfo.code} />
                    <span className="truncate">{langInfo.name}</span>
                    {accentOrTag && (
                      <>
                        <span className="text-textMuted text-[10px]">·</span>
                        <span className="text-[11px] text-textMuted truncate">
                          {accentOrTag}
                        </span>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="flex items-center gap-1 text-xs text-accent font-semibold flex-shrink-0 group-hover:translate-x-0.5 transition-transform">
            <span>{t.inspector.changeVoice}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {/* 2. MODEL ĐỌC Selector */}
      <div className="space-y-1.5">
        <label className="block text-[11px] font-semibold text-textMuted uppercase tracking-wider">
          {lang === "en" ? "Reading Model" : "Model Đọc"}
        </label>
        <select
          value={activeModel}
          onChange={(e) => onChangeModel?.(e.target.value)}
          className="w-full h-[34px] bg-surface1 hover:bg-surface2/80 border border-borderDefault rounded-lg px-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none transition-colors cursor-pointer"
        >
          <option value="Omni Voice">Omni Voice</option>
          <option value="Chatterbox Turbo">Chatterbox Turbo</option>
          <option value="Qwen 1.7B">Qwen 1.7B</option>
        </select>
      </div>
    </div>
  );
};

import React from "react";
import { VoiceProfile } from "../../types/ui";
import { useI18n } from "../../i18n/context";

export interface VoiceProviderBadgeProps {
  voice: VoiceProfile;
  className?: string;
}

export const VoiceProviderBadge: React.FC<VoiceProviderBadgeProps> = ({
  voice,
  className = "",
}) => {
  const { t } = useI18n();

  if (
    voice.origin === "clone" ||
    voice.sourceType === "clone" ||
    voice.source === "local_clone" ||
    voice.provider === "clone"
  ) {
    return (
      <span
        className={`px-1.5 py-0.5 bg-rose-950/80 text-rose-400 text-[10px] rounded border border-rose-800/80 font-semibold flex-shrink-0 leading-none inline-flex items-center ${className}`}
      >
        {t.voiceModal.badgeClone}
      </span>
    );
  }

  if (voice.source === "edge" || voice.provider === "edge") {
    return (
      <span
        className={`px-1.5 py-0.5 bg-sky-950/80 text-sky-400 text-[10px] rounded border border-sky-800/80 font-semibold flex-shrink-0 leading-none inline-flex items-center ${className}`}
      >
        {t.voiceModal.badgeEdge}
      </span>
    );
  }

  if (voice.source === "google" || voice.provider === "google_translate") {
    return (
      <span
        className={`px-1.5 py-0.5 bg-amber-950/80 text-amber-400 text-[10px] rounded border border-amber-800/80 font-semibold flex-shrink-0 leading-none inline-flex items-center ${className}`}
      >
        {t.voiceModal.badgeGoogle}
      </span>
    );
  }

  if (
    voice.source === "local" ||
    voice.source === "preset_local" ||
    voice.sourceType === "local" ||
    voice.provider === "local"
  ) {
    return (
      <span
        className={`px-1.5 py-0.5 bg-purple-950/80 text-purple-400 text-[10px] rounded border border-purple-800/80 font-semibold flex-shrink-0 leading-none inline-flex items-center ${className}`}
      >
        {t.voiceModal.badgeLocal}
      </span>
    );
  }

  return null;
};

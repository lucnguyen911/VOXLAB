import React, { useState, useEffect } from "react";
import {
  X,
  Check,
  Sparkles,
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import { BatchJob } from "../../types/batch";
import { DialogueCharacter } from "../../types/dialogue";
import { VoiceProfile } from "../../types/ui";
import { MOCK_VOICES, mergeStoredVoicesWithCatalog } from "../../mock/data";
import { useI18n } from "../../i18n/context";
import { parseDialogueScript, guessGenderFromName } from "../../services/dialogue/parser";
import { readBatchTextOrDocxFile } from "../../services/batch/batchRuntime";
import { reconcileCloneVoicesWithProfiles } from "../../services/ai/cloneVoiceRegistry";
import {
  getVoiceLanguageInfo,
  normalizeAccent,
  getAccentLabel,
  getVoiceSecondaryTags,
  migrateLegacyVoice,
} from "../../constants/voiceFilters";
import { CountryFlag } from "../../components/common/CountryFlag";
import { VoiceSelectionModal } from "../../components/modals/VoiceSelectionModal";

function loadAvailableVoices(): VoiceProfile[] {
  try {
    const raw = localStorage.getItem("voxlab_voices_v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      return mergeStoredVoicesWithCatalog(parsed, migrateLegacyVoice);
    }
  } catch {
    // ignore
  }
  return MOCK_VOICES.map(migrateLegacyVoice);
}

function normalizeModelSelectValue(rawModel?: string): string {
  const m = (rawModel || "").toLowerCase();
  if (m.includes("kokoro")) return "Kokoro-82M";
  if (m.includes("chatterbox")) return "Chatterbox Turbo";
  if (m.includes("qwen")) return "Qwen TTS 1.7B";
  return "OmniVoice";
}

function autoAssignVoicesForCharacters(
  characters: DialogueCharacter[],
  voices: VoiceProfile[],
  existingMap: Record<string, string> = {}
): Record<string, string> {
  if (voices.length === 0) return { ...existingMap };
  const result: Record<string, string> = {};
  const femaleVoices = voices.filter((v) => v.gender === "female");
  const maleVoices = voices.filter((v) => v.gender === "male");
  let fIdx = 0;
  let mIdx = 0;
  let anyIdx = 0;

  for (const char of characters) {
    const existingId = existingMap[char.name];
    if (existingId && voices.some((v) => v.id === existingId)) {
      result[char.name] = existingId;
      continue;
    }
    const guessed = guessGenderFromName(char.name);
    if (guessed === "female" && femaleVoices.length > 0) {
      result[char.name] = femaleVoices[fIdx % femaleVoices.length].id;
      fIdx++;
    } else if (guessed === "male" && maleVoices.length > 0) {
      result[char.name] = maleVoices[mIdx % maleVoices.length].id;
      mIdx++;
    } else {
      result[char.name] = voices[anyIdx % voices.length].id;
      anyIdx++;
    }
  }
  return result;
}

export interface DialogueCharacterVoiceModalProps {
  job: BatchJob;
  isOpen: boolean;
  onClose: () => void;
  onSaveCharacterVoices: (
    jobId: string,
    characterVoices: Record<string, string>,
    defaultVoiceId?: string
  ) => void;
}

export const DialogueCharacterVoiceModal: React.FC<
  DialogueCharacterVoiceModalProps
> = ({ job, isOpen, onClose, onSaveCharacterVoices }) => {
  if (!isOpen) return null;

  const { t, lang } = useI18n();
  const [voices, setVoices] = useState<VoiceProfile[]>(loadAvailableVoices);
  const [characters, setCharacters] = useState<DialogueCharacter[]>([]);
  const [isLoadingScript, setIsLoadingScript] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [characterVoices, setCharacterVoices] = useState<Record<string, string>>(
    () => ({
      ...(job.effectiveConfigSnapshot?.tasks?.dialogue?.characterVoices || {}),
      ...(job.configOverrides.dialogue?.characterVoices || {}),
    })
  );
  const [pickingCharacterName, setPickingCharacterName] = useState<string | null>(
    null
  );

  // Reconcile cloned voices
  useEffect(() => {
    let cancelled = false;
    reconcileCloneVoicesWithProfiles(loadAvailableVoices())
      .then((reconciled) => {
        if (!cancelled) setVoices(reconciled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Load and parse dialogue script from the job's file
  useEffect(() => {
    let cancelled = false;
    setIsLoadingScript(true);
    setLoadError("");

    const loadCharacters = async () => {
      try {
        let text = job.dialogueScriptText || "";
        if (!text.trim()) {
          text = await readBatchTextOrDocxFile(job.sourceFilePath);
        }
        if (cancelled) return;
        const parsed = parseDialogueScript(text);
        const chars = parsed.characters || [];
        setCharacters(chars);
        setCharacterVoices((prev) =>
          autoAssignVoicesForCharacters(chars, loadAvailableVoices(), prev)
        );
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(`Không thể đọc nội dung kịch bản: ${msg}`);
      } finally {
        if (!cancelled) setIsLoadingScript(false);
      }
    };

    loadCharacters();
    return () => {
      cancelled = true;
    };
  }, [job.id, job.sourceFilePath, job.dialogueScriptText]);

  const handleAutoAssignAll = () => {
    setCharacterVoices(autoAssignVoicesForCharacters(characters, voices, {}));
  };

  const handleSave = () => {
    const firstAssignedVoice =
      Object.values(characterVoices)[0] || voices[0]?.id || "omnivoice-auto";
    onSaveCharacterVoices(job.id, characterVoices, firstAssignedVoice);
    onClose();
  };

  const currentModelLabel = normalizeModelSelectValue(
    job.configOverrides.dialogue?.model ||
      job.effectiveConfigSnapshot?.tasks?.dialogue?.model
  );

  const totalTurns = characters.reduce((acc, c) => acc + c.segmentCount, 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-[560px] max-h-[85vh] bg-panel rounded-2xl border border-borderDefault shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-borderDefault bg-surface1 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-textPrimary truncate">
                Chọn giọng nhân vật hội thoại
              </h3>
              <p
                className="text-[11px] text-textMuted font-mono truncate"
                title={job.sourceFileName}
              >
                {job.sourceFileName}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-textMuted hover:text-textPrimary rounded-lg hover:bg-surface2 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-header toolbar */}
        <div className="px-5 py-2.5 border-b border-borderDefault/70 bg-surface2/40 flex items-center justify-between text-xs flex-shrink-0">
          <div className="flex items-center gap-2 text-textSecondary">
            <span className="font-semibold text-textPrimary">
              Nhân vật ({characters.length})
            </span>
            <span className="text-textMuted">•</span>
            <span className="text-[11px] text-textMuted">
              {totalTurns} câu thoại
            </span>
          </div>

          {characters.length > 0 && (
            <button
              type="button"
              onClick={handleAutoAssignAll}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-accent hover:bg-accent/10 border border-accent/25 transition-colors cursor-pointer"
              title="Tự động phân giọng đọc khác nhau cho từng nhân vật"
            >
              <Sparkles className="w-3 h-3" />
              <span>Tự động phân giọng</span>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {isLoadingScript ? (
            <div className="py-12 text-center text-xs text-textMuted">
              Đang phân tích danh sách nhân vật trong tệp hội thoại...
            </div>
          ) : loadError ? (
            <div className="p-4 rounded-xl bg-danger/10 border border-danger/30 text-xs text-danger">
              {loadError}
            </div>
          ) : characters.length === 0 ? (
            <div className="py-10 text-center space-y-1.5">
              <p className="text-xs font-semibold text-textSecondary">
                Không tìm thấy nhân vật phân vai trong tệp này.
              </p>
              <p className="text-[11px] text-textMuted">
                Định dạng chuẩn: <code className="font-mono">[Tên nhân vật]: Lời thoại</code>
              </p>
            </div>
          ) : (
            characters.map((char) => {
              const assignedVoiceId =
                characterVoices[char.name] || voices[0]?.id || "edge_vi_hoaimy";
              const assignedVoice =
                voices.find((v) => v.id === assignedVoiceId) ||
                voices[0] || {
                  id: "edge_vi_hoaimy",
                  name: "Hoài My",
                  gender: "female",
                  language: "vi-VN",
                  avatarColor: "from-sky-500 to-blue-600",
                };

              const langInfo = getVoiceLanguageInfo(assignedVoice, lang);
              let accentOrTag = "";
              if (assignedVoice.accent) {
                const normAcc = normalizeAccent(assignedVoice.accent);
                accentOrTag = getAccentLabel(normAcc, lang);
              }
              if (!accentOrTag) {
                const secondaryTags = getVoiceSecondaryTags(assignedVoice, lang);
                accentOrTag =
                  secondaryTags.length > 0
                    ? secondaryTags[0]
                    : lang === "vi"
                    ? "Tiêu chuẩn"
                    : "Standard";
              }

              return (
                <div
                  key={char.id}
                  className="p-3.5 rounded-xl border border-l-[3.5px] bg-surface1 hover:bg-surface2/30 transition-all space-y-2.5"
                  style={{
                    borderLeftColor: char.colorTheme.rawHex,
                    borderColor: `${char.colorTheme.rawHex}40`,
                  }}
                >
                  {/* Character Header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`px-2 py-0.5 rounded-md text-xs font-semibold tracking-wide truncate ${char.colorTheme.badgeClass}`}
                        title={`[${char.name}]`}
                      >
                        [{char.name}]
                      </span>
                      <span className="text-[11px] text-textMuted whitespace-nowrap">
                        Gồm {char.segmentCount} câu thoại
                      </span>
                    </div>
                  </div>

                  {/* Voice Card Button */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setPickingCharacterName(char.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setPickingCharacterName(char.name);
                      }
                    }}
                    className="p-2.5 bg-surface2/50 hover:bg-surface2 border border-borderDefault hover:border-accent/50 rounded-xl transition-all cursor-pointer flex items-center justify-between gap-3 group"
                    title={t.inspector.fromLibrary}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-full bg-gradient-to-tr ${
                          assignedVoice.avatarColor || "from-pink-500 to-rose-600"
                        } flex items-center justify-center text-white font-bold text-xs shadow-sm flex-shrink-0`}
                      >
                        {assignedVoice.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-semibold text-xs text-textPrimary truncate group-hover:text-accent transition-colors">
                          {assignedVoice.name}
                        </h4>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-textSecondary font-medium truncate">
                          <CountryFlag
                            countryCode={langInfo.countryCode || langInfo.code}
                          />
                          <span className="truncate">{langInfo.name}</span>
                          {accentOrTag && (
                            <>
                              <span className="text-textMuted text-[10px]">·</span>
                              <span className="text-[10px] text-textMuted truncate">
                                {accentOrTag}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 text-xs text-accent font-semibold flex-shrink-0 group-hover:translate-x-0.5 transition-transform">
                      <span>{t.inspector.changeVoice}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-borderDefault bg-surface1 flex items-center justify-end gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold text-textSecondary hover:text-textPrimary bg-surface2 hover:bg-surface3 border border-borderDefault rounded-lg transition-colors cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={characters.length === 0}
            onClick={handleSave}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
              characters.length === 0
                ? "bg-surface3 text-textMuted/40 border border-borderDefault/40 cursor-not-allowed"
                : "bg-accent hover:bg-accentHover text-slate-950 cursor-pointer shadow-sm"
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            <span>Áp dụng</span>
          </button>
        </div>

        {/* Nested VoiceSelectionModal for picking a character's voice */}
        <VoiceSelectionModal
          isOpen={Boolean(pickingCharacterName)}
          onClose={() => setPickingCharacterName(null)}
          voices={voices}
          activeVoiceId={
            pickingCharacterName
              ? characterVoices[pickingCharacterName] || voices[0]?.id || "edge_vi_hoaimy"
              : voices[0]?.id || "edge_vi_hoaimy"
          }
          currentModel={currentModelLabel}
          onSelectVoice={(voice) => {
            if (pickingCharacterName) {
              setCharacterVoices((prev) => ({
                ...prev,
                [pickingCharacterName]: voice.id,
              }));
            }
            setPickingCharacterName(null);
          }}
        />
      </div>
    </div>
  );
};

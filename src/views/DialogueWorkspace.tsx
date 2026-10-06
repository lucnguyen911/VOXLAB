import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Download,
  FileText,
  ArrowRight,
  FileAudio,
} from "lucide-react";
import { VoiceProfile } from "../types/ui";
import {
  DialogueCharacter,
  DialogueGlobalSettings,
  DialogueSegment,
  DEFAULT_DIALOGUE_SETTINGS,
} from "../types/dialogue";
import {
  parseDialogueScript,
  guessGenderFromName,
  stripStageDirections,
} from "../services/dialogue/parser";
import { SAMPLE_VIETNAMESE_DIALOGUE } from "../services/dialogue/sampleScripts";
import {
  assembleMasterAudioBuffer,
  encodePcmWav,
} from "../services/dialogue/masterAssembly";
import {
  generateDialogueSrt,
  downloadTextFile,
} from "../services/dialogue/srtExporter";
import { loadSubtitleSettings } from "../services/subtitle";
import { DialogueEditor } from "../components/dialogue/DialogueEditor";
import { DialogueStudio } from "../components/dialogue/DialogueStudio";
import { DialogueInspector } from "../components/dialogue/DialogueInspector";
import { VoiceSelectionModal } from "../components/modals/VoiceSelectionModal";
import { TextNormalizationModal } from "../components/modals/TextNormalizationModal";
import { PronunciationManagerModal } from "../components/modals/PronunciationManagerModal";
import { BottomAudioPlayer, ActiveAudioTrack } from "../components/layout/BottomAudioPlayer";
import { loadScriptFromFile } from "../services/document/scriptLoader";
import { parsePauseDurationMs, stripPauseTokens } from "../services/pause";

export interface DialogueWorkspaceProps {
  voices: VoiceProfile[];
  onNavigateToClone?: () => void;
}

export const DialogueWorkspace: React.FC<DialogueWorkspaceProps> = ({
  voices,
  onNavigateToClone,
}) => {
  // Stage management: "prep" (Soạn thảo) vs "studio" (Tạo giọng)
  const [stage, setStage] = useState<"prep" | "studio">("prep");

  // Session script state (persisted to localStorage)
  const [rawScript, setRawScript] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("voxlab_dialogue_script");
      if (!saved || saved.trim() === SAMPLE_VIETNAMESE_DIALOGUE.trim()) {
        return "";
      }
      return saved;
    } catch {
      return "";
    }
  });

  // Settings state (persisted to localStorage)
  const [settings, setSettings] = useState<DialogueGlobalSettings>(() => {
    try {
      const saved = localStorage.getItem("voxlab_dialogue_settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        const model = parsed.model === "Lingual Speech V2" ? "Omni Voice" : (parsed.model || "Omni Voice");
        return {
          ...DEFAULT_DIALOGUE_SETTINGS,
          ...parsed,
          model,
          pauses: {
            ...DEFAULT_DIALOGUE_SETTINGS.pauses,
            ...(parsed.pauses || {}),
          },
        };
      }
    } catch {
      // fallback
    }
    return DEFAULT_DIALOGUE_SETTINGS;
  });

  // Active characters list
  const [characters, setCharacters] = useState<DialogueCharacter[]>([]);

  // Segments list for Studio view (checking each line)
  const [segments, setSegments] = useState<DialogueSegment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<DialogueSegment | null>(null);

  // Conversion / Generation state
  const [isConverting, setIsConverting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [conversionProgress, setConversionProgress] = useState<{ current: number; total: number } | null>(null);

  // Master Audio state
  const [masterAudioUrl, setMasterAudioUrl] = useState<string | null>(null);
  const [masterDurationSec, setMasterDurationSec] = useState<number>(0);
  const [isPlayingMaster, setIsPlayingMaster] = useState(false);
  const [masterSrtContent, setMasterSrtContent] = useState<string | null>(null);

  // Individual segment playback state
  const [activePlayingSegmentId, setActivePlayingSegmentId] = useState<string | null>(null);
  const [isPlayingSegment, setIsPlayingSegment] = useState(false);
  const [activeSegmentTrack, setActiveSegmentTrack] = useState<ActiveAudioTrack | null>(null);
  const segmentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Cancel controller ref
  const cancelRequestedRef = useRef(false);

  // Voice Selection Modal state
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [selectedCharIdForVoice, setSelectedCharIdForVoice] = useState<string | null>(null);

  // Normalization and Pronunciation modals state
  const [isNormalizerOpen, setIsNormalizerOpen] = useState(false);
  const [isPronunciationModalOpen, setIsPronunciationModalOpen] = useState(false);

  // Helper: Stop current playing audio
  const stopSegmentAudio = useCallback(() => {
    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause();
      segmentAudioRef.current.currentTime = 0;
    }
    setIsPlayingSegment(false);
    setActivePlayingSegmentId(null);
  }, []);

  // Parse script and maintain character assignments + segments preservation
  useEffect(() => {
    const parseRes = parseDialogueScript(rawScript, characters);

    // Auto-suggest default voice if not yet assigned
    const updatedChars = parseRes.characters.map((c) => {
      if (!c.voiceId && voices.length > 0) {
        const guessedGender = guessGenderFromName(c.name);
        const match = voices.find((v) =>
          guessedGender ? v.gender === guessedGender : true
        );
        return {
          ...c,
          voiceId: match?.id || voices[0].id,
        };
      }
      return c;
    });

    setCharacters(updatedChars);

    // Preserve existing segment audio buffers when text matches
    setSegments((prevSegments) => {
      const prevMap = new Map(prevSegments.map((s) => [`${s.characterName}_${s.cleanText}`, s]));

      return parseRes.segments.map((newSeg) => {
        const key = `${newSeg.characterName}_${newSeg.cleanText}`;
        const existing = prevMap.get(key);
        if (existing) {
          return {
            ...newSeg,
            status: existing.status,
            audioBuffer: existing.audioBuffer,
            audioBlobUrl: existing.audioBlobUrl,
            durationSec: existing.durationSec,
            errorMessage: existing.errorMessage,
          };
        }
        return newSeg;
      });
    });

    try {
      localStorage.setItem("voxlab_dialogue_script", rawScript);
    } catch {
      // ignore
    }
  }, [rawScript]);

  // Persist settings
  useEffect(() => {
    try {
      localStorage.setItem("voxlab_dialogue_settings", JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  // Handle script text change in prep stage
  const handleScriptChange = (val: string) => {
    setRawScript(val);
  };

  // Switch from prep to studio stage with explicit segmentation
  const handleSplitAndStudio = () => {
    const parseRes = parseDialogueScript(rawScript, characters);
    if (parseRes.segments.length > 0) {
      setSegments((prev) => {
        const prevMap = new Map(prev.map((s) => [`${s.characterName}_${s.cleanText}`, s]));
        return parseRes.segments.map((seg) => {
          const key = `${seg.characterName}_${seg.cleanText}`;
          const existing = prevMap.get(key);
          if (existing) {
            return {
              ...seg,
              status: existing.status,
              audioBuffer: existing.audioBuffer,
              audioBlobUrl: existing.audioBlobUrl,
              durationSec: existing.durationSec,
              errorMessage: existing.errorMessage,
            };
          }
          return seg;
        });
      });
    }
    setStage("studio");
  };

  // Insert sample dialogue
  const handleUseSample = () => {
    setRawScript(SAMPLE_VIETNAMESE_DIALOGUE);
  };

  // Upload script file via drag-and-drop (.docx, .txt, .md, .srt, .vtt)
  const handleProcessScriptFile = async (file: File) => {
    try {
      const res = await loadScriptFromFile(file);
      if (res.text) {
        setRawScript(res.text);
      }
    } catch (err: any) {
      alert(`Không thể đọc tệp kịch bản: ${err?.message || err}`);
    }
  };

  const handleApplyNormalization = (normalizedText: string, _changeCount: number) => {
    setRawScript(normalizedText);
  };

  // Update global settings
  const handleUpdateSettings = (partial: Partial<DialogueGlobalSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  };

  // Character voice selection
  const handleOpenVoicePicker = (characterId: string) => {
    setSelectedCharIdForVoice(characterId);
    setVoiceModalOpen(true);
  };

  const handleSelectVoice = (voice: VoiceProfile) => {
    if (!selectedCharIdForVoice) return;
    setCharacters((prev) =>
      prev.map((c) =>
        c.id === selectedCharIdForVoice ? { ...c, voiceId: voice.id } : c
      )
    );
    setVoiceModalOpen(false);
    setSelectedCharIdForVoice(null);
  };

  // Update speed & pitch per character
  const handleUpdateCharacterSpeed = (characterId: string, speed: number) => {
    setCharacters((prev) =>
      prev.map((c) => (c.id === characterId ? { ...c, speed } : c))
    );
  };

  const handleUpdateCharacterPitch = (characterId: string, pitch: number) => {
    setCharacters((prev) =>
      prev.map((c) => (c.id === characterId ? { ...c, pitch } : c))
    );
  };

  // Synthesize single segment AudioBuffer & WAV blob
  const synthesizeSegmentAudio = async (
    seg: DialogueSegment,
    chars: DialogueCharacter[],
    audioCtx: AudioContext,
    sampleRate = 44100
  ): Promise<DialogueSegment> => {
    const char = chars.find((c) => c.id === seg.characterId);
    const speed = char?.speed ?? 1.0;
    const pitch = char?.pitch ?? 1.0;

    // Calculate duration based on words & speed, factoring in manual pauses
    const pauseMs = parsePauseDurationMs(seg.rawText) || 0;
    const pauseSec = pauseMs / 1000;

    const cleanSpeechText = stripPauseTokens(seg.cleanText);
    const wordCount = cleanSpeechText.split(/\s+/).filter(Boolean).length;
    const speechDurationSec = Math.max(1.0, (wordCount / 3.4) / speed);
    const totalDurationSec = speechDurationSec + pauseSec;
    const sampleCount = Math.floor(totalDurationSec * sampleRate);
    const speechSampleCount = Math.floor(speechDurationSec * sampleRate);

    // Generate harmonic speech-like preview buffer
    const buffer = audioCtx.createBuffer(1, sampleCount, sampleRate);
    const data = buffer.getChannelData(0);
    const baseFreq = (char?.id.charCodeAt(0) ? 140 + (char.id.charCodeAt(0) % 80) : 180) * pitch;

    const isPauseAtStart = /^\s*\[(?:PAUSE|pause)\b/i.test(seg.rawText);
    const speechOffset = isPauseAtStart ? Math.floor(pauseSec * sampleRate) : 0;

    for (let s = 0; s < speechSampleCount; s++) {
      if (speechOffset + s < sampleCount) {
        const t = s / sampleRate;
        const env = Math.sin(Math.PI * (s / speechSampleCount));
        const wave =
          Math.sin(2 * Math.PI * baseFreq * t) * 0.4 +
          Math.sin(2 * Math.PI * (baseFreq * 2) * t) * 0.2 +
          Math.sin(2 * Math.PI * (baseFreq * 3) * t) * 0.1;
        data[speechOffset + s] = wave * env * 0.6;
      }
    }

    const blob = encodePcmWav(data, sampleRate, settings.masterVolume);
    const audioBlobUrl = URL.createObjectURL(blob);

    return {
      ...seg,
      status: "ready",
      durationSec: totalDurationSec,
      audioBuffer: buffer,
      audioBlobUrl,
      errorMessage: undefined,
    };
  };

  // Play/Pause single segment audio
  const handlePlaySegment = async (seg: DialogueSegment) => {
    // If this segment is already active, toggle play/pause
    if (activePlayingSegmentId === seg.id) {
      setIsPlayingSegment((prev) => !prev);
      return;
    }

    // Stop master audio if playing
    if (isPlayingMaster) {
      setIsPlayingMaster(false);
    }

    // Synthesize on the fly if not ready yet
    let targetBlobUrl = seg.audioBlobUrl;
    if (!targetBlobUrl || !seg.audioBuffer) {
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 44100,
        });
        const synthesized = await synthesizeSegmentAudio(seg, characters, audioCtx, 44100);
        targetBlobUrl = synthesized.audioBlobUrl;
        setSegments((prev) =>
          prev.map((s) => (s.id === seg.id ? synthesized : s))
        );
      } catch (err) {
        console.error("Single segment synthesis error:", err);
        return;
      }
    }

    const char = characters.find((c) => c.id === seg.characterId);
    const voice = voices.find((v) => v.id === char?.voiceId);
    const speakerName = voice?.name || "Giọng đọc";
    const track: ActiveAudioTrack = {
      id: `seg_${seg.id}`,
      chunkIndex: seg.index,
      voiceName: speakerName,
      title: `Câu ${seg.index < 10 ? `0${seg.index}` : seg.index} · [${seg.characterName}]`,
      durationSec: seg.durationSec || 4.2,
      audioUrl: targetBlobUrl,
      text: seg.cleanText || seg.rawText,
    };

    setActiveSegmentTrack(track);
    setActivePlayingSegmentId(seg.id);
    setIsPlayingSegment(true);
  };

  // Regenerate a single segment (Section 9 parity with TTS chunk regenerate)
  const handleRegenerateSegment = async (segmentId: string) => {
    stopSegmentAudio();
    setSegments((prev) =>
      prev.map((s) =>
        s.id === segmentId ? { ...s, status: "generating", errorMessage: undefined } : s
      )
    );

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const target = segments.find((s) => s.id === segmentId);
      if (!target) return;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 44100,
      });

      const synthesized = await synthesizeSegmentAudio(target, characters, audioCtx, 44100);

      const nextSegments = segments.map((s) =>
        s.id === segmentId ? synthesized : s
      );
      setSegments(nextSegments);

      // Reassemble master audio if ready segments exist
      const readySegs = nextSegments.filter((s) => s.audioBuffer);
      if (readySegs.length > 0) {
        const assembly = assembleMasterAudioBuffer(nextSegments, settings, 44100);
        const url = URL.createObjectURL(assembly.blob);
        setMasterAudioUrl(url);
        setMasterDurationSec(assembly.totalDurationSec);
        if (settings.exportSrt) {
          const subtitleSettings = loadSubtitleSettings();
          setMasterSrtContent(
            generateDialogueSrt(assembly.timeline, {
              aspectRatio: subtitleSettings.aspectRatio,
              maxLines: subtitleSettings.maxLines,
            })
          );
        } else {
          setMasterSrtContent(null);
        }
      }
    } catch (err: any) {
      setSegments((prev) =>
        prev.map((s) =>
          s.id === segmentId
            ? { ...s, status: "failed", errorMessage: String(err?.message || err) }
            : s
        )
      );
    }
  };

  // Inline editing of segment text (marks it as modified and syncs back to rawScript)
  const handleSegmentTextChange = (segmentId: string, newText: string) => {
    setSegments((prev) => {
      const updated = prev.map((s) =>
        s.id === segmentId
          ? {
              ...s,
              rawText: newText,
              cleanText: stripStageDirections(newText),
              status: "modified" as const,
            }
          : s
      );

      // Reconstruct rawScript preserving speakers
      const reconstructed = updated
        .map((s) => `[${s.characterName}]: ${s.rawText}`)
        .join("\n\n");
      setRawScript(reconstructed);

      try {
        localStorage.setItem("voxlab_dialogue_script", reconstructed);
      } catch {
        // ignore
      }

      return updated;
    });
  };

  // Batch regenerate invalid (modified or failed) segments
  const invalidSegments = useMemo(() => {
    return segments.filter(
      (s) => s.status === "modified" || s.status === "failed"
    );
  }, [segments]);

  const handleRegenerateInvalidSegments = async () => {
    if (invalidSegments.length === 0 || isConverting) return;
    await handleConvertDialogue(invalidSegments.map((s) => s.id));
  };

  // Full Synthesis & Master Assembly Workflow
  const handleConvertDialogue = async (targetSegmentIds?: string[]) => {
    if (isConverting) return;
    stopSegmentAudio();
    cancelRequestedRef.current = false;

    // Ensure segments are parsed
    const currentSegments = segments.length > 0 ? segments : parseDialogueScript(rawScript, characters).segments;
    if (currentSegments.length === 0) {
      alert("Kịch bản chưa có câu thoại nào. Hãy nhập theo định dạng [Tên]: Lời thoại.");
      return;
    }

    const toProcess = targetSegmentIds
      ? currentSegments.filter((s) => targetSegmentIds.includes(s.id))
      : currentSegments;

    setIsConverting(true);
    setIsPaused(false);
    isPausedRef.current = false;
    setConversionProgress({ current: 0, total: toProcess.length });

    try {
      const sampleRate = 44100;
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate,
      });

      let updatedSegments = [...currentSegments];

      for (let i = 0; i < toProcess.length; i++) {
        while (isPausedRef.current && !cancelRequestedRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (cancelRequestedRef.current) break;

        const seg = toProcess[i];
        setConversionProgress({ current: i + 1, total: toProcess.length });

        // Mark segment as generating
        setSegments((prev) =>
          prev.map((s) => (s.id === seg.id ? { ...s, status: "generating" } : s))
        );

        await new Promise((resolve) => setTimeout(resolve, 350));

        const synthesized = await synthesizeSegmentAudio(seg, characters, audioCtx, sampleRate);

        updatedSegments = updatedSegments.map((s) =>
          s.id === seg.id ? synthesized : s
        );
        setSegments(updatedSegments);
      }

      // Assemble into master audio WAV
      const assembly = assembleMasterAudioBuffer(updatedSegments, settings, sampleRate);
      const url = URL.createObjectURL(assembly.blob);

      setMasterAudioUrl(url);
      setMasterDurationSec(assembly.totalDurationSec);
      setActiveSegmentTrack(null);
      setIsPlayingSegment(false);
      setActivePlayingSegmentId(null);
      setIsPlayingMaster(true);

      // Generate SRT
      if (settings.exportSrt) {
        const subtitleSettings = loadSubtitleSettings();
        const srt = generateDialogueSrt(assembly.timeline, {
          aspectRatio: subtitleSettings.aspectRatio,
          maxLines: subtitleSettings.maxLines,
        });
        setMasterSrtContent(srt);
      } else {
        setMasterSrtContent(null);
      }

      // Automatically switch to studio stage so user can check each segment
      setStage("studio");
    } catch (err: any) {
      alert(`Lỗi khi tạo audio hội thoại: ${err?.message || err}`);
    } finally {
      setIsConverting(false);
      setIsPaused(false);
      isPausedRef.current = false;
      setConversionProgress(null);
    }
  };

  const handleTogglePause = () => {
    setIsPaused((prev) => {
      const next = !prev;
      isPausedRef.current = next;
      return next;
    });
  };

  const handleCancelConverting = () => {
    cancelRequestedRef.current = true;
    isPausedRef.current = false;
    setIsPaused(false);
    setIsConverting(false);
    setConversionProgress(null);
  };

  // Download Master WAV
  const handleDownloadWav = () => {
    if (!masterAudioUrl) return;
    const a = document.createElement("a");
    a.href = masterAudioUrl;
    a.download = "VoxLab_HoiThoai_Master.wav";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Download SRT
  const handleDownloadSrt = () => {
    const readySegs = segments.filter((s) => s.audioBuffer);
    if (readySegs.length === 0 && !masterSrtContent) return;
    const subtitleSettings = loadSubtitleSettings();
    const content =
      readySegs.length > 0
        ? generateDialogueSrt(assembleMasterAudioBuffer(segments, settings, 44100).timeline, {
            aspectRatio: subtitleSettings.aspectRatio,
            maxLines: subtitleSettings.maxLines,
          })
        : masterSrtContent;
    if (content) {
      setMasterSrtContent(content);
      downloadTextFile(content, "VoxLab_HoiThoai_PhuDe.srt");
    }
  };

  // Calculate stats for editor
  const stats = useMemo(() => {
    const trimmed = rawScript.trim();
    const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
    const charCount = rawScript.length;
    return { wordCount, charCount };
  }, [rawScript]);

  // Master audio track for BottomAudioPlayer
  const masterTrack = useMemo(() => {
    if (!masterAudioUrl) return null;
    return {
      id: "dialogue_master_track",
      title: "Hội Thoại Đa Nhân Vật (Master)",
      voiceName: `${characters.length} nhân vật`,
      durationSec: masterDurationSec,
      audioUrl: masterAudioUrl,
    };
  }, [masterAudioUrl, masterDurationSec, characters.length]);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) {
          handleProcessScriptFile(file);
        }
      }}
      className="flex-1 flex flex-col h-full overflow-hidden bg-background"
    >
      {/* Top Header Bar matching TTS Workspace */}
      <div className="h-12 border-b border-borderDefault bg-panel px-3.5 flex items-center justify-between flex-shrink-0 overflow-x-auto gap-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Stage Switcher: Soạn thảo (Prep) vs Tạo giọng (Studio) */}
          <div className="inline-flex bg-surface2 rounded-lg p-0.5 border border-borderDefault/60 text-xs flex-shrink-0">
            <button
              type="button"
              onClick={() => setStage("prep")}
              className={`px-3 py-1 rounded-md font-medium transition-all whitespace-nowrap cursor-pointer ${
                stage === "prep"
                  ? "bg-surface1 text-textPrimary font-semibold shadow-2xs"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              Soạn thảo
            </button>
            <button
              type="button"
              onClick={handleSplitAndStudio}
              className={`px-3 py-1 rounded-md font-medium transition-all whitespace-nowrap cursor-pointer ${
                stage === "studio"
                  ? "bg-surface1 text-textPrimary font-semibold shadow-2xs"
                  : "text-textSecondary hover:text-textPrimary"
              }`}
            >
              Tạo giọng
            </button>
          </div>
        </div>

        {/* Action Button Based On Stage */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {stage === "prep" ? (
            rawScript.trim().length > 0 && (
              <button
                type="button"
                onClick={handleSplitAndStudio}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accentHover text-white rounded-lg text-xs font-semibold shadow-xs transition-colors whitespace-nowrap cursor-pointer"
              >
                <span>Chuyển sang tạo giọng</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )
          ) : (
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Permanent Top-Right CTA: Ghép & Xuất file master */}
              <button
                type="button"
                disabled={isConverting || segments.length === 0}
                onClick={() => {
                  if (masterAudioUrl) {
                    handleDownloadWav();
                    if (settings.exportSrt) {
                      handleDownloadSrt();
                    }
                    return;
                  }
                  const readySegments = segments.filter((s) => s.audioBuffer);
                  if (readySegments.length === 0) {
                    return;
                  }
                  try {
                    const assembly = assembleMasterAudioBuffer(segments, settings, 24000);
                    const url = URL.createObjectURL(assembly.blob);
                    setMasterAudioUrl(url);
                    setMasterDurationSec(assembly.totalDurationSec);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "VoxLab_HoiThoai_Master.wav";
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    if (settings.exportSrt) {
                      const subtitleSettings = loadSubtitleSettings();
                      const srt = generateDialogueSrt(assembly.timeline, {
                        aspectRatio: subtitleSettings.aspectRatio,
                        maxLines: subtitleSettings.maxLines,
                      });
                      setMasterSrtContent(srt);
                      downloadTextFile(srt, "VoxLab_HoiThoai_PhuDe.srt");
                    }
                  } catch (err: any) {
                    alert(`Lỗi ghép file: ${err?.message || err}`);
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors whitespace-nowrap cursor-pointer ${
                  isConverting || segments.length === 0
                    ? "bg-surface2 text-textMuted cursor-not-allowed opacity-60 border border-borderDefault"
                    : "bg-surface2 hover:bg-surface3 text-textPrimary hover:text-accent border border-borderDefault hover:border-accent/40"
                }`}
                title={
                  isConverting
                    ? "Đang tạo audio, vui lòng chờ hoàn tất để ghép & xuất"
                    : "Xuất file âm thanh Master (.wav)"
                }
              >
                <FileAudio className="w-3.5 h-3.5 text-accent" />
                <span>Xuất audio</span>
                {invalidSegments.length > 0 && !isConverting && (
                  <span className="w-1.5 h-1.5 rounded-full bg-warning ml-0.5" title="Có đoạn cần tạo lại trước khi xuất" />
                )}
              </button>

              {/* Export SRT */}
              {masterSrtContent && (
                <button
                  type="button"
                  onClick={handleDownloadSrt}
                  disabled={isConverting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 hover:bg-surface3 text-textSecondary hover:text-textPrimary border border-borderDefault rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Tải tệp phụ đề (.srt)"
                >
                  <FileText className="w-3.5 h-3.5 text-textMuted" />
                  <span>Tải SRT</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Workspace Stage Shell with Sidebar */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Center Content: Either Stage 1 (Soạn thảo) or Stage 2 (Tạo giọng) */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {stage === "prep" ? (
            /* STAGE 1: SOẠN THẢO (Prep Stage) */
            <div className="flex-1 flex flex-col p-4 space-y-3 overflow-hidden min-w-0">
              <DialogueEditor
                value={rawScript}
                onChange={handleScriptChange}
                characters={characters}
                wordCount={stats.wordCount}
                charCount={stats.charCount}
                onNormalize={() => setIsNormalizerOpen(true)}
                onOpenPronunciation={() => setIsPronunciationModalOpen(true)}
                onUseSample={handleUseSample}
                onUploadFile={handleProcessScriptFile}
                onConvert={() => handleConvertDialogue()}
                isConverting={isConverting}
              />
            </div>
          ) : (
            /* STAGE 2: TẠO GIỌNG (Studio Stage) to inspect & review each segment */
            <DialogueStudio
              segments={segments}
              characters={characters}
              voices={voices}
              selectedSegmentId={selectedSegment?.id || null}
              onSelectSegment={(seg) => setSelectedSegment(seg)}
              activePlayingSegmentId={activePlayingSegmentId}
              isPlayingSegment={isPlayingSegment}
              onPlaySegment={handlePlaySegment}
              onRegenerateSegment={handleRegenerateSegment}
              onSegmentTextChange={handleSegmentTextChange}
              onOpenVoicePickerForCharacter={handleOpenVoicePicker}
              onNavigateToPrep={() => setStage("prep")}
              onDropFile={handleProcessScriptFile}
              onRegenerateInvalid={handleRegenerateInvalidSegments}
              isConverting={isConverting}
              bottomPlayer={
                activeSegmentTrack ? (
                  <BottomAudioPlayer
                    track={activeSegmentTrack}
                    isPlaying={isPlayingSegment}
                    onTogglePlay={() => setIsPlayingSegment((p) => !p)}
                    onClose={() => {
                      setIsPlayingSegment(false);
                      setActivePlayingSegmentId(null);
                      setActiveSegmentTrack(null);
                    }}
                    className="mx-0 mb-0"
                  />
                ) : masterTrack ? (
                  <div className="shrink-0 flex flex-col gap-2 p-3 bg-surface1 border border-borderDefault rounded-xl shadow-2xs">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-textSecondary text-[11px]">
                        Bản thu Master hoàn chỉnh · {Math.floor(masterTrack.durationSec / 60)}:{String(Math.floor(masterTrack.durationSec % 60)).padStart(2, "0")}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleDownloadWav}
                          className="flex items-center gap-1.5 px-3 py-1 bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault rounded-md text-xs font-medium transition-colors cursor-pointer"
                          title="Tải tệp âm thanh Master (.wav)"
                        >
                          <Download className="w-3.5 h-3.5 text-accent" />
                          <span>Tải Audio (WAV)</span>
                        </button>
                        {masterSrtContent && (
                          <button
                            type="button"
                            onClick={handleDownloadSrt}
                            className="flex items-center gap-1.5 px-3 py-1 bg-surface2 hover:bg-surface3 text-textPrimary border border-borderDefault rounded-md text-xs font-medium transition-colors cursor-pointer"
                            title="Tải tệp phụ đề (.srt)"
                          >
                            <FileText className="w-3.5 h-3.5 text-accent" />
                            <span>Tải Phụ đề (SRT)</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <BottomAudioPlayer
                      track={masterTrack}
                      isPlaying={isPlayingMaster}
                      onTogglePlay={() => setIsPlayingMaster((p) => !p)}
                      onClose={() => setMasterAudioUrl(null)}
                      className="mx-0 mb-0"
                    />
                  </div>
                ) : null
              }
            />
          )}
        </div>

        {/* Right Configuration Inspector: Only visible in studio stage (Tạo giọng), matching TTS workspace */}
        {stage === "studio" && (
          <DialogueInspector
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            characters={characters}
            voices={voices}
            onOpenVoicePicker={handleOpenVoicePicker}
            onUpdateCharacterSpeed={handleUpdateCharacterSpeed}
            onUpdateCharacterPitch={handleUpdateCharacterPitch}
            onUseSample={handleUseSample}
            onConvert={() => handleConvertDialogue()}
            isConverting={isConverting}
            isPaused={isPaused}
            onTogglePause={handleTogglePause}
            onCancel={handleCancelConverting}
            completedCount={conversionProgress?.current || 0}
            totalCount={conversionProgress?.total || segments.length || 0}
            canConvert={segments.length > 0 && characters.length > 0}
            hasGeneratedAudio={segments.some((s) => !!s.audioBuffer)}
            convertTooltip={
              segments.some((s) => !!s.audioBuffer)
                ? "Chạy lại toàn bộ audio hội thoại (ghi đè kết quả cũ)"
                : "Tạo audio cho toàn bộ lời thoại"
            }
          />
        )}
      </div>

      {/* Voice Selection Modal */}
      <VoiceSelectionModal
        isOpen={voiceModalOpen}
        onClose={() => {
          setVoiceModalOpen(false);
          setSelectedCharIdForVoice(null);
        }}
        voices={voices}
        activeVoiceId={
          selectedCharIdForVoice
            ? characters.find((c) => c.id === selectedCharIdForVoice)?.voiceId || ""
            : ""
        }
        onSelectVoice={handleSelectVoice}
        onNavigateToClone={onNavigateToClone}
        currentModel={settings.model}
      />

      {/* Text Normalization Modal */}
      <TextNormalizationModal
        isOpen={isNormalizerOpen}
        onClose={() => setIsNormalizerOpen(false)}
        originalText={rawScript}
        onApply={handleApplyNormalization}
        onOpenPronunciationManager={() => {
          setIsNormalizerOpen(false);
          setIsPronunciationModalOpen(true);
        }}
      />

      {/* Pronunciation Manager Modal */}
      <PronunciationManagerModal
        isOpen={isPronunciationModalOpen}
        onClose={() => setIsPronunciationModalOpen(false)}
        projectId="dialogue"
      />
    </div>
  );
};

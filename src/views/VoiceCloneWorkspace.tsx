import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Mic,
  UploadCloud,
  FileAudio,
  Play,
  Pause,
  Scissors,
  Search,
  MoreVertical,
  ArrowRight,
  Download,
  Trash2,
  Edit2,
  Sparkles,
  CheckCircle2,
  Plus,
  X,
  Tag,
} from "lucide-react";
import { VoiceProfile } from "../types/ui";
import { ActiveAudioTrack } from "../components/layout/BottomAudioPlayer";
import { useI18n } from "../i18n/context";
import {
  ACCENTS_BY_LANGUAGE,
  GENDER_OPTIONS,
  STYLE_OPTIONS,
  AGE_OPTIONS,
  LANGUAGE_REGISTRY,
  getGenderLabel,
  getAccentLabel,
  getStyleLabel,
  getAgeLabel,
  getVoiceSecondaryTags,
  getVoiceLanguageInfo,
  computeVisibleTags,
} from "../constants/voiceFilters";
import { CountryFlag } from "../components/common/CountryFlag";
import { VoiceProviderBadge } from "../components/common/VoiceProviderBadge";
import { HiddenTagsBadge } from "../components/common/HiddenTagsBadge";
import {
  decodeAudioFile,
  getOrCreateAudioContext,
} from "../services/audio/audioDsp";
import { AudioTrimModal } from "../components/clone/AudioTrimModal";
import { TestVoiceModal } from "../components/clone/TestVoiceModal";
import { EditVoiceModal } from "../components/clone/EditVoiceModal";
import { DeleteVoiceModal } from "../components/clone/DeleteVoiceModal";
import { CompactWaveform } from "../components/waveform";
import { SearchableLanguageSelect } from "../components/common/SearchableLanguageSelect";
import { ALL_STANDARD_LANGUAGES, findLanguage, LanguageItem } from "../services/subtitle/languages";

// Model definition with real capabilities
export interface CloneModelDefinition {
  id: string;
  name: string;
  engine: "omnivoice" | "chatterbox_turbo" | "qwen_tts_1_7b";
  badge: string;
  description: string;
  supportedLanguages: { code: string; label: string }[];
  supportsAutoLang: boolean;
  requiresTranscript: boolean;
  supportsNoiseReduction: boolean;
}

const AVATAR_PALETTES = [
  "from-pink-500 to-rose-600",
  "from-teal-500 to-emerald-600",
  "from-amber-500 to-orange-600",
  "from-violet-500 to-purple-600",
  "from-sky-500 to-blue-600",
  "from-indigo-500 to-cyan-600",
  "from-emerald-500 to-teal-600",
  "from-fuchsia-500 to-pink-600",
];

function getDeterministicAvatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}

const CLONE_MODELS: CloneModelDefinition[] = [
  {
    id: "omnivoice",
    name: "OmniVoice",
    engine: "omnivoice",
    badge: "Đa ngôn ngữ · Zero-shot",
    description: "Mô hình đa nhiệm hỗ trợ clone tức thì tiếng Việt và tiếng Anh, tự động phát hiện ngôn ngữ.",
    supportedLanguages: [
      { code: "auto", label: "Tự động phát hiện" },
      ...LANGUAGE_REGISTRY.map((l) => ({
        code: l.code,
        label: `${l.labels.vi} (${l.code.toUpperCase()})`,
      })),
    ],
    supportsAutoLang: true,
    requiresTranscript: false,
    supportsNoiseReduction: true,
  },
  {
    id: "chatterbox_turbo",
    name: "Chatterbox Turbo",
    engine: "chatterbox_turbo",
    badge: "Tốc độ cao · Độ trễ thấp",
    description: "Tối ưu hóa cho tốc độ tổng hợp nhanh và streaming thời gian thực, chuyên sâu tiếng Anh.",
    supportedLanguages: [
      { code: "en", label: "Tiếng Anh (EN)" },
    ],
    supportsAutoLang: false,
    requiresTranscript: false,
    supportsNoiseReduction: false,
  },
  {
    id: "qwen_tts_1_7b",
    name: "Qwen TTS",
    engine: "qwen_tts_1_7b",
    badge: "Neural trung thực cao",
    description: "Mô hình mạng nơ-ron sâu chất lượng phòng thu, phát huy tối đa khi cung cấp văn bản tham chiếu.",
    supportedLanguages: [
      { code: "vi", label: "Tiếng Việt (VI)" },
      { code: "zh", label: "Tiếng Trung (ZH)" },
      { code: "en", label: "Tiếng Anh (EN)" },
      { code: "ja", label: "Tiếng Nhật (JA)" },
      { code: "ko", label: "Tiếng Hàn (KO)" },
      { code: "de", label: "Tiếng Đức (DE)" },
      { code: "fr", label: "Tiếng Pháp (FR)" },
      { code: "es", label: "Tiếng Tây Ban Nha (ES)" },
      { code: "ru", label: "Tiếng Nga (RU)" },
      { code: "it", label: "Tiếng Ý (IT)" },
      { code: "pt", label: "Tiếng Bồ Đào Nha (PT)" },
    ],
    supportsAutoLang: false,
    requiresTranscript: true,
    supportsNoiseReduction: true,
  },
];

interface VoiceCloneWorkspaceProps {
  voices?: VoiceProfile[];
  onSaveVoice?: (newVoice: VoiceProfile) => void;
  onSaveToLibrary?: (newVoice: VoiceProfile) => void;
  onUpdateVoice?: (updatedVoice: VoiceProfile) => void;
  onDeleteVoice?: (voiceId: string) => void;
  onSelectForTts?: (voice: VoiceProfile) => void;
  onPlayTrack?: (track: ActiveAudioTrack) => void;
  activePlayingTrackId?: string | null;
  onStopPlaying?: () => void;
}



export const VoiceCloneWorkspace: React.FC<VoiceCloneWorkspaceProps> = ({
  voices = [],
  onSaveVoice,
  onSaveToLibrary,
  onUpdateVoice,
  onDeleteVoice,
  onSelectForTts,
  onPlayTrack,
  activePlayingTrackId,
  onStopPlaying,
}) => {
  const { t, lang } = useI18n();

  // Active Save handler
  const handleSaveToState = useCallback(
    (newVoice: VoiceProfile) => {
      if (onSaveVoice) onSaveVoice(newVoice);
      else if (onSaveToLibrary) onSaveToLibrary(newVoice);
    },
    [onSaveVoice, onSaveToLibrary]
  );

  // Model & Form State
  const [selectedModelId, setSelectedModelId] = useState<string>("omnivoice");
  const [voiceName, setVoiceName] = useState<string>("");
  const [selectedLang, setSelectedLang] = useState<string>("auto");

  // Structured Voice Classification State
  const [selectedGender, setSelectedGender] = useState<string>("female");
  const [selectedAge, setSelectedAge] = useState<string>("young");
  const [selectedAccent, setSelectedAccent] = useState<string>("vi-north");
  const [selectedStyles, setSelectedStyles] = useState<string[]>(["expressive"]);
  const [stylePopoverOpen, setStylePopoverOpen] = useState<boolean>(false);
  const stylePopoverRef = useRef<HTMLDivElement>(null);

  // Transcript State (Optional)
  const [referenceTranscript, setReferenceTranscript] = useState<string>("");

  // Reference Audio State
  const [referenceFileMeta, setReferenceFileMeta] = useState<{
    name: string;
    size: string;
    duration: string;
  } | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [trimRange, setTrimRange] = useState<{ startSec: number; endSec: number } | null>(null);

  // Reference Player State
  const [isPlayingReference, setIsPlayingReference] = useState<boolean>(false);
  const [refPlayCurrentSec, setRefPlayCurrentSec] = useState<number>(0);
  const refSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const refPlayTimerRef = useRef<number | null>(null);
  const refPlayStartRef = useRef<number>(0);

  // Creation Action State
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [creationProgress, setCreationProgress] = useState<number>(0);
  const [creationStatusText, setCreationStatusText] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Cloned Voices Right Column State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name">("newest");
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);

  // Modals State
  const [trimModalOpen, setTrimModalOpen] = useState<boolean>(false);
  const [testModalOpen, setTestModalOpen] = useState<boolean>(false);
  const [editModalOpen, setEditModalOpen] = useState<boolean>(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [activeVoiceForModal, setActiveVoiceForModal] = useState<VoiceProfile | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Current Model Definition
  const currentModel = useMemo(() => {
    return CLONE_MODELS.find((m) => m.id === selectedModelId) || CLONE_MODELS[0];
  }, [selectedModelId]);

  const cloneModelLanguages: LanguageItem[] = useMemo(() => {
    return currentModel.supportedLanguages.map((l) => {
      const match = findLanguage(l.code, ALL_STANDARD_LANGUAGES);
      if (l.code === "auto") {
        return {
          code: "auto",
          name: lang === "vi" ? "Tự động phát hiện" : "Auto Detect",
          englishName: "Auto Detect",
          isPopular: true,
        };
      }
      return {
        code: l.code,
        name: match?.name || l.label,
        nativeName: match?.nativeName,
        englishName: match?.englishName,
        isPopular: match?.isPopular,
      };
    });
  }, [currentModel.supportedLanguages, lang]);

  // Adjust language when model changes
  useEffect(() => {
    const validCodes = currentModel.supportedLanguages.map((l) => l.code);
    if (!validCodes.includes(selectedLang)) {
      setSelectedLang(validCodes[0] || "vi");
    }
  }, [currentModel, selectedLang]);

  // Effective language & dynamic accents for the selected language
  const effectiveLang = selectedLang === "auto" ? "vi" : selectedLang;
  const availableAccents = useMemo(() => {
    return ACCENTS_BY_LANGUAGE[effectiveLang] || [];
  }, [effectiveLang]);

  // Adjust selectedAccent when language changes
  useEffect(() => {
    if (selectedAccent && availableAccents.length > 0 && !availableAccents.some((a) => a.id === selectedAccent)) {
      setSelectedAccent(availableAccents[0]?.id || "");
    }
  }, [availableAccents, selectedAccent]);

  // Outside click listener for Style Popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        stylePopoverRef.current &&
        !stylePopoverRef.current.contains(event.target as Node)
      ) {
        setStylePopoverOpen(false);
      }
    }
    if (stylePopoverOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [stylePopoverOpen]);

  // Outside click listener for Card Context Menu
  useEffect(() => {
    function handleClickOutside() {
      if (openCardMenuId) {
        setOpenCardMenuId(null);
      }
    }
    if (openCardMenuId) {
      document.addEventListener("click", handleClickOutside);
    }
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [openCardMenuId]);



  // Filter cloned voices for right column
  const clonedVoices = useMemo(() => {
    return voices.filter(
      (v) => v.origin === "clone" || v.source === "local_clone" || v.id.startsWith("clone_")
    );
  }, [voices]);

  // Search & Sort Cloned Voices
  const displayVoices = useMemo(() => {
    let list = [...clonedVoices];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((v) => {
        if (v.name.toLowerCase().includes(q)) return true;
        if ((v.modelCompatibility || []).some((m) => m.toLowerCase().includes(q))) return true;
        const cardTags = getVoiceSecondaryTags(v, lang);
        if (cardTags.some((tItem) => tItem.toLowerCase().includes(q))) return true;
        if ((v.tags || []).some((tItem) => tItem.toLowerCase().includes(q))) return true;
        return false;
      });
    }

    if (sortBy === "newest") {
      list.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });
    } else if (sortBy === "oldest") {
      list.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
      });
    } else if (sortBy === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [clonedVoices, searchQuery, sortBy]);

  // Handle uploaded file
  const handleFileChange = async (file: File) => {
    try {
      const { buffer, objectUrl } = await decodeAudioFile(file);

      setAudioBuffer(buffer);
      setAudioUrl(objectUrl);
      setTrimRange(null);
      setReferenceFileMeta({
        name: file.name,
        size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        duration: `${buffer.duration.toFixed(1)}s`,
      });

      // Suggest voice name if empty
      if (!voiceName.trim()) {
        const base = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        setVoiceName(base.charAt(0).toUpperCase() + base.slice(1));
      }
    } catch (e: any) {
      alert(`Không thể đọc file âm thanh: ${e?.message || "File hỏng hoặc không đúng định dạng"}`);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // Toggle Playing Reference Audio
  const stopReferencePlayback = useCallback(() => {
    if (refSourceNodeRef.current) {
      try {
        refSourceNodeRef.current.stop();
        refSourceNodeRef.current.disconnect();
      } catch (e) {
        // ignore
      }
      refSourceNodeRef.current = null;
    }
    if (refPlayTimerRef.current) {
      clearInterval(refPlayTimerRef.current);
      refPlayTimerRef.current = null;
    }
    setIsPlayingReference(false);
  }, []);

  const handleTogglePlayReference = () => {
    if (isPlayingReference) {
      stopReferencePlayback();
      return;
    }

    if (!audioBuffer) return;

    try {
      stopReferencePlayback();
      const ctx = getOrCreateAudioContext();
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      refPlayStartRef.current = ctx.currentTime;
      setRefPlayCurrentSec(0);
      setIsPlayingReference(true);

      source.onended = () => {
        setIsPlayingReference(false);
        if (refPlayTimerRef.current) {
          clearInterval(refPlayTimerRef.current);
          refPlayTimerRef.current = null;
        }
      };

      source.start(0);
      refSourceNodeRef.current = source;

      refPlayTimerRef.current = window.setInterval(() => {
        const elapsed = ctx.currentTime - refPlayStartRef.current;
        if (elapsed >= audioBuffer.duration) {
          stopReferencePlayback();
        } else {
          setRefPlayCurrentSec(elapsed);
        }
      }, 50);
    } catch (e) {
      console.error("Reference playback error:", e);
      setIsPlayingReference(false);
    }
  };

  // Apply Trim result
  const handleApplyTrim = (
    trimmedBuffer: AudioBuffer,
    _trimmedBlob: Blob,
    trimmedUrl: string,
    range: { startSec: number; endSec: number }
  ) => {
    stopReferencePlayback();
    setAudioBuffer(trimmedBuffer);
    setAudioUrl(trimmedUrl);
    setTrimRange(range);
    if (referenceFileMeta) {
      setReferenceFileMeta({
        ...referenceFileMeta,
        duration: `${trimmedBuffer.duration.toFixed(1)}s (đã cắt)`,
      });
    }
  };

  // Styles management
  const handleToggleStyle = (styleId: string) => {
    setSelectedStyles((prev) =>
      prev.includes(styleId) ? prev.filter((s) => s !== styleId) : [...prev, styleId]
    );
  };

  const handleRemoveStyle = (styleId: string) => {
    setSelectedStyles((prev) => prev.filter((s) => s !== styleId));
  };

  // Create Voice Action
  const handleCreateVoice = () => {
    if (!voiceName.trim() || !audioBuffer) return;

    setIsCreating(true);
    setCreationProgress(15);
    setCreationStatusText(
      lang === "vi" ? "Đang phân tích âm sắc mẫu..." : "Analyzing reference timbre..."
    );

    setTimeout(() => {
      setCreationProgress(55);
      setCreationStatusText(
        lang === "vi"
          ? "Trích xuất embedding & timbre đặc trưng..."
          : "Extracting speaker embedding & acoustic characteristics..."
      );
    }, 450);

    setTimeout(() => {
      setCreationProgress(90);
      setCreationStatusText(
        lang === "vi" ? "Đóng gói Voice Profile..." : "Packaging Voice Profile..."
      );
    }, 900);

    setTimeout(() => {
      const nowIso = new Date().toISOString();
      const newVoice: VoiceProfile = {
        id: `clone_${Date.now()}`,
        name: voiceName.trim(),
        source: "local_clone",
        origin: "clone",
        engine: currentModel.engine,
        sourceType: "local",
        provider: "local",
        country: effectiveLang === "vi" ? "VN" : effectiveLang.toUpperCase(),
        gender: (selectedGender === "male" || selectedGender === "female") ? selectedGender : undefined,
        accent: selectedAccent || undefined,
        styles: selectedStyles.length > 0 ? selectedStyles : ["natural"],
        style: selectedStyles[0] || "natural",
        category: selectedStyles[0] || "natural",
        ageGroup: selectedAge || undefined,
        tags: [],
        supportedLanguages: selectedLang === "auto" ? ["vi", "en"] : [selectedLang],
        modelCompatibility: [currentModel.name],
        availability: "available",
        previewAvailable: true,
        createdAt: nowIso,
        lastUsedAt: nowIso,
        isFavorite: false,
        avatarColor: "from-accent to-teal-500",
        sampleAudioPath: referenceFileMeta?.name || "reference_clone.wav",
        ...(referenceTranscript.trim() ? { referenceTranscript: referenceTranscript.trim() } : {}),
      };

      handleSaveToState(newVoice);

      setIsCreating(false);
      setCreationProgress(100);
      setCreationStatusText("");

      // Toast feedback
      setToastMessage(
        lang === "vi"
          ? `Đã tạo thành công giọng "${voiceName.trim()}"`
          : `Voice "${voiceName.trim()}" created successfully`
      );
      setTimeout(() => setToastMessage(null), 3500);

      // Reset form
      setVoiceName("");
      setReferenceTranscript("");
    }, 1250);
  };

  // Play a voice card sample
  const handlePlayVoiceCard = (voice: VoiceProfile) => {
    if (onPlayTrack) {
      if (activePlayingTrackId === voice.id) {
        if (onStopPlaying) onStopPlaying();
      } else {
        const cleanName = voice.name.replace(/\s*\(Clone\)$/i, "");
        onPlayTrack({
          id: voice.id,
          voiceName: cleanName,
          title: `Bản thử · ${cleanName}`,
          durationSec: 18.5,
          audioUrl: voice.sampleAudioPath,
          text: `Bản nghe thử giọng ${cleanName}`,
        });
      }
    }
  };

  // Download reference audio
  const handleDownloadReference = (voice: VoiceProfile) => {
    const cleanName = voice.name.replace(/\s*\(Clone\)$/i, "");
    const a = document.createElement("a");
    a.href = audioUrl || "#";
    a.download = `${cleanName.toLowerCase().replace(/\s+/g, "_")}_reference.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-14 right-6 z-50 flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl shadow-xl animate-fade-in border border-emerald-400/30">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Workspace Frame: 2-Column Split */}
      <div className="flex-1 flex flex-col h-full overflow-hidden p-4 sm:p-5">
        {/* 2-Column Split: Left (380-390px) + Right (flex-grow) */}
        <div className="flex-1 flex flex-col lg:flex-row gap-5 min-h-0 overflow-hidden">
          {/* ======================================================== */}
          {/* LEFT COLUMN: CREATE VOICE PANEL (380–390px)              */}
          {/* ======================================================== */}
          <div className="w-full lg:w-[380px] xl:w-[390px] flex flex-col bg-surface1 rounded-xl border border-borderDefault shrink-0 overflow-hidden shadow-xs">
            {/* Scrollable Form Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {/* 1. TÊN GIỌNG NÓI */}
              <div className="space-y-1.5">
                <label className="block text-textSecondary font-medium">Tên giọng nói</label>
                <input
                  type="text"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  placeholder="VD: Thảo Vy"
                  className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs text-textPrimary focus:border-accent focus:outline-none"
                />
              </div>

              {/* 2. MODEL */}
              <div className="space-y-1.5">
                <label className="block text-textSecondary font-medium">Model</label>
                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  className="w-full bg-surface2 border border-borderDefault rounded-lg px-3 py-2 text-xs text-textPrimary focus:border-accent focus:outline-none"
                >
                  {CLONE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. NGÔN NGỮ */}
              <div className="space-y-1.5">
                <label className="block text-textSecondary font-medium">
                  {lang === "vi" ? "Ngôn ngữ" : "Language"}
                </label>
                <SearchableLanguageSelect
                  value={selectedLang}
                  onChange={(code) => setSelectedLang(code)}
                  languages={cloneModelLanguages}
                  searchPlaceholder={lang === "vi" ? "Tìm ngôn ngữ..." : "Search language..."}
                  size="md"
                  showGlobe={true}
                />
              </div>

              {/* 4. ÂM THANH THAM CHIẾU */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-textSecondary font-medium">Âm thanh tham chiếu</label>
                  <span className="text-[11px] text-textMuted">10s – 30s</span>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleFileChange(e.target.files[0]);
                  }}
                />

                {audioBuffer && referenceFileMeta ? (
                  /* Audio Reference Component */
                  <div className="p-4 bg-surface2/60 rounded-xl border border-borderDefault space-y-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-accent shrink-0">
                          <FileAudio className="w-4.5 h-4.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-textPrimary truncate" title={referenceFileMeta.name}>
                            {referenceFileMeta.name}
                          </div>
                          <div className="text-[11px] text-textMuted font-mono mt-0.5">
                            {referenceFileMeta.duration} • {(audioBuffer.sampleRate / 1000).toFixed(1)}kHz • {audioBuffer.numberOfChannels === 1 ? "Mono" : "Stereo"}
                          </div>
                        </div>
                      </div>

                      {/* Play / Pause button */}
                      <button
                        onClick={handleTogglePlayReference}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 ${
                          isPlayingReference
                            ? "bg-rose-500 text-white shadow-md animate-pulse"
                            : "bg-accent text-background hover:bg-accent/90"
                        }`}
                        title={isPlayingReference ? "Dừng nghe" : "Nghe mẫu"}
                      >
                        {isPlayingReference ? (
                          <Pause className="w-4 h-4 fill-current" />
                        ) : (
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        )}
                      </button>
                    </div>

                    {/* High-density PCM waveform */}
                    <div className="bg-surface3/40 rounded-lg p-1 border border-borderDefault/40 select-none overflow-hidden">
                      <CompactWaveform
                        audioBuffer={audioBuffer}
                        isPlaying={isPlayingReference}
                        currentTime={refPlayCurrentSec}
                        duration={audioBuffer.duration}
                        height={36}
                      />
                    </div>

                    {/* Action Bar: Trim & Change File */}
                    <div className="flex items-center justify-between pt-1">
                      <button
                        onClick={() => setTrimModalOpen(true)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-surface3 hover:bg-surface2 border border-borderDefault rounded-lg text-textPrimary hover:text-accent font-semibold text-xs transition-colors"
                      >
                        <Scissors className="w-3.5 h-3.5 text-accent" />
                        <span>{lang === "vi" ? "Cắt" : "Trim"}</span>
                      </button>

                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs text-accent hover:underline font-semibold transition-colors"
                      >
                        {lang === "vi" ? "Đổi file" : "Change file"}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Empty Dropzone */
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    className="border-2 border-dashed border-borderDefault hover:border-accent/70 hover:bg-accent/5 rounded-xl p-7 text-center cursor-pointer transition-all bg-surface2/30 space-y-2.5 group"
                  >
                    <div className="w-11 h-11 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent mx-auto group-hover:scale-110 transition-transform">
                      <UploadCloud className="w-5.5 h-5.5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-textPrimary group-hover:text-accent transition-colors">
                        Kéo thả file âm thanh vào đây hoặc ấn để chọn
                      </p>
                      <p className="text-[11px] text-textMuted mt-1">
                        Hỗ trợ WAV, MP3, M4A, FLAC (khuyến nghị 10s – 30s)
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* 5. VĂN BẢN THAM CHIẾU */}
              <div className="space-y-1.5">
                <label className="block text-textSecondary font-medium">
                  {lang === "vi" ? "Văn bản tham chiếu (không bắt buộc)" : "Reference Transcript (Optional)"}
                </label>
                <textarea
                  rows={2}
                  value={referenceTranscript}
                  onChange={(e) => setReferenceTranscript(e.target.value)}
                  placeholder={
                    lang === "vi"
                      ? "Nội dung lời nói trong file âm thanh (giúp mô hình clone chính xác hơn)..."
                      : "Spoken words in audio file (helps clone more accurately)..."
                  }
                  className="w-full bg-surface2 border border-borderDefault rounded-lg p-2.5 text-xs text-textPrimary focus:border-accent focus:outline-none resize-none leading-relaxed cursor-text caret-accent"
                />
              </div>

              {/* 6. PHÂN LOẠI (STRUCTURED VOICE TAXONOMY) */}
              <div className="space-y-3 p-3.5 rounded-xl border border-borderDefault bg-surface2/30">
                <div className="flex items-center">
                  <span className="text-xs font-semibold text-textPrimary flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-accent" />
                    <span>{lang === "vi" ? "Phân loại" : "Voice Attributes"}</span>
                  </span>
                </div>

                {/* Row 1: Gender & Age (2 columns) */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] text-textSecondary font-medium">
                      {lang === "vi" ? "Giới tính" : "Gender"}
                    </label>
                    <select
                      value={selectedGender}
                      onChange={(e) => setSelectedGender(e.target.value)}
                      className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none"
                    >
                      <option value="">{lang === "vi" ? "Chưa chọn" : "Not specified"}</option>
                      {GENDER_OPTIONS.map((g) => (
                        <option key={g.id} value={g.id}>
                          {getGenderLabel(g.id, lang)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] text-textSecondary font-medium">
                      {lang === "vi" ? "Độ tuổi" : "Age Group"}
                    </label>
                    <select
                      value={selectedAge}
                      onChange={(e) => setSelectedAge(e.target.value)}
                      className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none"
                    >
                      <option value="">{lang === "vi" ? "Chưa chọn" : "Not specified"}</option>
                      {AGE_OPTIONS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {getAgeLabel(a.id, lang)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 2: Vùng / Accent (Linked dynamically to chosen language) */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] text-textSecondary font-medium">
                    {lang === "vi" ? "Vùng / Accent" : "Accent / Region"}
                  </label>
                  <select
                    value={selectedAccent}
                    onChange={(e) => setSelectedAccent(e.target.value)}
                    disabled={availableAccents.length === 0}
                    className="w-full bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">{lang === "vi" ? "Chưa chọn" : "Not specified"}</option>
                    {availableAccents.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {getAccentLabel(acc.id, lang)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Row 3: Phong cách (Style) - Multi-select Chips + Checklist Popover */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] text-textSecondary font-medium">
                    {lang === "vi" ? "Phong cách" : "Styles"}
                  </label>

                  <div className="p-2 bg-surface2/60 rounded-lg border border-borderDefault min-h-[38px] flex flex-wrap items-center gap-1.5 relative">
                    {selectedStyles.map((styleId) => (
                      <span
                        key={styleId}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface3 border border-borderDefault text-textPrimary text-[11px] font-medium animate-fade-in"
                      >
                        <span>{getStyleLabel(styleId, lang)}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveStyle(styleId)}
                          className="text-textMuted hover:text-rose-400 transition-colors"
                          title="Xóa phong cách"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}

                    {/* Popover trigger button */}
                    <div className="relative inline-block" ref={stylePopoverRef}>
                      <button
                        type="button"
                        onClick={() => setStylePopoverOpen(!stylePopoverOpen)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-dashed border-borderDefault hover:border-accent/80 text-textMuted hover:text-accent text-[11px] transition-colors bg-surface2/80"
                      >
                        <Plus className="w-3 h-3" />
                        <span>{lang === "vi" ? "Chọn phong cách" : "Add style"}</span>
                      </button>

                      {/* Popover dropdown checklist */}
                      {stylePopoverOpen && (
                        <div className="absolute left-0 top-full mt-1.5 w-64 max-h-56 overflow-y-auto bg-surface1 border border-borderDefault rounded-xl shadow-xl p-2 z-50 animate-fade-in space-y-1">
                          <div className="px-2 py-1 text-[11px] font-bold text-textMuted uppercase tracking-wider border-b border-borderDefault/60 flex items-center justify-between">
                            <span>{lang === "vi" ? "Danh sách phong cách" : "Style List"}</span>
                            <button
                              type="button"
                              onClick={() => setStylePopoverOpen(false)}
                              className="text-textMuted hover:text-textPrimary"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="pt-1 space-y-0.5">
                            {STYLE_OPTIONS.map((st) => {
                              const isSelected = selectedStyles.includes(st.id);
                              return (
                                <button
                                  key={st.id}
                                  type="button"
                                  onClick={() => handleToggleStyle(st.id)}
                                  className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center justify-between text-xs transition-colors ${
                                    isSelected
                                      ? "bg-accent/15 text-accent font-medium"
                                      : "hover:bg-surface2 text-textPrimary"
                                  }`}
                                >
                                  <span>{getStyleLabel(st.id, lang)}</span>
                                  {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-accent" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Panel CTA Footer */}
            <div className="p-4 border-t border-borderDefault bg-surface2/40 space-y-2 shrink-0">
              {isCreating && (
                <div className="space-y-1.5 animate-fade-in">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-accent font-semibold">{creationStatusText}</span>
                    <span className="font-mono text-textMuted">{creationProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface3 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-300 rounded-full"
                      style={{ width: `${creationProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {(() => {
                const isFormReady = !isCreating && Boolean(voiceName.trim()) && Boolean(audioBuffer);
                return (
                  <button
                    onClick={handleCreateVoice}
                    disabled={!isFormReady}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-xs transition-all shadow-md ${
                      isFormReady
                        ? "bg-accent hover:bg-accent/90 text-background cursor-pointer active:scale-[0.99] shadow-accent/20"
                        : "bg-surface3 text-textMuted border border-borderDefault/70 opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>
                      {isCreating
                        ? lang === "vi"
                          ? "Đang xử lý..."
                          : "Processing..."
                        : lang === "vi"
                        ? "Tạo giọng nói"
                        : "Create Voice"}
                    </span>
                  </button>
                );
              })()}
            </div>
          </div>

          {/* ======================================================== */}
          {/* RIGHT COLUMN: CLONED VOICES LIST (flex-grow)             */}
          {/* ======================================================== */}
          <div className="flex-1 flex flex-col bg-surface1 rounded-xl border border-borderDefault min-w-0 overflow-hidden shadow-xs">
            {/* Header: Title, Count Badge, Search, Sort */}
            <div className="p-4 border-b border-borderDefault bg-surface2/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-textPrimary">Giọng đã nhân bản</h3>
                <span className="px-2 py-0.5 rounded-full bg-accent/20 text-accent font-semibold text-[11px]">
                  {clonedVoices.length} giọng
                </span>
              </div>

              {/* Search & Sort Controls */}
              <div className="flex items-center gap-2.5">
                {/* Search Input */}
                <div className="relative w-52 sm:w-64">
                  <Search className="w-3.5 h-3.5 text-textMuted absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Tìm kiếm giọng..."
                    className="w-full bg-surface2 border border-borderDefault rounded-lg pl-8 pr-7 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-2 text-textMuted hover:text-textPrimary"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Sort Dropdown */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-surface2 border border-borderDefault rounded-lg px-2.5 py-1.5 text-xs text-textPrimary focus:border-accent focus:outline-none"
                >
                  <option value="newest">Mới nhất</option>
                  <option value="oldest">Cũ nhất</option>
                  <option value="name">Tên A-Z</option>
                </select>
              </div>
            </div>

            {/* Voice Cards Grid / Empty State */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {displayVoices.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-4">
                  {displayVoices.map((voice) => {
                    const isPlayingThisVoice = activePlayingTrackId === voice.id;
                    const cleanVoiceName = voice.name.replace(/\s*\(Clone\)$/i, "");
                    const langInfo = getVoiceLanguageInfo(voice, lang);
                    const secondaryTags = getVoiceSecondaryTags(voice, lang);
                    const { visibleTags, hiddenTags } = computeVisibleTags(secondaryTags);

                    return (
                      <div
                        key={voice.id}
                        className={`rounded-xl p-4 transition-all flex flex-col justify-between group relative ${
                          isPlayingThisVoice
                            ? "bg-surface1 border-2 border-accent shadow-md shadow-accent/15 ring-1 ring-accent/30"
                            : "bg-surface1 border border-borderDefault hover:border-accent/50 shadow-2xs hover:shadow-xs"
                        }`}
                      >
                        <div>
                          {/* Header: Avatar, Name, Language with Flag, Provider Badge, Preview button */}
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div
                                className={`w-10 h-10 rounded-full bg-gradient-to-tr ${
                                  voice.avatarColor || getDeterministicAvatarColor(cleanVoiceName)
                                } flex items-center justify-center text-white font-bold text-sm shadow-xs flex-shrink-0 transition-transform ${
                                  isPlayingThisVoice
                                    ? "ring-2 ring-accent ring-offset-2 ring-offset-surface1 scale-105"
                                    : ""
                                }`}
                              >
                                {cleanVoiceName.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <h3
                                  className="text-sm font-semibold text-textPrimary group-hover:text-accent transition-colors truncate"
                                  title={cleanVoiceName}
                                >
                                  {cleanVoiceName}
                                </h3>
                                {/* Row 2: Prioritized Language with Flag + Provider Badge */}
                                <div className="flex items-center gap-2 mt-1 text-xs text-textSecondary font-medium min-h-[18px]">
                                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                                    <CountryFlag
                                      countryCode={langInfo.countryCode || langInfo.code}
                                      className="w-4 h-3 rounded-[2px] shadow-xs shrink-0 overflow-hidden inline-flex items-center justify-center align-middle"
                                    />
                                    <span className="truncate leading-none" title={langInfo.countryName || langInfo.name}>
                                      {langInfo.countryName || langInfo.name}
                                    </span>
                                  </div>
                                  <VoiceProviderBadge voice={voice} />
                                </div>
                              </div>
                            </div>

                            {/* Play Preview */}
                            <button
                              onClick={() => handlePlayVoiceCard(voice)}
                              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                                isPlayingThisVoice
                                  ? "bg-rose-500 text-white shadow-md animate-pulse"
                                  : "bg-surface2 hover:bg-accent hover:text-background text-textSecondary"
                              }`}
                              title={
                                isPlayingThisVoice
                                  ? t.voiceModal?.stopPreview || (lang === "vi" ? "Dừng nghe" : "Stop preview")
                                  : t.voiceModal?.previewVoice || (lang === "vi" ? "Nghe mẫu" : "Preview voice")
                              }
                              aria-label={isPlayingThisVoice ? "Stop preview" : "Preview voice"}
                            >
                              {isPlayingThisVoice ? (
                                <Pause className="w-3.5 h-3.5 fill-current" />
                              ) : (
                                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                              )}
                            </button>
                          </div>

                          {/* Single-line tags placed below */}
                          <div className="flex items-center gap-1.5 mb-4 min-h-[20px] flex-nowrap whitespace-nowrap">
                            {visibleTags.length > 0 ? (
                              visibleTags.map((tag, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center h-5 px-1.5 py-0.5 rounded-md bg-surface3/70 text-textSecondary text-[10px] font-medium border border-borderDefault/50 truncate shrink-0"
                                >
                                  {tag}
                                </span>
                              ))
                            ) : (
                              <span className="inline-flex items-center h-5 px-1.5 py-0.5 rounded-md bg-surface2 text-textMuted text-[10px] font-medium border border-borderDefault/40 truncate shrink-0">
                                {voice.modelCompatibility?.[0] || voice.engine || (lang === "vi" ? "Tự nhiên" : "Natural")}
                              </span>
                            )}
                            <HiddenTagsBadge hiddenTags={hiddenTags} lang={lang} />
                          </div>
                        </div>

                        {/* Actions Footer */}
                        <div className="pt-3 border-t border-borderDefault flex items-center justify-between">
                          {onSelectForTts ? (
                            <button
                              onClick={() => onSelectForTts(voice)}
                              className="flex items-center gap-1.5 text-xs text-accent hover:underline font-semibold"
                            >
                              <span>{lang === "vi" ? "Dùng trong TTS" : "Use in TTS"}</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <div />
                          )}

                          {/* 3-dots more options menu (Test, Edit, Download, Delete) */}
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenCardMenuId(openCardMenuId === voice.id ? null : voice.id);
                              }}
                              className="p-1.5 rounded-lg text-textMuted hover:text-textPrimary hover:bg-surface2 transition-colors"
                              title={lang === "vi" ? "Tùy chọn khác" : "More options"}
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>

                            {openCardMenuId === voice.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 bottom-full mb-1 w-44 bg-surface1 border border-borderDefault rounded-xl shadow-xl p-1.5 z-40 animate-fade-in text-xs"
                              >
                                <button
                                  onClick={() => {
                                    setOpenCardMenuId(null);
                                    setActiveVoiceForModal(voice);
                                    setTestModalOpen(true);
                                  }}
                                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-surface2 text-textPrimary flex items-center gap-2 transition-colors"
                                >
                                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                                  <span>{lang === "vi" ? "Thử giọng (Test)" : "Test voice"}</span>
                                </button>

                                <button
                                  onClick={() => {
                                    setOpenCardMenuId(null);
                                    setActiveVoiceForModal(voice);
                                    setEditModalOpen(true);
                                  }}
                                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-surface2 text-textPrimary flex items-center gap-2 transition-colors"
                                >
                                  <Edit2 className="w-3.5 h-3.5 text-textSecondary" />
                                  <span>{lang === "vi" ? "Chỉnh sửa" : "Edit voice"}</span>
                                </button>

                                <button
                                  onClick={() => {
                                    setOpenCardMenuId(null);
                                    handleDownloadReference(voice);
                                  }}
                                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-surface2 text-textPrimary flex items-center gap-2 transition-colors"
                                >
                                  <Download className="w-3.5 h-3.5 text-textSecondary" />
                                  <span>{lang === "vi" ? "Tải tệp mẫu" : "Download reference"}</span>
                                </button>

                                <div className="my-1 border-t border-borderDefault/60" />

                                <button
                                  onClick={() => {
                                    setOpenCardMenuId(null);
                                    setActiveVoiceForModal(voice);
                                    setDeleteModalOpen(true);
                                  }}
                                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-950/30 text-rose-400 flex items-center gap-2 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>{lang === "vi" ? "Xóa giọng" : "Delete voice"}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Empty State */
                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
                  <div className="w-16 h-16 rounded-full border border-borderDefault bg-surface2/60 flex items-center justify-center text-textMuted mb-2">
                    <Mic className="w-8 h-8 text-accent/60" />
                  </div>
                  <h3 className="text-sm font-bold text-textPrimary">Chưa có giọng nhân bản nào</h3>
                  <p className="text-xs text-textMuted max-w-sm">
                    Tải một mẫu âm thanh lên ở cột bên trái và bấm <strong>Tạo giọng nói</strong> để bắt đầu tạo giọng đầu tiên của bạn.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* MODALS */}
      {/* 1. Audio Trim Modal */}
      <AudioTrimModal
        isOpen={trimModalOpen}
        onClose={() => setTrimModalOpen(false)}
        audioBuffer={audioBuffer}
        objectUrl={audioUrl}
        initialRange={trimRange || undefined}
        onApplyTrim={handleApplyTrim}
      />

      {/* 2. Test Voice Modal */}
      <TestVoiceModal
        isOpen={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        voice={activeVoiceForModal}
        onPlayTestTrack={(track) => {
          if (onPlayTrack) {
            onPlayTrack(track);
          }
        }}
      />

      {/* 3. Edit Voice Modal */}
      <EditVoiceModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        voice={activeVoiceForModal}
        onSave={(updated) => {
          if (onUpdateVoice) {
            onUpdateVoice(updated);
          }
        }}
      />

      {/* 4. Delete Voice Modal */}
      <DeleteVoiceModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        voice={activeVoiceForModal}
        onConfirmDelete={(voiceId) => {
          if (onDeleteVoice) {
            onDeleteVoice(voiceId);
          }
        }}
      />
    </div>
  );
};

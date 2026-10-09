import { useState, useEffect, useCallback } from "react";
import { TopBar } from "./components/layout/TopBar";
import { Sidebar } from "./components/layout/Sidebar";
import { BottomAudioPlayer, ActiveAudioTrack } from "./components/layout/BottomAudioPlayer";
import { TtsInspector, loadStoredTtsSettings } from "./components/inspector/TtsInspector";
import { batchQueueExecutor } from "./services/concurrencyExecutor";
import { MigrationModal } from "./components/modals/MigrationModal";
import { ExportValidationModal } from "./components/modals/ExportValidationModal";
import { VoiceSelectionModal } from "./components/modals/VoiceSelectionModal";
import { TtsWorkspace } from "./views/TtsWorkspace";
import { DialogueWorkspace } from "./views/DialogueWorkspace";
import { VoiceCloneWorkspace } from "./views/VoiceCloneWorkspace";
import { VoiceLibraryWorkspace } from "./views/VoiceLibraryWorkspace";
import { TranscriptionWorkspace } from "./views/TranscriptionWorkspace";
import { DubbingWorkspace } from "./views/DubbingWorkspace";
import { BatchWorkspace } from "./views/BatchWorkspace";
import { HistoryWorkspace } from "./views/HistoryWorkspace";
import { SettingsWorkspace } from "./views/SettingsWorkspace";
import { WorkspaceId, ChunkItem, VoiceProfile, SettingsGroup } from "./types/ui";
import { DubbingHandoffSnapshot } from "./types/dubbing";
import { migrateSubtitleAndTranslationSettings } from "./services/translation";
import { MOCK_VOICES, MOCK_CHUNKS } from "./mock/data";
import { I18nProvider, useI18n } from "./i18n/context";
import { migrateLegacyVoice } from "./constants/voiceFilters";
import { LicenseModal } from "./components/modals/LicenseModal";
import { LicenseSummary } from "./services/license/licenseService";
import { CheckCircle2, X } from "lucide-react";

function AppContent() {
  const { t: _t } = useI18n();

  // Run settings schema migration once on startup
  useEffect(() => {
    migrateSubtitleAndTranslationSettings();
  }, []);

  // Initial license check: Tạm thời vô hiệu hóa theo yêu cầu PO (sẽ xử lý sau khi hoàn thành toàn bộ app)
  const [initialLicenseModalOpen, setInitialLicenseModalOpen] = useState(false);
  const [appToast, setAppToast] = useState<string | null>(null);

  const handleInitialLicenseSuccess = (license: LicenseSummary) => {
    setAppToast(`Kích hoạt bản quyền thành công! Hạn dùng: ${license.expires_at_formatted}`);
    setTimeout(() => setAppToast(null), 4000);
  };

  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>(() => {
    try {
      const saved = localStorage.getItem("voxlab_active_workspace");
      if (saved && ["tts", "dialogue", "clone", "library", "transcription", "dubbing", "batch", "history", "settings"].includes(saved)) {
        return saved as WorkspaceId;
      }
    } catch {}
    return "library";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(340);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const saved = localStorage.getItem("voxlab_theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch {
      // ignore
    }
    return "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
      root.setAttribute("data-theme", "dark");
      root.style.colorScheme = "dark";
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
      root.setAttribute("data-theme", "light");
      root.style.colorScheme = "light";
    }
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("voxlab_theme", next);
      } catch {
        // ignore
      }
      return next;
    });
  };

const VOICES_STORAGE_KEY = "voxlab_voices_v1";

function loadInitialVoices(): VoiceProfile[] {
  try {
    const raw = localStorage.getItem(VOICES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(migrateLegacyVoice);
      }
    }
  } catch (e) {
    // fallback to mock voices
  }
  return MOCK_VOICES.map(migrateLegacyVoice);
}

  // Voice State
  const [voices, setVoices] = useState<VoiceProfile[]>(loadInitialVoices);
  const [activeVoiceId, setActiveVoiceId] = useState<string>("voice_01");
  const [activeModel, setActiveModel] = useState<string>("Omni Voice");
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);

  // Sync voices to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(VOICES_STORAGE_KEY, JSON.stringify(voices));
    } catch (e) {
      // ignore
    }
  }, [voices]);

  // TTS State
  const [selectedChunk, setSelectedChunk] = useState<ChunkItem | null>(MOCK_CHUNKS[0]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [concurrency, setConcurrency] = useState<number>(() => loadStoredTtsSettings().concurrency);
  const [exportSrt, setExportSrt] = useState<boolean>(() => !!loadStoredTtsSettings().exportSrt);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(7);

  // Global Audio Preview Player State
  const [activeAudioTrack, setActiveAudioTrack] = useState<ActiveAudioTrack | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  const handleTogglePlay = useCallback(() => {
    setIsAudioPlaying((prev) => !prev);
  }, []);

  const handlePlayChunk = (chunk: ChunkItem) => {
    const voice = voices.find((v) => v.id === (chunk.voiceOverrideId || activeVoiceId));
    const speakerName = voice?.name || "Thảo Trinh";

    if (activeAudioTrack?.id === chunk.id && activeAudioTrack?.audioUrl === chunk.audioUrl) {
      setIsAudioPlaying((prev) => !prev);
      return;
    }

    setActiveAudioTrack({
      id: chunk.id,
      chunkIndex: chunk.index,
      voiceName: speakerName,
      title: (chunk as any).title,
      durationSec: chunk.durationSec || 34,
      audioUrl: chunk.audioUrl,
      text: chunk.text,
    });
    setIsAudioPlaying(true);
  };

  const handleCloseAudioPlayer = () => {
    setActiveAudioTrack(null);
    setIsAudioPlaying(false);
  };

  // Modals State
  const [migrationModalOpen, setMigrationModalOpen] = useState(false);
  const [migrationOldPath, setMigrationOldPath] = useState("");
  const [migrationNewPath, setMigrationNewPath] = useState("");
  const [exportValidationOpen, setExportValidationOpen] = useState(false);
  const [invalidChunksForExport, setInvalidChunksForExport] = useState<ChunkItem[]>([]);

  // Check if current setup uses an online service
  const currentVoice = voices.find((v) => v.id === activeVoiceId);
  const isOnlineActive = currentVoice?.isOnline || false;

  // Dubbing Workspace State
  const [dubbingSnapshot, setDubbingSnapshot] = useState<DubbingHandoffSnapshot | null>(null);
  const [settingsInitialGroup, setSettingsInitialGroup] = useState<SettingsGroup | undefined>(undefined);

  const handleHandoffToDubbing = (snapshot: DubbingHandoffSnapshot) => {
    setDubbingSnapshot(snapshot);
    setActiveWorkspace("dubbing");
  };

  const handleOpenMigrationModal = (oldPath: string, newPath: string) => {
    setMigrationOldPath(oldPath);
    setMigrationNewPath(newPath);
    setMigrationModalOpen(true);
  };

  const handleOpenExportValidation = (invalidChunks: ChunkItem[]) => {
    setInvalidChunksForExport(invalidChunks);
    setExportValidationOpen(true);
  };

  const handleSelectActiveVoice = (voiceOrId: VoiceProfile | string) => {
    const id = typeof voiceOrId === "string" ? voiceOrId : voiceOrId.id;
    const nowIso = new Date().toISOString();
    setActiveVoiceId(id);
    setVoices((prev) =>
      prev.map((v) => (v.id === id ? { ...v, lastUsedAt: nowIso } : v))
    );
  };

  const handleSelectVoiceForTts = (voice: VoiceProfile) => {
    handleSelectActiveVoice(voice);
    setActiveWorkspace("tts");
  };

  const handleSaveCloneVoice = (newVoice: VoiceProfile) => {
    const nowIso = new Date().toISOString();
    const voiceWithTimestamp = { ...newVoice, lastUsedAt: nowIso };
    setVoices((prev) => [voiceWithTimestamp, ...prev]);
    setActiveVoiceId(voiceWithTimestamp.id);
  };

  const handleUpdateVoice = (updatedVoice: VoiceProfile) => {
    setVoices((prev) =>
      prev.map((v) => (v.id === updatedVoice.id ? updatedVoice : v))
    );
  };

  const handleDeleteVoice = (id: string) => {
    setVoices((prev) => prev.filter((v) => v.id !== id));
  };

  const [ttsIncomingScript, setTtsIncomingScript] = useState<string | null>(null);

  const handleSendTranscriptToTts = (text: string) => {
    try {
      localStorage.setItem("voxlab_script_working_text", text);
    } catch {}
    setTtsIncomingScript(text);
    setActiveWorkspace("tts");
  };

  const handleToggleFavorite = (voiceId: string) => {
    setVoices((prev) =>
      prev.map((v) => (v.id === voiceId ? { ...v, isFavorite: !v.isFavorite } : v))
    );
  };

  const WORKSPACES_WITH_AUDIO_PREVIEW: WorkspaceId[] = ["tts", "dialogue", "clone", "library", "dubbing"];
  const showBottomPlayer = WORKSPACES_WITH_AUDIO_PREVIEW.includes(activeWorkspace);

  const handleSelectWorkspace = (id: WorkspaceId) => {
    if (!WORKSPACES_WITH_AUDIO_PREVIEW.includes(id) && isAudioPlaying) {
      setIsAudioPlaying(false);
    }
    if (id !== "settings") {
      setSettingsInitialGroup(undefined);
    }
    setActiveWorkspace(id);
    try {
      localStorage.setItem("voxlab_active_workspace", id);
    } catch {}
  };

  return (
    <div className={`h-screen w-screen flex flex-col overflow-hidden bg-background text-textPrimary ${theme}`}>
      {/* 1. Top Utility Bar */}
      <TopBar
        isOnlineActive={isOnlineActive}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* 2. Middle Body: Sidebar + Workspace + Inspector */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Collapsible Navigation */}
        <Sidebar
          activeWorkspace={activeWorkspace}
          onSelectWorkspace={handleSelectWorkspace}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          activeModelName={activeModel}
        />

        {/* Right Area: Workspace Frame on top, Bottom Audio Player below */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0 bg-background">
          {/* Workspace Frame: rounded container with 10-12px outer margin */}
          <div className={`flex-1 flex flex-col overflow-hidden min-w-0 min-h-0 m-2.5 sm:m-3 ${showBottomPlayer && activeAudioTrack ? 'mb-2 sm:mb-2.5' : ''} rounded-[11px] border border-borderDefault bg-panel shadow-sm relative`}>
            <main className="flex-1 flex flex-col overflow-hidden relative">
              {activeWorkspace === "tts" && (
                <TtsWorkspace
                  voices={voices}
                  selectedChunk={selectedChunk}
                  onSelectChunk={(c) => {
                    setSelectedChunk(c);
                    if (!inspectorOpen) setInspectorOpen(true);
                  }}
                  onTriggerJob={() => {
                    setIsGenerating(true);
                    setIsPaused(false);
                  }}
                  onOpenExportValidation={handleOpenExportValidation}
                  isGenerating={isGenerating}
                  isPaused={isPaused}
                  onTogglePause={() => {
                    if (isPaused || batchQueueExecutor.isQueuePaused()) {
                      batchQueueExecutor.resume();
                      setIsPaused(false);
                    } else {
                      batchQueueExecutor.pause();
                      setIsPaused(true);
                    }
                  }}
                  onCancel={() => {
                    setIsGenerating(false);
                    setIsPaused(false);
                    batchQueueExecutor.cancel();
                  }}
                  concurrency={concurrency}
                  onJobComplete={() => {
                    setIsGenerating(false);
                    setIsPaused(false);
                  }}
                  currentChunkIndex={currentChunkIndex}
                  totalChunks={totalChunks}
                  onChunkProgress={(curr, tot) => {
                    setCurrentChunkIndex(curr);
                    setTotalChunks(tot);
                  }}
                  activePlayingChunkId={isAudioPlaying ? activeAudioTrack?.id || null : null}
                  isPlayingAudio={isAudioPlaying}
                  onPlayChunk={handlePlayChunk}
                  exportSrt={exportSrt}
                  incomingScript={ttsIncomingScript}
                  onConsumeIncomingScript={() => setTtsIncomingScript(null)}
                  activeModel={activeModel}
                  activeVoiceId={activeVoiceId}
                  inspector={
                    <TtsInspector
                      selectedChunk={selectedChunk}
                      voices={voices}
                      activeVoiceId={activeVoiceId}
                      onChangeActiveVoice={handleSelectActiveVoice}
                      activeModel={activeModel}
                      onChangeModel={(m) => setActiveModel(m)}
                      isOpen={inspectorOpen}
                      onToggle={() => setInspectorOpen(!inspectorOpen)}
                      inspectorWidth={inspectorWidth}
                      onWidthChange={(w) => setInspectorWidth(w)}
                      onOpenVoiceModal={() => setVoiceModalOpen(true)}
                      concurrency={concurrency}
                      onChangeConcurrency={setConcurrency}
                      exportSrt={exportSrt}
                      onChangeExportSrt={setExportSrt}
                    />
                  }
                  bottomPlayer={
                    showBottomPlayer && activeAudioTrack ? (
                      <BottomAudioPlayer
                        track={activeAudioTrack}
                        isPlaying={isAudioPlaying}
                        onTogglePlay={handleTogglePlay}
                        onClose={handleCloseAudioPlayer}
                        className="mx-0 mb-0"
                      />
                    ) : null
                  }
                />
              )}

              {activeWorkspace === "dialogue" && (
                <DialogueWorkspace
                  voices={voices}
                  onNavigateToClone={() => handleSelectWorkspace("clone")}
                />
              )}

              {activeWorkspace === "clone" && (
                <VoiceCloneWorkspace
                  voices={voices}
                  onSaveVoice={handleSaveCloneVoice}
                  onUpdateVoice={handleUpdateVoice}
                  onDeleteVoice={handleDeleteVoice}
                  onSelectForTts={handleSelectVoiceForTts}
                  onPlayTrack={(track) => {
                    setActiveAudioTrack(track);
                    setIsAudioPlaying(true);
                  }}
                  activePlayingTrackId={isAudioPlaying ? activeAudioTrack?.id || null : null}
                  onStopPlaying={() => setIsAudioPlaying(false)}
                />
              )}

              {activeWorkspace === "library" && (
                <VoiceLibraryWorkspace
                  voices={voices}
                  onSelectForTts={handleSelectVoiceForTts}
                  onDeleteVoice={handleDeleteVoice}
                  onUpdateVoice={handleUpdateVoice}
                  onNavigateToClone={() => handleSelectWorkspace("clone")}
                  onPlayTrack={(track) => {
                    setActiveAudioTrack(track);
                    setIsAudioPlaying(true);
                  }}
                  activePlayingTrackId={isAudioPlaying ? activeAudioTrack?.id || null : null}
                  onStopPlaying={() => setIsAudioPlaying(false)}
                />
              )}

              {activeWorkspace === "transcription" && (
                <TranscriptionWorkspace
                  onSendToTts={handleSendTranscriptToTts}
                  onHandoffToDubbing={handleHandoffToDubbing}
                />
              )}

              {activeWorkspace === "dubbing" && (
                <DubbingWorkspace
                  handoffSnapshot={dubbingSnapshot}
                  voices={voices}
                  activeVoiceId={activeVoiceId}
                  onChangeActiveVoice={handleSelectActiveVoice}
                  activeModel={activeModel}
                  onChangeModel={setActiveModel}
                  onOpenVoiceModal={() => setVoiceModalOpen(true)}
                  onNavigateToSettings={(group) => {
                    setSettingsInitialGroup(group || "translation");
                    setActiveWorkspace("settings");
                  }}
                />
              )}

              {activeWorkspace === "batch" && (
                <BatchWorkspace />
              )}

              {activeWorkspace === "history" && (
                <HistoryWorkspace
                  onResumeSession={(_id) => handleSelectWorkspace("tts")}
                  onOpenOutput={() => alert("Mở thư mục xuất: D:/VoxLabOutput")}
                />
              )}

              {activeWorkspace === "settings" && (
                <SettingsWorkspace
                  onOpenMigrationModal={handleOpenMigrationModal}
                  initialGroup={settingsInitialGroup}
                />
              )}
            </main>
          </div>

          {/* Bottom Audio Preview Player (strictly visible in relevant workspaces other than TTS, Dialogue & Dubbing) */}
          {activeWorkspace !== "tts" && activeWorkspace !== "dialogue" && activeWorkspace !== "dubbing" && showBottomPlayer && activeAudioTrack && (
            <BottomAudioPlayer
              track={activeAudioTrack}
              isPlaying={isAudioPlaying}
              onTogglePlay={handleTogglePlay}
              onClose={handleCloseAudioPlayer}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <MigrationModal
        isOpen={migrationModalOpen}
        onClose={() => setMigrationModalOpen(false)}
        oldPath={migrationOldPath}
        newPath={migrationNewPath}
        onSuccess={(finalPath) => {
          setMigrationNewPath(finalPath);
          setAppToast(`Đã chuyển thư mục dữ liệu sang ${finalPath}`);
          setTimeout(() => setAppToast(null), 4000);
        }}
      />

      <ExportValidationModal
        isOpen={exportValidationOpen}
        onClose={() => setExportValidationOpen(false)}
        invalidChunks={invalidChunksForExport}
        onRegenerateInvalid={() => {
          setExportValidationOpen(false);
          if (typeof window !== "undefined" && (window as any).__VOXLAB_REGENERATE_INVALID__) {
            (window as any).__VOXLAB_REGENERATE_INVALID__();
          } else {
            setIsGenerating(true);
          }
        }}
        onForceExport={() => {
          setExportValidationOpen(false);
          alert("Tiến hành ghép và xuất audio với các đoạn đã sẵn sàng: D:/VoxLabOutput/Podcast_Ep12_Partial.wav");
        }}
      />

      {/* Voice Selection Pop-up Modal */}
      <VoiceSelectionModal
        isOpen={voiceModalOpen}
        onClose={() => setVoiceModalOpen(false)}
        voices={voices}
        activeVoiceId={activeVoiceId}
        onSelectVoice={handleSelectActiveVoice}
        onToggleFavorite={handleToggleFavorite}
        onNavigateToClone={() => {
          setVoiceModalOpen(false);
          setActiveWorkspace("clone");
        }}
        currentModel={activeModel}
      />

      {/* Pop-up Kích hoạt bản quyền khi khởi động lần đầu tiên */}
      <LicenseModal
        isOpen={initialLicenseModalOpen}
        onClose={() => setInitialLicenseModalOpen(false)}
        onSuccess={handleInitialLicenseSuccess}
        isInitialLaunch={true}
      />

      {/* Global Toast Notification */}
      {appToast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className="px-4 py-3 rounded-xl shadow-xl border border-emerald-500/30 bg-surface1/95 text-emerald-600 dark:text-emerald-400 flex items-center gap-3 backdrop-blur-md">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <span className="text-xs font-medium text-textPrimary">{appToast}</span>
            <button
              onClick={() => setAppToast(null)}
              className="p-1 hover:bg-surface2 rounded text-textMuted hover:text-textPrimary transition-colors ml-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

export default App;

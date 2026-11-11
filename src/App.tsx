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
import {
  migrateSubtitleAndTranslationSettings,
  ensureGeminiKeyStoreInitialized,
  geminiKeyPool,
} from "./services/translation";
import { migratePunctuationPauseDefaults } from "./services/pause/punctuationPause";
import { MOCK_VOICES, mergeStoredVoicesWithCatalog } from "./mock/data";
import { I18nProvider, useI18n } from "./i18n/context";
import { migrateLegacyVoice } from "./constants/voiceFilters";
import { LicenseModal } from "./components/modals/LicenseModal";
import { LicenseService, LicenseSummary } from "./services/license/licenseService";
import {
  reconcileCloneVoicesWithProfiles,
  updateCloneVoiceMetadata,
  removeCloneVoice,
} from "./services/ai/cloneVoiceRegistry";
import {
  BOOTSTRAP_JOB_ID,
  getAiBootstrapStatus,
  bootstrapAiRuntimes,
  onModelInstallProgress,
  type ModelInstallProgressEvent,
} from "./services/ai/aiRuntimeSettings";
import { resolveLocalEngine } from "./services/ai/ttsEngines";
import { AppUpdateModal } from "./components/modals/AppUpdateModal";
import {
  checkAppUpdate,
  OPEN_APP_UPDATE_MODAL_EVENT,
  type UpdateCheckResult,
} from "./services/updater/updaterService";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";

// Run synchronous migrations before components mount and read localStorage
migratePunctuationPauseDefaults();

function AppContent({ initialToast = null }: { initialToast?: string | null }) {
  const { t: _t } = useI18n();

  // Run settings schema migration and initialize Gemini encrypted key vault once on startup
  useEffect(() => {
    migratePunctuationPauseDefaults();
    migrateSubtitleAndTranslationSettings();
    ensureGeminiKeyStoreInitialized()
      .then(() => {
        geminiKeyPool.syncBucketsWithStore();
      })
      .catch((err) => {
        console.warn("[App] Gemini key vault startup initialization warning:", err?.message || err);
      });
  }, []);

  const [appToast, setAppToast] = useState<string | null>(initialToast);

  useEffect(() => {
    if (!initialToast) return;
    setAppToast(initialToast);
    const timer = setTimeout(() => setAppToast(null), 4500);
    return () => clearTimeout(timer);
  }, [initialToast]);

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
        return mergeStoredVoicesWithCatalog(parsed, migrateLegacyVoice);
      }
    } catch (e) {
      // fallback to mock voices
    }
    return MOCK_VOICES.map(migrateLegacyVoice);
  }

  // Voice State
  const [voices, setVoices] = useState<VoiceProfile[]>(loadInitialVoices);
  const [activeVoiceId, setActiveVoiceId] = useState<string>("edge_vi_hoaimy");
  const [activeModel, setActiveModel] = useState<string>("Kokoro-82M");
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);

  // Reconcile durable cloneVoiceRegistry (voices/clone_voices.json) with UI VoiceProfile state on startup
  useEffect(() => {
    let cancelled = false;
    reconcileCloneVoicesWithProfiles(loadInitialVoices())
      .then((reconciled) => {
        if (!cancelled) {
          setVoices(reconciled);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync voices to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(VOICES_STORAGE_KEY, JSON.stringify(voices));
    } catch (e) {
      // ignore
    }
  }, [voices]);

  // TTS State
  const [selectedChunk, setSelectedChunk] = useState<ChunkItem | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  // One heavy inference at a time. Sidecar returns BUSY for overlapping requests.
  const concurrency = 1;
  const [exportSrt, setExportSrt] = useState<boolean>(() => !!loadStoredTtsSettings().exportSrt);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);

  // Global Audio Preview Player State
  const [activeAudioTrack, setActiveAudioTrack] = useState<ActiveAudioTrack | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  const handleTogglePlay = useCallback(() => {
    setIsAudioPlaying((prev) => !prev);
  }, []);

  const handlePlayChunk = (chunk: ChunkItem) => {
    const voice = voices.find((v) => v.id === (chunk.voiceOverrideId || activeVoiceId));
    const speakerName = voice?.name || "Hoài My";

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
  const [appUpdateInfo, setAppUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [appUpdateModalOpen, setAppUpdateModalOpen] = useState(false);

  // Automatic silent update check on startup + manual modal trigger listener
  useEffect(() => {
    let cancelled = false;
    checkAppUpdate()
      .then((res) => {
        if (!cancelled && res.updateAvailable) {
          setAppUpdateInfo(res);
          setAppUpdateModalOpen(true);
        }
      })
      .catch(() => {});

    const handleOpenUpdate = (e: Event) => {
      const custom = e as CustomEvent<UpdateCheckResult>;
      if (custom.detail && custom.detail.updateAvailable) {
        setAppUpdateInfo(custom.detail);
        setAppUpdateModalOpen(true);
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener(OPEN_APP_UPDATE_MODAL_EVENT, handleOpenUpdate);
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener(OPEN_APP_UPDATE_MODAL_EVENT, handleOpenUpdate);
      }
    };
  }, []);

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
    const matchedVoice = typeof voiceOrId === "string" ? voices.find((v) => v.id === id) : voiceOrId;
    if (matchedVoice) {
      if (matchedVoice.isOnline) {
        setActiveModel("Online Cloud");
      } else if (matchedVoice.engine === "kokoro_82m" || id.startsWith("kokoro_")) {
        setActiveModel("Kokoro-82M");
      } else if (matchedVoice.engine === "chatterbox_turbo" || matchedVoice.engine === "chatterbox") {
        setActiveModel("Chatterbox Turbo");
      } else if (matchedVoice.engine === "qwen_tts_1_7b" || matchedVoice.engine === "qwen") {
        setActiveModel("Qwen TTS 1.7B");
      } else if (matchedVoice.engine === "omnivoice") {
        setActiveModel("OmniVoice");
      }
    }
    const nowIso = new Date().toISOString();
    setActiveVoiceId(id);
    setVoices((prev) =>
      prev.map((v) => (v.id === id ? { ...v, lastUsedAt: nowIso } : v))
    );
  };

  const handleChangeActiveModel = (nextModel: string) => {
    setActiveModel(nextModel);
    const activeVoice = voices.find((v) => v.id === activeVoiceId);
    if (
      activeVoice &&
      !activeVoice.isOnline &&
      (activeVoice.origin === "clone" ||
        activeVoice.source === "local_clone" ||
        activeVoice.id.startsWith("clone_"))
    ) {
      const caps = resolveLocalEngine(nextModel);
      if (caps && caps.supportsVoiceClone && activeVoice.engine !== caps.voxlabModelId) {
        handleUpdateVoice({
          ...activeVoice,
          engine: caps.voxlabModelId,
          modelCompatibility: [nextModel],
        });
      }
    }
  };

  const handleSelectVoiceForTts = (voice: VoiceProfile) => {
    handleSelectActiveVoice(voice);
    setActiveWorkspace("tts");
  };

  const handleSaveCloneVoice = (newVoice: VoiceProfile) => {
    const nowIso = new Date().toISOString();
    const voiceWithTimestamp = { ...newVoice, lastUsedAt: nowIso };
    setVoices((prev) => [voiceWithTimestamp, ...prev]);
    handleSelectActiveVoice(voiceWithTimestamp);
  };

  const handleUpdateVoice = (updatedVoice: VoiceProfile) => {
    setVoices((prev) =>
      prev.map((v) => (v.id === updatedVoice.id ? updatedVoice : v))
    );
    const isClone =
      updatedVoice.origin === "clone" ||
      updatedVoice.source === "local_clone" ||
      updatedVoice.id.startsWith("clone_");
    if (isClone) {
      updateCloneVoiceMetadata(updatedVoice.id, {
        name: updatedVoice.name,
        refText: updatedVoice.referenceTranscript ?? "",
        language: updatedVoice.supportedLanguages?.[0],
        engine: updatedVoice.engine,
        durationSec: updatedVoice.sampleDurationSec,
      }).catch((err) => console.error("Failed to sync updated clone voice metadata:", err));
    }
  };

  const handleDeleteVoice = (id: string) => {
    setVoices((prev) => prev.filter((v) => v.id !== id));
    if (activeVoiceId === id) {
      setActiveVoiceId("edge_vi_hoaimy");
    }
    if (activeAudioTrack?.id === id) {
      handleCloseAudioPlayer();
    }
    removeCloneVoice(id).catch((err) =>
      console.error("Failed to remove clone voice from registry:", err)
    );
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

  useEffect(() => {
    const handleNav = (e: Event) => {
      const custom = e as CustomEvent<WorkspaceId>;
      if (custom.detail) {
        handleSelectWorkspace(custom.detail);
      }
    };
    const handleOpenSettingsModels = () => {
      setSettingsInitialGroup("models");
      setActiveWorkspace("settings");
      try {
        localStorage.setItem("voxlab_active_workspace", "settings");
      } catch {}
    };
    if (typeof window !== "undefined") {
      window.addEventListener("voxlab_navigate_workspace", handleNav);
      window.addEventListener("voxlab_open_settings_models", handleOpenSettingsModels);
      return () => {
        window.removeEventListener("voxlab_navigate_workspace", handleNav);
        window.removeEventListener("voxlab_open_settings_models", handleOpenSettingsModels);
      };
    }
  }, []);

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
          {/* Workspace Frame: sculpted rounded studio container floating over chassis */}
          <div className={`flex-1 flex flex-col overflow-hidden min-w-0 min-h-0 m-2.5 sm:m-3 ${showBottomPlayer && activeAudioTrack ? 'mb-2 sm:mb-2.5' : ''} rounded-xl border border-borderDefault bg-panel shadow-[0_4px_20px_-4px_rgba(36,24,12,0.08),0_1px_2px_rgba(36,24,12,0.04)] dark:shadow-[0_10px_28px_-6px_rgba(0,0,0,0.58),0_2px_4px_rgba(0,0,0,0.35)] relative`}>
            <main className="flex-1 flex flex-col overflow-hidden relative">
              {activeWorkspace === "tts" && (
                <TtsWorkspace
                  voices={voices}
                  selectedChunk={selectedChunk}
                  onNavigateToWorkspace={handleSelectWorkspace}
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
                      onChangeModel={handleChangeActiveModel}
                      isOpen={inspectorOpen}
                      onToggle={() => setInspectorOpen(!inspectorOpen)}
                      inspectorWidth={inspectorWidth}
                      onWidthChange={(w) => setInspectorWidth(w)}
                      onOpenVoiceModal={() => setVoiceModalOpen(true)}
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
          if (typeof window !== "undefined" && (window as any).__VOXLAB_FORCE_EXPORT__) {
            (window as any).__VOXLAB_FORCE_EXPORT__();
          }
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

      {/* App Auto-Update Modal (Audio Factory MMO-TOOL-Manager standard) */}
      <AppUpdateModal
        isOpen={appUpdateModalOpen}
        updateInfo={appUpdateInfo}
        onClose={() => {
          if (!appUpdateInfo?.isForced) {
            setAppUpdateModalOpen(false);
          }
        }}
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

function LicenseStartupGate() {
  const [phase, setPhase] = useState<"checking" | "locked" | "bootstrapping" | "authorized">(
    "checking"
  );
  const [lockedError, setLockedError] = useState<string | null>(null);
  const [startupToast, setStartupToast] = useState<string | null>(null);
  const [bootstrapProgress, setBootstrapProgress] = useState<ModelInstallProgressEvent | null>(
    null
  );
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [gateTheme] = useState<"dark" | "light">(() => {
    try {
      return localStorage.getItem("voxlab_theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

  const runRuntimeBootstrap = useCallback(async (postLicenseToast?: string | null) => {
    setBootstrapError(null);
    setBootstrapProgress({
      modelId: BOOTSTRAP_JOB_ID,
      status: "installing",
      stage: "preparing",
      pct: 2,
      message: "Đang kiểm tra tài nguyên thiết bị...",
    });

    try {
      await bootstrapAiRuntimes();
      setStartupToast(
        postLicenseToast || "Đã khởi tạo môi trường hoàn tất! Sẵn sàng làm việc."
      );
      setPhase("authorized");
    } catch (err: any) {
      const rawMsg =
        err?.message || String(err || "Không thể khởi tạo môi trường làm việc. Vui lòng kiểm tra mạng và thử lại.");
      setBootstrapError(rawMsg);
    }
  }, []);

  const enterAuthorizedOrBootstrap = useCallback(
    async (postLicenseToast?: string | null) => {
      const st = await getAiBootstrapStatus();
      if (st.ready) {
        if (postLicenseToast) setStartupToast(postLicenseToast);
        setPhase("authorized");
        return;
      }

      setPhase("bootstrapping");
      void runRuntimeBootstrap(postLicenseToast);
    },
    [runRuntimeBootstrap]
  );

  useEffect(() => {
    if (phase !== "bootstrapping") return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    onModelInstallProgress((ev) => {
      if (!disposed && ev.modelId === BOOTSTRAP_JOB_ID) {
        setBootstrapProgress(ev);
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [phase]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("voxlab_theme");
      const activeTheme = saved === "light" ? "light" : "dark";
      const root = document.documentElement;
      root.classList.remove("dark", "light");
      root.classList.add(activeTheme);
      root.setAttribute("data-theme", activeTheme);
      root.style.colorScheme = activeTheme;
    } catch {
      // ignore
    }

    let cancelled = false;
    if (!LicenseService.isCommercialGateEnabled()) {
      void enterAuthorizedOrBootstrap(null);
      return;
    }

    LicenseService.verify()
      .then((summary) => {
        if (cancelled) return;
        if (summary.is_valid && summary.can_use_app) {
          const graceMsg =
            summary.status === "OFFLINE_GRACE"
              ? summary.error_message || "Đang hoạt động ngoại tuyến (Ân hạn tối đa 3 ngày)."
              : null;
          void enterAuthorizedOrBootstrap(graceMsg);
        } else {
          setLockedError(
            summary.status !== "NO_KEY" ? summary.error_message || null : null
          );
          setPhase("locked");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLockedError("Không thể kiểm tra bản quyền. Vui lòng kích hoạt lại.");
        setPhase("locked");
      });

    return () => {
      cancelled = true;
    };
  }, [enterAuthorizedOrBootstrap]);

  const handleGateSuccess = (license: LicenseSummary) => {
    const okMsg = `Kích hoạt bản quyền thành công! Hạn dùng: ${license.expires_at_formatted}`;
    void enterAuthorizedOrBootstrap(okMsg);
  };

  if (phase === "checking") {
    return (
      <div className={`h-screen w-screen flex flex-col overflow-hidden bg-background text-textPrimary select-none ${gateTheme}`}>
        <TopBar theme={gateTheme} minimal={true} />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-surface1 border border-borderDefault rounded-2xl px-8 py-7 shadow-2xl flex flex-col items-center gap-3 max-w-sm w-full">
            <div className="w-11 h-11 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-textPrimary">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              <span>Đang xác thực bản quyền VoxLab...</span>
            </div>
            <p className="text-[11px] text-textMuted text-center">
              Kiểm tra chữ ký phần cứng (HWID v3) và máy chủ bản quyền
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "locked") {
    return (
      <div className={`h-screen w-screen flex flex-col overflow-hidden bg-background text-textPrimary select-none ${gateTheme}`}>
        <TopBar theme={gateTheme} minimal={true} />
        <LicenseModal
          isOpen={true}
          onClose={() => {}}
          onSuccess={handleGateSuccess}
          isInitialLaunch={true}
          mandatory={true}
          initialErrorMessage={lockedError}
        />
      </div>
    );
  }

  if (phase === "bootstrapping") {
    const pct = Math.max(2, Math.min(100, Math.round(bootstrapProgress?.pct ?? 2)));
    const stageCaption =
      pct < 18
        ? "Đang kiểm tra tài nguyên thiết bị..."
        : pct < 88
        ? "Đang đồng bộ thành phần xử lý..."
        : "Đang hoàn tất khởi tạo...";
    return (
      <div className={`h-screen w-screen flex flex-col overflow-hidden bg-background text-textPrimary select-none ${gateTheme}`}>
        <TopBar theme={gateTheme} minimal={true} />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-surface1 border border-borderDefault rounded-2xl p-6 shadow-2xl flex flex-col gap-4 max-w-md w-full">
            <div className="flex items-center gap-3">
              <img
                src="/app-icon.png?v=2"
                alt="VoxLab"
                className="w-11 h-11 rounded-xl shadow-md shadow-accent/25 object-cover shrink-0"
              />
              <div>
                <h2 className="font-bold text-base text-textPrimary">
                  Khởi tạo môi trường lần đầu
                </h2>
                <p className="text-xs text-textMuted">
                  Đang tự động cấu hình và tối ưu hoá môi trường làm việc
                </p>
              </div>
            </div>

            {bootstrapError ? (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-danger/10 border border-danger/25 text-danger text-xs">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{bootstrapError}</span>
                  </div>
                </div>
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => void runRuntimeBootstrap(null)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-accent text-white text-xs font-semibold cursor-pointer transition-all"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Thử lại</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-surface2/60 border border-borderDefault space-y-2.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="inline-flex items-center gap-2 text-textPrimary font-medium min-w-0">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
                    <span className="truncate">{stageCaption}</span>
                  </span>
                  <span className="font-mono font-bold text-accent shrink-0">{pct}%</span>
                </div>
                <div className="w-full h-2 bg-surface3 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-300 rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <AppContent initialToast={startupToast} />;
}

export function App() {
  return (
    <I18nProvider>
      <LicenseStartupGate />
    </I18nProvider>
  );
}

export default App;

/**
 * Dedicated preview audio playback manager.
 * Manages HTMLAudioElement lifecycle, tracks active playback,
 * ensures URL cleanup, and guarantees onEnded / onError notification.
 */

class PreviewAudioPlayer {
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private currentOnEnded: (() => void) | null = null;

  async play(audioUrl: string, onEnded?: () => void): Promise<void> {
    this.stop();

    let playUrl = audioUrl;
    // If audioUrl is a local disk file path (or file://), resolve it to a Blob URL for webview playback
    const isLocalDiskPath =
      playUrl &&
      (playUrl.startsWith("file://") ||
        /^[a-zA-Z]:[/\\]/.test(playUrl) ||
        playUrl.startsWith("\\\\"));

    if (isLocalDiskPath) {
      try {
        const { readAudioFileBlobUrl } = await import("../batch/batchRuntime");
        playUrl = await readAudioFileBlobUrl(playUrl);
      } catch (err) {
        console.warn("Could not read local audio file to blob url:", err);
      }
    }

    const audio = new Audio(playUrl);
    this.currentAudio = audio;
    this.currentAudioUrl = playUrl;
    this.currentOnEnded = onEnded || null;

    const cleanup = () => {
      if (this.currentAudio === audio) {
        this.currentAudio = null;
      }
      if (this.currentAudioUrl && this.currentAudioUrl.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(this.currentAudioUrl);
        } catch {}
        this.currentAudioUrl = null;
      }
      if (this.currentOnEnded) {
        const cb = this.currentOnEnded;
        this.currentOnEnded = null;
        cb();
      }
    };

    audio.onended = () => {
      cleanup();
    };

    audio.onerror = () => {
      cleanup();
    };

    try {
      await audio.play();
    } catch (e) {
      cleanup();
      throw e;
    }
  }

  stop(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {}
      this.currentAudio = null;
    }
    if (this.currentAudioUrl && this.currentAudioUrl.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(this.currentAudioUrl);
      } catch {}
      this.currentAudioUrl = null;
    }
    if (this.currentOnEnded) {
      const cb = this.currentOnEnded;
      this.currentOnEnded = null;
      cb();
    }
  }

  isPlaying(): boolean {
    return Boolean(this.currentAudio && !this.currentAudio.paused);
  }
}

export const previewAudioPlayer = new PreviewAudioPlayer();

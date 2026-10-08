import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { providerRegistry } from "../index";
import { edgeTtsProvider } from "../edgeProvider";
import { googleTranslateTtsProvider } from "../googleProvider";
import { localTtsProvider } from "../localProvider";
import { previewAudioPlayer } from "../audioPlayer";
import { VoiceProfile } from "../../../types/ui";

describe("Voice Preview Routing and Architecture Tests", () => {
  beforeEach(() => {
    previewAudioPlayer.stop();
  });

  describe("Provider Routing", () => {
    it("routes edge voice to EdgeTtsProvider", () => {
      const adapter = providerRegistry.getAdapter("edge");
      assert.equal(adapter?.id, "edge");
      assert.equal(adapter, edgeTtsProvider);
    });

    it("routes google voice to GoogleTranslateTtsProvider", () => {
      const adapter = providerRegistry.getAdapter("google_translate");
      assert.equal(adapter?.id, "google_translate");
      assert.equal(adapter, googleTranslateTtsProvider);
    });

    it("routes local voice to LocalTtsProvider", () => {
      const adapter = providerRegistry.getAdapter("local");
      assert.equal(adapter?.id, "local");
      assert.equal(adapter, localTtsProvider);
    });
  });

  describe("Google Provider Architecture & Credentials", () => {
    it("reports not_configured and AUTH_REQUIRED when API key is missing (never silent, never WebSpeech)", async () => {
      const googleVoice: VoiceProfile = {
        id: "google_vi",
        name: "Google Tiếng Việt",
        source: "google",
        origin: "system",
        sourceType: "online",
        provider: "google_translate",
        engine: "gtts",
        country: "VN",
        tags: [],
        supportedLanguages: ["vi"],
        modelCompatibility: ["Omni Voice"],
        isOnline: true,
        isFavorite: false,
        avatarColor: "from-blue-500 to-red-500",
        availability: "available",
        previewAvailable: true,
      };

      const result = await providerRegistry.previewVoice(googleVoice);
      assert.equal(result.success, false);
      assert.equal(result.isNotConfigured, true);
      assert.equal(result.unconfigured, true);
      assert.equal(result.errorCode, "AUTH_REQUIRED");
      assert.equal(result.error, "Chưa cấu hình Google TTS");
    });
  });

  describe("Edge Provider Configuration", () => {
    it("has authoritative Edge TTS voice catalog", () => {
      const voices = edgeTtsProvider.listVoices();
      assert.ok(voices.length >= 10);
      const hoaimy = voices.find((v) => v.id === "edge_vi_hoaimy");
      assert.ok(hoaimy, "Hoài My must exist in Edge catalog");
      assert.equal(hoaimy.provider, "edge");
      assert.deepEqual(hoaimy.supportedLanguages, ["vi"]);

      const namminh = voices.find((v) => v.id === "edge_vi_namminh");
      assert.ok(namminh, "Nam Minh must exist in Edge catalog");
      assert.equal(namminh.provider, "edge");

      const jenny = voices.find((v) => v.id === "edge_en_jenny");
      assert.ok(jenny, "Jenny must exist in Edge catalog");
      assert.equal(jenny.provider, "edge");
    });

    it("fails cleanly when outside Tauri environment without faking audio", async () => {
      const hoaimy: VoiceProfile = {
        id: "edge_vi_hoaimy",
        name: "Hoài My (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        country: "VN",
        tags: ["Female"],
        supportedLanguages: ["vi"],
        modelCompatibility: ["Omni Voice"],
        isOnline: true,
        isFavorite: false,
        avatarColor: "from-sky-500 to-blue-600",
        availability: "available",
        previewAvailable: true,
      };

      const result = await edgeTtsProvider.preview(hoaimy);
      // In Node test environment, isTauriRuntime() is false
      assert.equal(result.success, false);
      assert.equal(result.errorCode, "PROVIDER_UNAVAILABLE");
    });
  });

  describe("Local Provider Preview", () => {
    it("returns correct sample audio URL for local voices", async () => {
      let playedUrl = "";
      // Mock previewAudioPlayer play method for test environment without DOM
      const origPlay = previewAudioPlayer.play.bind(previewAudioPlayer);
      previewAudioPlayer.play = async (url: string) => {
        playedUrl = url;
      };

      try {
        const sarah: VoiceProfile = {
          id: "voice_06",
          name: "Sarah (US Professional)",
          source: "local",
          origin: "system",
          sourceType: "local",
          provider: "local",
          engine: "omnivoice",
          country: "US",
          tags: [],
          supportedLanguages: ["en"],
          modelCompatibility: ["Omni Voice"],
          sampleAudioPath: "/audio/samples/sarah.mp3",
          isOnline: false,
          isFavorite: false,
          avatarColor: "from-violet-500 to-purple-600",
          availability: "available",
          previewAvailable: true,
        };

        const result = await providerRegistry.previewVoice(sarah);
        assert.equal(result.success, true);
        assert.equal(result.audioUrl, "/audio/samples/sarah.mp3");
        assert.equal(playedUrl, "/audio/samples/sarah.mp3");
      } finally {
        previewAudioPlayer.play = origPlay;
      }
    });

    it("previews cloned voice with Windows disk path through previewAudioPlayer", async () => {
      let playedUrl = "";
      const origPlay = previewAudioPlayer.play.bind(previewAudioPlayer);
      previewAudioPlayer.play = async (url: string) => {
        playedUrl = url;
      };

      try {
        const tesla: VoiceProfile = {
          id: "clone_1791384211528",
          name: "Tesla",
          source: "local_clone",
          origin: "clone",
          sourceType: "local",
          provider: "local",
          engine: "omnivoice",
          country: "US",
          tags: [],
          supportedLanguages: ["en"],
          modelCompatibility: ["Omni Voice"],
          sampleAudioPath: "C:\\Users\\lucng\\Downloads\\Matt - auto signals.mp3",
          isOnline: false,
          isFavorite: false,
          avatarColor: "from-accent to-teal-500",
          availability: "available",
          previewAvailable: true,
        };

        const result = await providerRegistry.previewVoice(tesla);
        assert.equal(result.success, true);
        assert.equal(result.audioUrl, "C:\\Users\\lucng\\Downloads\\Matt - auto signals.mp3");
        assert.equal(playedUrl, "C:\\Users\\lucng\\Downloads\\Matt - auto signals.mp3");
      } finally {
        previewAudioPlayer.play = origPlay;
      }
    });

    it("routes provider 'clone' to CloneVoiceProvider and plays sample audio", async () => {
      let playedUrl = "";
      const origPlay = previewAudioPlayer.play.bind(previewAudioPlayer);
      previewAudioPlayer.play = async (url: string) => {
        playedUrl = url;
      };

      try {
        const cloneVoice: VoiceProfile = {
          id: "clone_999",
          name: "Custom Clone",
          source: "local_clone",
          origin: "clone",
          sourceType: "clone",
          provider: "clone",
          engine: "omnivoice",
          tags: [],
          supportedLanguages: ["vi"],
          modelCompatibility: ["Omni Voice"],
          sampleAudioPath: "D:\\Voices\\sample.wav",
          isOnline: false,
          isFavorite: false,
          avatarColor: "from-accent to-teal-500",
          availability: "available",
          previewAvailable: true,
        };

        const result = await providerRegistry.previewVoice(cloneVoice);
        assert.equal(result.success, true);
        assert.equal(playedUrl, "D:\\Voices\\sample.wav");
      } finally {
        previewAudioPlayer.play = origPlay;
      }
    });
  });
});

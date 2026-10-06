import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeWav,
  decodeWav,
  encodeMp3,
  decodeMp3,
  transcodeAudio,
  validateAudioFormat,
  DecodedPcmAudio,
} from "../audioTranscoder";
import { convertSubtitleFormat } from "../outputResolver";

describe("AudioTranscoder & Subtitle Format Converter (TASK-06 / AC-30)", () => {
  describe("Real Audio Transcoder (WAV <-> MP3)", () => {
    // Generate 0.1 second of 440 Hz sine wave PCM audio (mono, 44100 Hz)
    const sampleRate = 44100;
    const durationSec = 0.1;
    const numSamples = Math.floor(sampleRate * durationSec);
    const pcmData = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      pcmData[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.8;
    }
    const syntheticAudio: DecodedPcmAudio = {
      sampleRate,
      channels: 1,
      samples: [pcmData],
    };

    it("encodeWav creates valid RIFF/WAVE header and decodeWav recovers audio", () => {
      const wavBytes = encodeWav(syntheticAudio);
      assert.ok(wavBytes.length > 44);

      // Validate header
      assert.equal(validateAudioFormat(wavBytes, "wav"), true);
      assert.equal(validateAudioFormat(wavBytes, "mp3"), false);

      const decoded = decodeWav(wavBytes);
      assert.equal(decoded.sampleRate, sampleRate);
      assert.equal(decoded.channels, 1);
      assert.equal(decoded.samples[0].length, numSamples);
      // Sample values match closely within 16-bit quantization
      assert.ok(Math.abs(decoded.samples[0][100] - pcmData[100]) < 0.01);
    });

    it("encodeMp3 creates valid MPEG Audio Layer III frame sync headers", () => {
      const mp3Bytes = encodeMp3(syntheticAudio);
      assert.ok(mp3Bytes.length > 20);

      // Validate header
      assert.equal(validateAudioFormat(mp3Bytes, "mp3"), true);
      assert.equal(validateAudioFormat(mp3Bytes, "wav"), false);

      // Verify ID3v2 header starts with "ID3"
      assert.equal(mp3Bytes[0], 0x49); // 'I'
      assert.equal(mp3Bytes[1], 0x44); // 'D'
      assert.equal(mp3Bytes[2], 0x33); // '3'
    });

    it("decodeMp3 parses MPEG stream into PCM audio channels", () => {
      const mp3Bytes = encodeMp3(syntheticAudio);
      const decoded = decodeMp3(mp3Bytes);
      assert.ok(decoded.samples[0].length > 0);
      assert.equal(decoded.sampleRate, 44100);
    });

    it("transcodeAudio(wav -> mp3) performs real container transcoding, not mere renaming", async () => {
      const wavBytes = encodeWav(syntheticAudio);
      assert.equal(validateAudioFormat(wavBytes, "wav"), true);

      const mp3Transcoded = await transcodeAudio(wavBytes, "wav", "mp3");

      // The transcoded bytes MUST be genuine MP3 and MUST NOT be WAV
      assert.equal(validateAudioFormat(mp3Transcoded, "mp3"), true);
      assert.equal(validateAudioFormat(mp3Transcoded, "wav"), false);
      assert.notDeepEqual(mp3Transcoded, wavBytes);
    });

    it("transcodeAudio(mp3 -> wav) performs real container transcoding to RIFF WAVE", async () => {
      const mp3Bytes = encodeMp3(syntheticAudio);
      assert.equal(validateAudioFormat(mp3Bytes, "mp3"), true);

      const wavTranscoded = await transcodeAudio(mp3Bytes, "mp3", "wav");

      // The transcoded bytes MUST be genuine WAV
      assert.equal(validateAudioFormat(wavTranscoded, "wav"), true);
      assert.equal(validateAudioFormat(wavTranscoded, "mp3"), false);
      assert.notDeepEqual(wavTranscoded, mp3Bytes);
    });

    it("rejects invalid/corrupt audio bytes", () => {
      const fakeBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      assert.equal(validateAudioFormat(fakeBytes, "wav"), false);
      assert.equal(validateAudioFormat(fakeBytes, "mp3"), false);
      assert.throws(() => decodeWav(fakeBytes));
    });
  });

  describe("Reusable Subtitle Format Conversion (SRT <-> VTT)", () => {
    const srtContent = `1
00:00:01,000 --> 00:00:03,500
Xin chào các bạn đã đến với VoxLab.

2
00:00:04,000 --> 00:00:06,800
Hệ thống xử lý âm thanh và phụ đề hàng loạt.
`;

    it("converts SRT to VTT using domain parser and exporter (reused)", () => {
      const vttResult = convertSubtitleFormat(srtContent, "srt", "vtt");

      assert.ok(vttResult.startsWith("WEBVTT"));
      assert.ok(vttResult.includes("00:00:01.000 --> 00:00:03.500"));
      assert.ok(vttResult.includes("Xin chào các bạn đã đến với VoxLab."));
      assert.ok(vttResult.includes("00:00:04.000 --> 00:00:06.800"));
      assert.ok(vttResult.includes("Hệ thống xử lý âm thanh và phụ đề hàng loạt."));
    });

    it("converts VTT to SRT preserving cue text and converting timestamps to comma separator", () => {
      const vttContent = `WEBVTT

1
00:00:02.100 --> 00:00:05.400
Thử nghiệm chuyển đổi phụ đề sang SubRip.
`;
      const srtResult = convertSubtitleFormat(vttContent, "vtt", "srt");

      assert.ok(!srtResult.includes("WEBVTT"));
      assert.ok(srtResult.includes("00:00:02,100 --> 00:00:05,400"));
      assert.ok(srtResult.includes("Thử nghiệm chuyển đổi phụ đề sang SubRip."));
    });

    it("returns same content when source and target formats are identical", () => {
      const identical = convertSubtitleFormat(srtContent, "srt", "srt");
      assert.equal(identical, srtContent);
    });
  });
});

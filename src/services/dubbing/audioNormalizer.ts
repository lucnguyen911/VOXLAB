/**
 * Canonical Dubbing Audio Normalization Service
 * Standardizes synthesized and stretched audio to Canonical format:
 * 44.1kHz 16-bit Signed Linear PCM Mono (SPEC.md v2.5.3 Section 16.3).
 */

export const CANONICAL_SAMPLE_RATE = 44100;
export const CANONICAL_NUM_CHANNELS = 1;
export const CANONICAL_BITS_PER_SAMPLE = 16;

/**
 * Downmixes multi-channel AudioBuffer into a single mono Float32Array.
 * If stereo, averages left and right channels: mono[i] = (ch0[i] + ch1[i]) / 2.
 */
export function downmixToMono(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const numChannels = buffer.numberOfChannels;

  if (numChannels === 1) {
    return buffer.getChannelData(0);
  }

  const mono = new Float32Array(len);
  for (let c = 0; c < numChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      mono[i] += ch[i] / numChannels;
    }
  }

  return mono;
}

/**
 * Encodes a mono Float32Array into a standard 44-byte RIFF/WAVE container
 * formatted as 16-bit Linear PCM at the specified sample rate.
 */
export function encode16BitMonoWav(
  samples: Float32Array,
  sampleRate: number = CANONICAL_SAMPLE_RATE
): ArrayBuffer {
  const numChannels = CANONICAL_NUM_CHANNELS;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const totalSamples = samples.length;
  const totalDataBytes = totalSamples * bytesPerSample;

  const buffer = new ArrayBuffer(44 + totalDataBytes);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF Chunk Descriptor
  writeString(0, "RIFF");
  view.setUint32(4, 36 + totalDataBytes, true);
  writeString(8, "WAVE");

  // "fmt " Subchunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, CANONICAL_BITS_PER_SAMPLE, true);

  // "data" Subchunk
  writeString(36, "data");
  view.setUint32(40, totalDataBytes, true);

  // Write 16-bit PCM samples with clipping protection
  let offset = 44;
  for (let i = 0; i < totalSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const intSample = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return buffer;
}

/**
 * Creates a standard audio/wav Blob from mono Float32Array.
 */
export function createWavBlob(
  samples: Float32Array,
  sampleRate: number = CANONICAL_SAMPLE_RATE
): Blob {
  const arrayBuffer = encode16BitMonoWav(samples, sampleRate);
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

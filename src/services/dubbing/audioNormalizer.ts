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

export interface DecodedWavData {
  samples: Float32Array;
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  durationSec: number;
}

/**
 * Decodes a RIFF/WAVE byte buffer (16-bit, 24-bit, 32-bit PCM or 32-bit IEEE Float)
 * into a mono Float32Array and exact duration in seconds.
 */
export function decodeWavBuffer(buffer: ArrayBuffer | Uint8Array): DecodedWavData {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.byteLength < 44) {
    return {
      samples: new Float32Array(0),
      sampleRate: CANONICAL_SAMPLE_RATE,
      numChannels: 1,
      bitsPerSample: 16,
      durationSec: 0,
    };
  }

  let audioFormat = 1;
  let numChannels = 1;
  let sampleRate = CANONICAL_SAMPLE_RATE;
  let bitsPerSample = 16;
  let dataOffset = 44;
  let dataLength = Math.max(0, bytes.byteLength - 44);

  // Parse RIFF chunks dynamically (handles extra JUNK/LIST/fact chunks safely)
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === "fmt " && offset + 8 + 16 <= bytes.byteLength) {
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = Math.max(1, view.getUint16(offset + 10, true));
      sampleRate = Math.max(8000, view.getUint32(offset + 12, true));
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataLength = Math.min(chunkSize, bytes.byteLength - dataOffset);
      break;
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
  const frameSize = bytesPerSample * numChannels;
  const totalFrames = Math.floor(dataLength / frameSize);
  const mono = new Float32Array(totalFrames);

  for (let i = 0; i < totalFrames; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const samplePos = dataOffset + i * frameSize + ch * bytesPerSample;
      let val = 0;
      if (audioFormat === 3 && bitsPerSample === 32) {
        val = view.getFloat32(samplePos, true);
      } else if (bitsPerSample === 16) {
        val = view.getInt16(samplePos, true) / 32768;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(samplePos);
        const b1 = view.getUint8(samplePos + 1);
        const b2 = view.getInt8(samplePos + 2);
        val = ((b2 << 16) | (b1 << 8) | b0) / 8388608;
      } else if (bitsPerSample === 32) {
        val = view.getInt32(samplePos, true) / 2147483648;
      } else if (bitsPerSample === 8) {
        val = (view.getUint8(samplePos) - 128) / 128;
      }
      sum += val;
    }
    mono[i] = Math.max(-1, Math.min(1, sum / numChannels));
  }

  const durationSec = sampleRate > 0 ? Number((totalFrames / sampleRate).toFixed(3)) : 0;
  return {
    samples: mono,
    sampleRate,
    numChannels,
    bitsPerSample,
    durationSec,
  };
}

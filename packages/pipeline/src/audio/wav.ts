/** Minimal 16-bit PCM WAV writer. The pipeline's intermediate format. */

export interface WavOptions {
  sampleRate: number;
  channels?: number;
}

export function encodeWav(samples: Float32Array, options: WavOptions): Buffer {
  const channels = options.channels ?? 1;
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM header size
  buffer.writeUInt16LE(1, 20); // format: PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(options.sampleRate, 24);
  buffer.writeUInt32LE(options.sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(8 * bytesPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * bytesPerSample);
  }
  return buffer;
}

/** Peak sample magnitude, used by the clipping check. */
export function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]!);
    if (v > max) max = v;
  }
  return max;
}

/** Root-mean-square over a window, used by the silence check. */
export function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  const end = Math.min(to, samples.length);
  const start = Math.max(0, from);
  if (end <= start) return 0;
  for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (end - start));
}

/**
 * Bring the peak down to a headroom target before the file is written.
 *
 * Decoding a lossy render routinely lands above 1.0 without anything being
 * wrong, but `encodeWav` writes 16-bit integers and clamps — so storing that
 * signal unchanged manufactures the clipping the check then reports. The first
 * bake-off did exactly this: three renders decoded at peaks of 1.34, 1.15 and
 * 1.12, and were saved flat-topped. The audio was fine; we broke it on the way
 * to disk.
 *
 * Quiet audio is left alone. This is headroom, not loudness matching, and
 * lifting a deliberately soft take to the same peak as a loud one is a
 * different job with different rules.
 */
export function normalisePeak(samples: Float32Array, target = 0.891): Float32Array {
  const top = peak(samples);
  if (top <= target || top === 0) return samples;
  const gain = target / top;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! * gain;
  return out;
}

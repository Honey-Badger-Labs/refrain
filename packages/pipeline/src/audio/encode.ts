import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

const run = promisify(execFile);

/**
 * Finishing: loudness normalisation and encoding.
 *
 * Two encodings per track, both normalised to the same loudness target so
 * nothing jumps in volume between tracks or between formats. Opus is the
 * default and is roughly a third smaller; AAC in an .m4a exists because Safari
 * and older iOS need it. The catalogue lists both and the app picks.
 */

export type Codec = 'opus' | 'aac';

export interface EncodeOptions {
  /** Integrated loudness target in LUFS. One target across the library. */
  loudnessLufs?: number;
  truePeakDb?: number;
  bitrateKbps?: number;
  sampleRate?: number;
}

export interface EncodedFile {
  path: string;
  codec: Codec;
  mimeType: string;
  bitrateKbps: number;
  bytes: number;
  durationSeconds: number;
}

export const CODEC_SETTINGS: Record<
  Codec,
  { extension: string; mimeType: string; bitrateKbps: number }
> = {
  // Container and codec are both named, so `canPlayType` can answer
  // "probably" rather than "maybe".
  opus: { extension: 'webm', mimeType: 'audio/webm; codecs="opus"', bitrateKbps: 32 },
  aac: { extension: 'm4a', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrateKbps: 48 },
};

export class FfmpegMissingError extends Error {
  constructor() {
    super(
      'ffmpeg is not on PATH. Install it (apt install ffmpeg / brew install ffmpeg) and run the render again.',
    );
  }
}

export async function assertFfmpeg(codecs: Codec[] = ['opus', 'aac']): Promise<void> {
  let encoders: string;
  try {
    encoders = (await run('ffmpeg', ['-hide_banner', '-encoders'])).stdout;
  } catch {
    throw new FfmpegMissingError();
  }
  const needed: Record<Codec, string> = { opus: 'libopus', aac: 'aac' };
  const missing = codecs.filter((codec) => !encoders.includes(needed[codec]));
  if (missing.length > 0) {
    throw new Error(
      `this ffmpeg build cannot encode ${missing.join(', ')} (looked for ${missing
        .map((c) => needed[c])
        .join(', ')}). Install a build with those encoders, or pass --formats with what it has.`,
    );
  }
}

/**
 * Encode one WAV into one delivery format.
 *
 * `outPathWithoutExtension` is given without a suffix because the container is
 * the codec's business, not the caller's.
 */
export async function encode(
  wavPath: string,
  outPathWithoutExtension: string,
  codec: Codec,
  options: EncodeOptions = {},
): Promise<EncodedFile> {
  const settings = CODEC_SETTINGS[codec];
  const loudness = options.loudnessLufs ?? -16;
  const truePeak = options.truePeakDb ?? -1.5;
  const bitrate = options.bitrateKbps ?? settings.bitrateKbps;
  const outPath = `${outPathWithoutExtension}.${settings.extension}`;

  const common = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    wavPath,
    '-af',
    `loudnorm=I=${loudness}:TP=${truePeak}:LRA=11`,
    '-ac',
    '1',
    '-b:a',
    `${bitrate}k`,
  ];

  const codecArgs =
    codec === 'opus'
      ? // libopus resamples to 48k internally; saying so avoids a warning.
        ['-c:a', 'libopus', '-ar', '48000', '-vbr', 'on', '-application', 'audio']
      : ['-c:a', 'aac', '-ar', String(options.sampleRate ?? 44100), '-movflags', '+faststart'];

  await run('ffmpeg', [...common, ...codecArgs, outPath]);

  return {
    path: outPath,
    codec,
    mimeType: settings.mimeType,
    bitrateKbps: bitrate,
    bytes: fs.statSync(outPath).size,
    durationSeconds: await probeDuration(outPath),
  };
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe reported no usable duration for ${file}`);
  }
  return Math.round(seconds * 1000) / 1000;
}

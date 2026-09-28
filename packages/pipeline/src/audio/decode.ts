import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../paths.js';

const run = promisify(execFile);

/**
 * Decode whatever a provider sent us into samples the checks can read.
 *
 * A music API returns MP3, WAV, FLAC or whatever it feels like. The auto
 * checks work on a Float32 buffer. ffmpeg is already a dependency, so it does
 * the decoding: one pipe to raw 32-bit floats, mono, at a known rate.
 */
export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
}

export async function decodeToSamples(
  input: Uint8Array | string,
  workDir: string,
  sampleRate = 44100,
): Promise<DecodedAudio> {
  ensureDir(workDir);
  let file: string;
  let temporary = false;

  if (typeof input === 'string') {
    file = input;
  } else {
    file = path.join(workDir, `decode-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    fs.writeFileSync(file, input);
    temporary = true;
  }

  let decoded = false;
  try {
    const { stdout } = await run(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        file,
        '-ac',
        '1',
        '-ar',
        String(sampleRate),
        '-f',
        'f32le',
        '-',
      ],
      { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 },
    );
    const buffer = stdout as unknown as Buffer;
    if (buffer.length < 4) {
      throw new Error('ffmpeg decoded no audio: the provider may have returned an error page, not a file');
    }
    // Copy rather than view: the Buffer may not be 4-byte aligned.
    const samples = new Float32Array(buffer.length / 4);
    for (let i = 0; i < samples.length; i++) samples[i] = buffer.readFloatLE(i * 4);
    decoded = true;
    return { samples, sampleRate };
  } catch (error) {
    // Somebody paid for these bytes. Whatever went wrong here — a missing
    // ffmpeg, a corrupt file, an error page in place of audio — throwing them
    // away as well turns a recoverable problem into a second charge.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}. The bytes that came back are kept at ${file}`);
  } finally {
    if (temporary && decoded && fs.existsSync(file)) fs.unlinkSync(file);
  }
}

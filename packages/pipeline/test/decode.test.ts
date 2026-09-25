import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeToSamples } from '../src/audio/decode.js';
import { hasFfmpeg } from './helpers/ffmpeg.js';

const dirs: string[] = [];
const workDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-decode-'));
  dirs.push(d);
  return d;
};

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * Somebody paid for these bytes.
 *
 * A bake-off run bought three renders and threw all three away, because the
 * bytes were written to a temp file, ffmpeg failed to launch, and the `finally`
 * deleted the file on the way out. A local problem turned into a second
 * charge. Whatever goes wrong at this point, the download survives it.
 */
describe.skipIf(!hasFfmpeg)('decoding something that is not audio', () => {
  it('keeps the bytes and says where they are', async () => {
    const dir = workDir();
    const notAudio = Buffer.from('{"error":"quota exceeded"}');

    await expect(decodeToSamples(notAudio, dir)).rejects.toThrow(/kept at/);

    const left = fs.readdirSync(dir).filter((f) => f.startsWith('decode-'));
    expect(left).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, left[0]!))).toEqual(notAudio);
  });

  it('cleans up after a decode that worked', async () => {
    const dir = workDir();
    // A tiny real WAV: ffmpeg can read this one.
    const { encodeWav } = await import('../src/audio/wav.js');
    const samples = new Float32Array(8000).map((_, i) => 0.1 * Math.sin(i / 10));
    const wav = encodeWav(samples, { sampleRate: 8000 });

    const out = await decodeToSamples(wav, dir);
    expect(out.samples.length).toBeGreaterThan(0);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('decode-'))).toHaveLength(0);
  });
});

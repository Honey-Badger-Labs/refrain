import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);

/**
 * Transcription for the accuracy check.
 *
 * The spec's most important check is transcribe-and-diff: music models drop,
 * repeat and invent words, and a machine catches that far more cheaply than a
 * reviewer does. That check is only as good as the transcriber, so a missing
 * transcriber must read as "not checked", never as "passed". Every adapter may
 * return null, and null is carried all the way through to the report.
 */
export interface Transcriber {
  readonly name: string;
  available(): Promise<boolean>;
  /** Returns the transcript, or null when this adapter cannot judge the audio. */
  transcribe(audioPath: string): Promise<string | null>;
}

/**
 * The default. The synth adapter sings vowels, not words, so there is nothing
 * for a transcriber to recognise and the honest answer is "unknown".
 */
export const nullTranscriber: Transcriber = {
  name: 'none',
  async available() {
    return true;
  },
  async transcribe() {
    return null;
  },
};

/**
 * Shells out to a local whisper build when one is installed. Used for real
 * renders; absent in CI, where it reports itself unavailable rather than
 * silently passing tracks.
 */
export const whisperCliTranscriber: Transcriber = {
  name: 'whisper-cli',
  async available() {
    for (const bin of ['whisper-cli', 'whisper']) {
      try {
        await run(bin, ['--help']);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  },
  async transcribe(audioPath: string) {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-asr-'));
    for (const bin of ['whisper-cli', 'whisper']) {
      try {
        await run(bin, [audioPath, '--output_format', 'txt', '--output_dir', outDir], {
          maxBuffer: 32 * 1024 * 1024,
        });
        const file = fs
          .readdirSync(outDir)
          .find((f) => f.endsWith('.txt'));
        if (!file) return null;
        return fs.readFileSync(path.join(outDir, file), 'utf8');
      } catch {
        continue;
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    }
    return null;
  },
};

const transcribers = new Map<string, Transcriber>([
  [nullTranscriber.name, nullTranscriber],
  [whisperCliTranscriber.name, whisperCliTranscriber],
]);

export function getTranscriber(name: string): Transcriber {
  const transcriber = transcribers.get(name);
  if (!transcriber) {
    throw new Error(
      `no transcriber named ${name}. Known: ${[...transcribers.keys()].join(', ')}`,
    );
  }
  return transcriber;
}

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

/**
 * An OpenAI-compatible speech-to-text endpoint.
 *
 * Installing whisper locally is the better answer for a long run, but a
 * bake-off is three chunks and an afternoon, and the point is to get the
 * accuracy number today rather than after a CUDA install. Configured with two
 * environment variables so it works against any compatible host.
 */
export const whisperApiTranscriber: Transcriber = {
  name: 'whisper-api',
  async available() {
    return Boolean(process.env.REFRAIN_ASR_KEY && process.env.REFRAIN_ASR_URL);
  },
  async transcribe(audioPath: string) {
    const url = process.env.REFRAIN_ASR_URL;
    const key = process.env.REFRAIN_ASR_KEY;
    const model = process.env.REFRAIN_ASR_MODEL ?? 'whisper-1';
    if (!url || !key) return null;

    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
    form.append('model', model);
    form.append('response_format', 'text');
    // Sung words are not conversational speech; saying so measurably helps.
    form.append('prompt', 'A sung performance of a poem. Transcribe the words exactly.');

    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
    if (!response.ok) return null;
    return (await response.text()).trim() || null;
  },
};

const transcribers = new Map<string, Transcriber>([
  [nullTranscriber.name, nullTranscriber],
  [whisperCliTranscriber.name, whisperCliTranscriber],
  [whisperApiTranscriber.name, whisperApiTranscriber],
]);

/** The best transcriber that is actually installed and configured. */
export async function bestAvailableTranscriber(): Promise<Transcriber> {
  for (const candidate of [whisperCliTranscriber, whisperApiTranscriber]) {
    if (await candidate.available()) return candidate;
  }
  return nullTranscriber;
}

export function getTranscriber(name: string): Transcriber {
  const transcriber = transcribers.get(name);
  if (!transcriber) {
    throw new Error(
      `no transcriber named ${name}. Known: ${[...transcribers.keys()].join(', ')}`,
    );
  }
  return transcriber;
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeToSamples } from '../audio/decode.js';
import { encodeWav } from '../audio/wav.js';

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
 * The two whispers.
 *
 * "whisper" on a PATH is one of two unrelated programs. openai-whisper (pip)
 * takes `--output_format txt --output_dir DIR` and resamples internally.
 * whisper.cpp (brew install whisper-cpp, binary `whisper-cli`) takes
 * `-otxt -of PREFIX -m MODEL`, ships no model, and reads 16 kHz WAV only.
 *
 * Telling them apart is not a nicety. whisper.cpp calls exit(0) on both
 * `--help` AND an unknown argument, so driving it with openai-whisper's flags
 * looks, to execFile, like a clean success that happened to write no file —
 * and a bake-off that has already paid for its renders reports accuracy as
 * "not measured". Invariant 2 with money attached. Each flavour is therefore
 * identified from its own --help before anything is spent, and one we cannot
 * drive reports unavailable rather than nearly working.
 */
export type WhisperFlavour = 'openai-whisper' | 'whisper-cpp';

/** Which whisper answered, judged by the flags its own --help advertises. */
export function whisperFlavour(help: string): WhisperFlavour | null {
  if (help.includes('--output_dir')) return 'openai-whisper';
  if (help.includes('--output-txt') || help.includes('-otxt')) return 'whisper-cpp';
  return null;
}

/**
 * Where the transcript lands. whisper.cpp names the file after `-of` plus an
 * extension it chooses; openai-whisper names it after the input.
 */
export function whisperOutput(
  flavour: WhisperFlavour,
  audioPath: string,
  outDir: string,
): { args: string[]; transcript: string } {
  if (flavour === 'whisper-cpp') {
    const prefix = path.join(outDir, 'transcript');
    return {
      args: ['-otxt', '-of', prefix, '-f', audioPath],
      transcript: `${prefix}.txt`,
    };
  }
  return {
    args: [audioPath, '--output_format', 'txt', '--output_dir', outDir],
    transcript: path.join(outDir, `${path.basename(audioPath, path.extname(audioPath))}.txt`),
  };
}

interface ResolvedWhisper {
  bin: string;
  flavour: WhisperFlavour;
  /** whisper.cpp only: it has no default model and will not run without one. */
  model?: string;
}

/**
 * Probe the PATH once and report either something we can actually drive or the
 * sentence the reader needs. Returning a reason rather than a bare false is
 * what makes "no transcriber" actionable for someone who did install whisper.
 */
async function resolveWhisper(): Promise<ResolvedWhisper | { reason: string | null }> {
  let found: { bin: string; help: string } | null = null;

  for (const bin of ['whisper-cli', 'whisper']) {
    try {
      const { stdout, stderr } = await run(bin, ['--help'], { maxBuffer: 4 * 1024 * 1024 });
      // whisper.cpp prints its usage to stderr, openai-whisper to stdout.
      found = { bin, help: `${stdout}\n${stderr}` };
      break;
    } catch {
      continue;
    }
  }

  if (!found) return { reason: null };

  const flavour = whisperFlavour(found.help);
  if (flavour === null) {
    return {
      reason: `${found.bin} is on PATH but its --help matches neither openai-whisper nor whisper.cpp, so it cannot be driven safely. Install openai-whisper (pip install -U openai-whisper).`,
    };
  }

  if (flavour === 'whisper-cpp') {
    const model = process.env.REFRAIN_WHISPER_MODEL;
    if (!model) {
      return {
        reason: `${found.bin} is whisper.cpp, which ships no model. Set REFRAIN_WHISPER_MODEL to a ggml model file (see the whisper.cpp README), or install openai-whisper (pip install -U openai-whisper), which needs no extra setup.`,
      };
    }
    if (!fs.existsSync(model)) {
      return { reason: `REFRAIN_WHISPER_MODEL points at ${model}, which does not exist.` };
    }
    return { bin: found.bin, flavour, model };
  }

  return { bin: found.bin, flavour };
}

function isResolved(r: ResolvedWhisper | { reason: string | null }): r is ResolvedWhisper {
  return 'bin' in r;
}

/** Why no local whisper is usable, when there is something to be done about it. */
export async function whisperUnavailableReason(): Promise<string | null> {
  const resolved = await resolveWhisper();
  return isResolved(resolved) ? null : resolved.reason;
}

/**
 * Shells out to a local whisper build when one is installed. Used for real
 * renders; absent in CI, where it reports itself unavailable rather than
 * silently passing tracks.
 */
export const whisperCliTranscriber: Transcriber = {
  name: 'whisper-cli',
  async available() {
    return isResolved(await resolveWhisper());
  },
  async transcribe(audioPath: string) {
    const resolved = await resolveWhisper();
    if (!isResolved(resolved)) return null;

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-asr-'));
    try {
      // whisper.cpp reads 16 kHz WAV and nothing else; renders are 44.1 kHz.
      // openai-whisper resamples itself, so only the former pays for this.
      const input =
        resolved.flavour === 'whisper-cpp'
          ? await to16kWav(audioPath, outDir)
          : audioPath;

      const { args, transcript } = whisperOutput(resolved.flavour, input, outDir);
      const model = resolved.model ? ['-m', resolved.model] : [];
      await run(resolved.bin, [...model, ...args], { maxBuffer: 32 * 1024 * 1024 });

      // Never infer success from the exit code: whisper.cpp exits 0 after
      // printing a usage dump. The file it was asked to write is the evidence.
      if (!fs.existsSync(transcript)) return null;
      return fs.readFileSync(transcript, 'utf8').trim() || null;
    } catch {
      return null;
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  },
};

async function to16kWav(audioPath: string, outDir: string): Promise<string> {
  const { samples } = await decodeToSamples(audioPath, outDir, 16000);
  const file = path.join(outDir, 'input-16k.wav');
  fs.writeFileSync(file, encodeWav(samples, { sampleRate: 16000 }));
  return file;
}

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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { encodeWav } from '../audio/wav.js';
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
 * Shells out to a local whisper build when one is installed.
 *
 * Two different programs answer to these names, and they do not share a
 * command line. `whisper` is the Python package (`--output_format txt
 * --output_dir DIR`, downloads its own weights). `whisper-cli` is whisper.cpp,
 * which is what `brew install whisper-cpp` puts on the PATH, and it wants
 * `-m MODEL -f AUDIO -otxt -of PREFIX` with weights the user supplies.
 *
 * Presence is therefore not capability, and the difference costs money: this
 * adapter is the gate `refrain bakeoff` checks before it starts paying a music
 * model. An `available()` that only proved a binary existed would open the gate
 * for a whisper.cpp install, spend the budget, fail every invocation on
 * unrecognised flags, and report word accuracy as unknown for the whole run —
 * invariant 2 broken from the other side, by a check that could not run but
 * said it could. So `available()` here drives the real invocation against a
 * generated probe clip and believes only an output file.
 */
type WhisperDialect = 'openai' | 'cpp';

interface WhisperCli {
  bin: string;
  dialect: WhisperDialect;
  /** whisper.cpp needs weights named explicitly; the Python CLI fetches its own. */
  model?: string;
}

const WHISPER_BINARIES = ['whisper-cli', 'whisper', 'whisper-cpp'];

/** The sample rate whisper.cpp accepts. Anything else makes it exit rather than resample. */
const PROBE_SAMPLE_RATE = 16000;

async function helpText(bin: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(bin, ['--help'], { maxBuffer: 4 * 1024 * 1024 });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    // whisper.cpp prints its usage and exits non-zero. That is still an answer.
    const failed = error as { stdout?: string; stderr?: string };
    const text = `${failed.stdout ?? ''}\n${failed.stderr ?? ''}`.trim();
    return text || null;
  }
}

function dialectOf(help: string): WhisperDialect | null {
  if (/--output_format|--output_dir/.test(help)) return 'openai';
  if (/-otxt|--output-txt|-m\s+FNAME|--model\s+FNAME/.test(help)) return 'cpp';
  return null;
}

/**
 * Where whisper.cpp weights tend to live. Homebrew ships the binary without
 * them, so an install that looks complete usually is not.
 */
function cppModel(): string | null {
  const explicit = process.env.WHISPER_MODEL;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const dirs = [
    path.join(os.homedir(), '.cache', 'whisper'),
    path.join(os.homedir(), '.local', 'share', 'whisper-cpp'),
    '/opt/homebrew/share/whisper-cpp/models',
    '/usr/local/share/whisper-cpp/models',
  ];
  for (const dir of dirs) {
    try {
      const file = fs.readdirSync(dir).find((f) => f.startsWith('ggml-') && f.endsWith('.bin'));
      if (file) return path.join(dir, file);
    } catch {
      continue;
    }
  }
  return null;
}

async function resolveWhisper(): Promise<WhisperCli | null> {
  for (const bin of WHISPER_BINARIES) {
    const help = await helpText(bin);
    if (!help) continue;
    const dialect = dialectOf(help);
    if (!dialect) continue;
    if (dialect === 'openai') return { bin, dialect };
    const model = cppModel();
    // A whisper.cpp with no weights cannot transcribe. Keep looking rather than
    // claiming it can: another binary on the PATH may be the Python one.
    if (model) return { bin, dialect, model };
  }
  return null;
}

async function runWhisper(cli: WhisperCli, audioPath: string, outDir: string): Promise<string | null> {
  const args =
    cli.dialect === 'openai'
      ? [audioPath, '--output_format', 'txt', '--output_dir', outDir]
      : ['-m', cli.model as string, '-f', audioPath, '-otxt', '-of', path.join(outDir, 'out')];
  try {
    await run(cli.bin, args, { maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return null;
  }
  const file = fs.readdirSync(outDir).find((f) => f.endsWith('.txt'));
  return file ? fs.readFileSync(path.join(outDir, file), 'utf8') : null;
}

async function withTempDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-asr-'));
  try {
    return await body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const whisperCliTranscriber: Transcriber = {
  name: 'whisper-cli',
  async available() {
    const cli = await resolveWhisper();
    if (!cli) return false;
    // A second of quiet tone. Whisper will find no words in it, and that is
    // fine: what is being tested is whether this command line runs at all.
    const samples = new Float32Array(PROBE_SAMPLE_RATE);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / PROBE_SAMPLE_RATE);
    }
    return withTempDir(async (dir) => {
      const probe = path.join(dir, 'probe.wav');
      fs.writeFileSync(probe, encodeWav(samples, { sampleRate: PROBE_SAMPLE_RATE }));
      return (await runWhisper(cli, probe, dir)) !== null;
    });
  },
  async transcribe(audioPath: string) {
    const cli = await resolveWhisper();
    if (!cli) return null;
    return withTempDir(async (dir) => {
      const text = await runWhisper(cli, audioPath, dir);
      return text?.trim() || null;
    });
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

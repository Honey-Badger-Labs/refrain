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
  /**
   * Why this adapter cannot run, when it is worth saying.
   *
   * "Unavailable" covers two very different situations: nothing is configured,
   * and something is configured but does not work. The first is answered by
   * the generic advice; the second is answered by nothing at all unless the
   * adapter says what it found. Returns null when the generic advice fits.
   */
  why?(): Promise<string | null>;
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

/**
 * A second of quiet tone, written where a transcriber can be pointed at it.
 *
 * There are no words in it and there do not need to be: what a probe tests is
 * whether this transcriber can be driven at all, not whether it hears well.
 */
function writeProbe(dir: string): string {
  const samples = new Float32Array(PROBE_SAMPLE_RATE);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / PROBE_SAMPLE_RATE);
  }
  const file = path.join(dir, 'probe.wav');
  fs.writeFileSync(file, encodeWav(samples, { sampleRate: PROBE_SAMPLE_RATE }));
  return file;
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
    return withTempDir(async (dir) => {
      const probe = writeProbe(dir);
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
  async why() {
    const found: string[] = [];
    for (const bin of WHISPER_BINARIES) {
      const help = await helpText(bin);
      if (!help) continue;
      const dialect = dialectOf(help);
      if (!dialect) {
        found.push(`${bin} is on the PATH but its command line is not one this knows`);
      } else if (dialect === 'cpp' && !cppModel()) {
        found.push(
          `${bin} is whisper.cpp and ships no weights. Download a ggml model and point WHISPER_MODEL at it, or put it in ~/.cache/whisper`,
        );
      }
    }
    if (found.length) return found.join('; ');
    const cli = await resolveWhisper();
    if (cli) return `${cli.bin} is installed but produced nothing for a probe clip`;
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
  /**
   * Two variables being set is not the same as an endpoint that answers.
   *
   * A key can expire, a host can move and an account can run out of credit,
   * and every one of those looks identical to a working transcriber if all
   * that is checked is whether the strings are present. `refrain bakeoff`
   * asks this before it starts paying a music model, so the question has to
   * be "does it answer", not "is it configured".
   */
  async available() {
    if (!process.env.REFRAIN_ASR_KEY || !process.env.REFRAIN_ASR_URL) return false;
    return withTempDir(async (dir) => {
      const response = await askAsr(writeProbe(dir));
      return response !== null && response.ok;
    });
  },
  async transcribe(audioPath: string) {
    const response = await askAsr(audioPath);
    if (!response || !response.ok) return null;
    return (await response.text()).trim() || null;
  },
  async why() {
    if (!process.env.REFRAIN_ASR_KEY || !process.env.REFRAIN_ASR_URL) return null;
    return withTempDir(async (dir) => {
      const response = await askAsr(writeProbe(dir));
      if (!response) {
        return 'REFRAIN_ASR_URL and REFRAIN_ASR_KEY are set, but the host could not be reached';
      }
      if (response.ok) return null;
      const model = process.env.REFRAIN_ASR_MODEL || 'whisper-1';
      // A wrong model name is the usual cause and the least obvious: the
      // default suits OpenAI and is rejected by every other host.
      const hint =
        response.status === 400 || response.status === 404
          ? ` The model asked for was "${model}" — set REFRAIN_ASR_MODEL to one this host serves (Groq wants whisper-large-v3)`
          : response.status === 401 || response.status === 403
            ? ' The key was refused'
            : '';
      // What the host said, which names the host and the actual complaint far
      // better than a status code guessed at from here. Capped, and it is an
      // error body: these carry a reason, never the credential that was sent.
      let said = '';
      try {
        const body = (await response.text()).replace(/\s+/g, ' ').trim();
        if (body) said = `. It said: ${body.slice(0, 300).replace(/\.$/, '')}`;
      } catch {
        /* a body that cannot be read is not worth a second failure */
      }
      // No hint and a body would read "answered 429.. It said", so the full
      // stop belongs to whichever clause actually ends the sentence.
      return `the transcription endpoint answered ${response.status}${hint}${said}.`;
    });
  },
};

/** The request both of the above make. The caller decides what a reply means. */
async function askAsr(audioPath: string): Promise<Response | null> {
  const url = process.env.REFRAIN_ASR_URL;
  const key = process.env.REFRAIN_ASR_KEY;
  // `||`, not `??`: a CI runner sets an absent secret to the empty string
  // rather than leaving it unset, and an empty model name draws a 400 that
  // looks exactly like a wrong one. This cost a workflow run.
  const model = process.env.REFRAIN_ASR_MODEL || 'whisper-1';
  if (!url || !key) return null;

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
  form.append('model', model);
  form.append('response_format', 'text');
  // Sung words are not conversational speech; saying so measurably helps.
  form.append('prompt', 'A sung performance of a poem. Transcribe the words exactly.');

  try {
    return await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
  } catch {
    // Unreachable host, DNS failure, timeout — all of them mean "cannot score".
    return null;
  }
}

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

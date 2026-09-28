import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  whisperCliTranscriber,
  whisperApiTranscriber,
  nullTranscriber,
} from '../src/checks/transcribe.js';

/**
 * These stand in for the two programs that answer to "whisper".
 *
 * The bug this file guards: `available()` used to mean "a binary of that name
 * responded to --help", which a whisper.cpp install satisfies without being
 * drivable by the flags the adapter sends. `refrain bakeoff` checks
 * `available()` before it starts paying a music model, so that gap turned a
 * `brew install whisper-cpp` into a paid run that scored nothing.
 */
const CPP_CLI = `#!/bin/sh
case "$1" in
  --help)
    echo "usage: whisper-cli [options] file.wav"
    echo "  -m FNAME, --model FNAME   model path"
    echo "  -otxt,    --output-txt    output result in a text file"
    exit 1 ;;
esac
model=""; audio=""; prefix=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m) model="$2"; shift 2 ;;
    -f) audio="$2"; shift 2 ;;
    -of) prefix="$2"; shift 2 ;;
    -otxt) shift ;;
    *) echo "error: unknown argument $1" >&2; exit 1 ;;
  esac
done
[ -n "$model" ] && [ -n "$audio" ] && [ -n "$prefix" ] || exit 1
echo "a transcript" > "$prefix.txt"
`;

const OPENAI_CLI = `#!/bin/sh
case "$1" in
  --help)
    echo "usage: whisper [-h] [--output_dir OUTPUT_DIR] [--output_format {txt,vtt}]"
    exit 0 ;;
esac
audio="$1"; shift
dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output_dir) dir="$2"; shift 2 ;;
    --output_format) shift 2 ;;
    *) echo "error: unrecognized argument $1" >&2; exit 1 ;;
  esac
done
[ -n "$audio" ] && [ -n "$dir" ] || exit 1
echo "a transcript" > "$dir/out.txt"
`;

let bin: string;
let home: string;
let originalPath: string | undefined;
let originalHome: string | undefined;
let originalModel: string | undefined;

function install(name: string, script: string) {
  const file = path.join(bin, name);
  fs.writeFileSync(file, script, { mode: 0o755 });
}

beforeEach(() => {
  bin = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-bin-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-home-'));
  originalPath = process.env.PATH;
  originalHome = process.env.HOME;
  originalModel = process.env.WHISPER_MODEL;
  // Only the fakes are reachable, so a real whisper on this machine cannot
  // decide the result either way.
  process.env.PATH = bin;
  process.env.HOME = home;
  delete process.env.WHISPER_MODEL;
});

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalModel === undefined) delete process.env.WHISPER_MODEL;
  else process.env.WHISPER_MODEL = originalModel;
  fs.rmSync(bin, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe('the whisper CLI transcriber', () => {
  it('reports unavailable when whisper.cpp is installed without weights', async () => {
    install('whisper-cli', CPP_CLI);
    // The binary is there and answers --help. It still cannot transcribe
    // anything, so the bake-off must not treat this as a working scorer.
    expect(await whisperCliTranscriber.available()).toBe(false);
    expect(await whisperCliTranscriber.transcribe('/nonexistent.wav')).toBeNull();
  });

  it('drives whisper.cpp with its own flags once weights are named', async () => {
    install('whisper-cli', CPP_CLI);
    const model = path.join(home, 'ggml-base.en.bin');
    fs.writeFileSync(model, 'weights');
    process.env.WHISPER_MODEL = model;

    expect(await whisperCliTranscriber.available()).toBe(true);

    const audio = path.join(home, 'take.wav');
    fs.writeFileSync(audio, 'audio');
    expect(await whisperCliTranscriber.transcribe(audio)).toBe('a transcript');
  });

  it('finds weights in the cache directory without an environment variable', async () => {
    install('whisper-cli', CPP_CLI);
    const cache = path.join(home, '.cache', 'whisper');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'ggml-small.bin'), 'weights');

    expect(await whisperCliTranscriber.available()).toBe(true);
  });

  it('drives the Python whisper with its own flags', async () => {
    install('whisper', OPENAI_CLI);

    expect(await whisperCliTranscriber.available()).toBe(true);

    const audio = path.join(home, 'take.wav');
    fs.writeFileSync(audio, 'audio');
    expect(await whisperCliTranscriber.transcribe(audio)).toBe('a transcript');
  });

  it('reports unavailable when nothing named whisper is installed', async () => {
    expect(await whisperCliTranscriber.available()).toBe(false);
  });

  it('reports unavailable for a binary whose command line it cannot recognise', async () => {
    install('whisper', '#!/bin/sh\necho "some other tool"\nexit 0\n');
    expect(await whisperCliTranscriber.available()).toBe(false);
  });
});

describe('the null transcriber', () => {
  it('is available and answers unknown, never a transcript', async () => {
    expect(await nullTranscriber.available()).toBe(true);
    expect(await nullTranscriber.transcribe('anything.wav')).toBeNull();
  });
});

/**
 * The same gap as the CLI one, on the other adapter and on the path a CI run
 * takes: `refrain bakeoff` gates on `available()`, and two environment
 * variables being set says nothing about whether the endpoint answers. A key
 * expires, a host moves, an account runs out of credit — and each of those
 * looked exactly like a working transcriber.
 */
describe('the whisper API transcriber', () => {
  const realFetch = globalThis.fetch;
  let calls = 0;

  const withAsr = async (reply: () => Response | Promise<Response>, body: () => Promise<void>) => {
    process.env.REFRAIN_ASR_URL = 'https://asr.example/v1/audio/transcriptions';
    process.env.REFRAIN_ASR_KEY = 'k';
    calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return reply();
    }) as typeof fetch;
    try {
      await body();
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.REFRAIN_ASR_URL;
      delete process.env.REFRAIN_ASR_KEY;
    }
  };

  it('is unavailable when nothing is configured', async () => {
    delete process.env.REFRAIN_ASR_URL;
    delete process.env.REFRAIN_ASR_KEY;
    expect(await whisperApiTranscriber.available()).toBe(false);
  });

  it('asks the endpoint rather than trusting the variables', async () => {
    await withAsr(
      () => new Response('', { status: 200 }),
      async () => {
        expect(await whisperApiTranscriber.available()).toBe(true);
        expect(calls).toBe(1);
      },
    );
  });

  it('is unavailable when the key is refused', async () => {
    await withAsr(
      () => new Response('nope', { status: 401 }),
      async () => {
        expect(await whisperApiTranscriber.available()).toBe(false);
      },
    );
  });

  it('is unavailable when the host cannot be reached', async () => {
    await withAsr(
      () => {
        throw new Error('ENOTFOUND');
      },
      async () => {
        expect(await whisperApiTranscriber.available()).toBe(false);
      },
    );
  });

  it('returns the transcript when there is one, and null when there is not', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-take-'));
    const take = path.join(dir, 'take.wav');
    fs.writeFileSync(take, 'audio');
    try {
      await withAsr(
        () => new Response('  Tyger Tyger  ', { status: 200 }),
        async () => {
          expect(await whisperApiTranscriber.transcribe(take)).toBe('Tyger Tyger');
        },
      );
      await withAsr(
        () => new Response('   ', { status: 200 }),
        async () => {
          expect(await whisperApiTranscriber.transcribe(take)).toBeNull();
        },
      );
      await withAsr(
        () => new Response('nope', { status: 500 }),
        async () => {
          expect(await whisperApiTranscriber.transcribe(take)).toBeNull();
        },
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The message a failed bake-off leaves behind.
 *
 * The first real run of the workflow refused with "set REFRAIN_ASR_URL and
 * REFRAIN_ASR_KEY" while both were set, which points the reader at the one
 * thing that was already done. Configured-and-broken is a different problem
 * from not-configured and needs a different sentence.
 */
describe('why a transcriber cannot run', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.REFRAIN_ASR_URL;
    delete process.env.REFRAIN_ASR_KEY;
    delete process.env.REFRAIN_ASR_MODEL;
  });

  const asr = (status: number) => {
    process.env.REFRAIN_ASR_URL = 'https://asr.example/v1/audio/transcriptions';
    process.env.REFRAIN_ASR_KEY = 'k';
    globalThis.fetch = (async () => new Response('', { status })) as typeof fetch;
  };

  it('says nothing when nothing is configured, so the generic advice stands', async () => {
    expect(await whisperApiTranscriber.why?.()).toBeNull();
  });

  it('names the status when the endpoint answers badly', async () => {
    asr(500);
    const why = (await whisperApiTranscriber.why?.()) ?? '';
    expect(why).toMatch(/answered 500/);
    expect(why).not.toMatch(/\.\./);
  });

  it('points at the model name on a 400, which is the usual cause', async () => {
    asr(400);
    const why = (await whisperApiTranscriber.why?.()) ?? '';
    expect(why).toMatch(/REFRAIN_ASR_MODEL/);
    expect(why).toMatch(/whisper-1/);
  });

  it('says the key was refused on a 401', async () => {
    asr(401);
    expect(await whisperApiTranscriber.why?.()).toMatch(/key was refused/);
  });

  it('says so when the host cannot be reached at all', async () => {
    process.env.REFRAIN_ASR_URL = 'https://asr.example/v1/audio/transcriptions';
    process.env.REFRAIN_ASR_KEY = 'k';
    globalThis.fetch = (async () => {
      throw new Error('ENOTFOUND');
    }) as typeof fetch;
    expect(await whisperApiTranscriber.why?.()).toMatch(/could not be reached/);
  });

  it('stays quiet when no whisper is installed at all', async () => {
    expect(await whisperCliTranscriber.why?.()).toBeNull();
  });
});

/**
 * The bug that wasted a workflow run.
 *
 * `process.env.X ?? default` looks right and is wrong for environment
 * variables: a CI runner sets an absent secret to the empty string, which is
 * not nullish, so the default never applied and the endpoint was asked for a
 * model named "". The 400 that came back was indistinguishable from a wrong
 * model name.
 */
describe('an absent model name', () => {
  const realFetch = globalThis.fetch;
  let sent: string | null = null;

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.REFRAIN_ASR_URL;
    delete process.env.REFRAIN_ASR_KEY;
    delete process.env.REFRAIN_ASR_MODEL;
  });

  const capture = () => {
    process.env.REFRAIN_ASR_URL = 'https://asr.example/v1/audio/transcriptions';
    process.env.REFRAIN_ASR_KEY = 'k';
    sent = null;
    globalThis.fetch = (async (_url: unknown, init: { body: FormData }) => {
      sent = String(init.body.get('model'));
      return new Response('ok text', { status: 200 });
    }) as unknown as typeof fetch;
  };

  it('falls back when the variable is empty, not only when it is unset', async () => {
    capture();
    process.env.REFRAIN_ASR_MODEL = '';
    await whisperApiTranscriber.transcribe('/dev/null');
    expect(sent).toBe('whisper-1');
  });

  it('still honours a model that is actually set', async () => {
    capture();
    process.env.REFRAIN_ASR_MODEL = 'whisper-large-v3';
    await whisperApiTranscriber.transcribe('/dev/null');
    expect(sent).toBe('whisper-large-v3');
  });

  it('repeats what the host said, which names the host', async () => {
    process.env.REFRAIN_ASR_URL = 'https://asr.example/v1/audio/transcriptions';
    process.env.REFRAIN_ASR_KEY = 'k';
    globalThis.fetch = (async () =>
      new Response('{"error":{"message":"model `` does not exist"}}', { status: 400 })) as typeof fetch;
    expect(await whisperApiTranscriber.why?.()).toMatch(/does not exist/);
  });
});

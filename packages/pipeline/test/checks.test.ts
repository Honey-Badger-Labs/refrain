import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChecks, DEFAULT_THRESHOLDS } from '../src/checks/autochecks.js';
import { encodeWav, peak, rms } from '../src/audio/wav.js';
import {
  nullTranscriber,
  whisperCliTranscriber,
  whisperFlavour,
  whisperOutput,
  whisperUnavailableReason,
} from '../src/checks/transcribe.js';

const SAMPLE_RATE = 8000;

function tone(seconds: number, amplitude = 0.5): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * SAMPLE_RATE));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
  }
  return samples;
}

function withGap(beforeSeconds: number, gapSeconds: number, afterSeconds: number): Float32Array {
  const head = tone(beforeSeconds);
  const gap = new Float32Array(Math.floor(gapSeconds * SAMPLE_RATE));
  const tail = tone(afterSeconds);
  const out = new Float32Array(head.length + gap.length + tail.length);
  out.set(head, 0);
  out.set(tail, head.length + gap.length);
  return out;
}

const lines = ['Tyger Tyger burning bright', 'In the forests of the night'];
const alignment = [
  { lineIndex: 0, start: 0, end: 4 },
  { lineIndex: 1, start: 4, end: 8 },
];

const base = { sampleRate: SAMPLE_RATE, lines, alignment, transcript: null };

function statusOf(report: ReturnType<typeof runChecks>, id: string) {
  return report.results.find((r) => r.id === id)?.status;
}

describe('auto checks', () => {
  it('passes a healthy render', () => {
    const report = runChecks({ ...base, samples: tone(8) });
    expect(statusOf(report, 'duration')).toBe('pass');
    expect(statusOf(report, 'silence')).toBe('pass');
    expect(statusOf(report, 'clipping')).toBe('pass');
    expect(statusOf(report, 'alignment')).toBe('pass');
    expect(report.passed).toBe(true);
  });

  it('fails a render that is far too short for its words', () => {
    const report = runChecks({ ...base, samples: tone(0.5), alignment: [] });
    expect(statusOf(report, 'duration')).toBe('fail');
    expect(report.passed).toBe(false);
  });

  it('fails a render that drags', () => {
    const report = runChecks({ ...base, samples: tone(300), alignment: [] });
    expect(statusOf(report, 'duration')).toBe('fail');
  });

  it('fails on a dropped phrase in the middle', () => {
    const report = runChecks({ ...base, samples: withGap(3, 4, 3), alignment: [] });
    expect(statusOf(report, 'silence')).toBe('fail');
    expect(report.results.find((r) => r.id === 'silence')?.detail).toMatch(/gap/);
  });

  it('allows a count-in and a chord ringing out', () => {
    const head = new Float32Array(Math.floor(1.5 * SAMPLE_RATE));
    const body = tone(8);
    const tail = new Float32Array(Math.floor(2 * SAMPLE_RATE));
    const samples = new Float32Array(head.length + body.length + tail.length);
    samples.set(body, head.length);
    const report = runChecks({ ...base, samples, alignment: [] });
    expect(statusOf(report, 'silence')).toBe('pass');
  });

  it('fails a track that is silent throughout', () => {
    const report = runChecks({ ...base, samples: new Float32Array(SAMPLE_RATE * 8), alignment: [] });
    expect(statusOf(report, 'silence')).toBe('fail');
  });

  it('fails a clipped render', () => {
    const samples = tone(8, 1.4);
    const report = runChecks({ ...base, samples, alignment: [] });
    expect(statusOf(report, 'clipping')).toBe('fail');
  });

  it('reports accuracy as skipped, not passed, when nothing listened', () => {
    const report = runChecks({ ...base, samples: tone(8) });
    expect(statusOf(report, 'accuracy')).toBe('skipped');
    expect(report.incomplete).toBe(true);
    expect(report.wordAccuracy).toBeUndefined();
  });

  it('passes accuracy on a faithful transcript', () => {
    const report = runChecks({
      ...base,
      samples: tone(8),
      transcript: 'Tyger, Tyger burning bright! In the forests of the night.',
    });
    expect(statusOf(report, 'accuracy')).toBe('pass');
    expect(report.wordAccuracy).toBe(1);
  });

  it('fails accuracy and names the missing words', () => {
    const report = runChecks({
      ...base,
      samples: tone(8),
      transcript: 'Tyger burning bright in the forests',
    });
    expect(statusOf(report, 'accuracy')).toBe('fail');
    expect(report.results.find((r) => r.id === 'accuracy')?.detail).toMatch(/dropped/);
  });

  it('fails alignment that overlaps or runs past the audio', () => {
    const overlapping = runChecks({
      ...base,
      samples: tone(8),
      alignment: [
        { lineIndex: 0, start: 0, end: 5 },
        { lineIndex: 1, start: 3, end: 8 },
      ],
    });
    expect(statusOf(overlapping, 'alignment')).toBe('fail');

    const past = runChecks({
      ...base,
      samples: tone(8),
      alignment: [
        { lineIndex: 0, start: 0, end: 4 },
        { lineIndex: 1, start: 4, end: 40 },
      ],
    });
    expect(statusOf(past, 'alignment')).toBe('fail');
  });

  it('exposes its thresholds so a corpus can tune them', () => {
    expect(DEFAULT_THRESHOLDS.minWordAccuracy).toBe(0.99);
    const loose = runChecks({
      ...base,
      samples: tone(8),
      transcript: 'Tyger Tyger burning bright in the forests of the',
      thresholds: { minWordAccuracy: 0.5 },
    });
    expect(statusOf(loose, 'accuracy')).toBe('pass');
  });
});

describe('wav helpers', () => {
  it('writes a RIFF header of the right size', () => {
    const buffer = encodeWav(tone(0.1), { sampleRate: SAMPLE_RATE });
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(buffer.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(buffer.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(buffer.length).toBe(44 + Math.floor(0.1 * SAMPLE_RATE) * 2);
  });

  it('measures peak and rms', () => {
    expect(peak(tone(0.1, 0.5))).toBeCloseTo(0.5, 1);
    expect(rms(tone(0.1, 0.5))).toBeCloseTo(0.5 / Math.SQRT2, 1);
    expect(rms(new Float32Array(10), 5, 2)).toBe(0);
  });
});

describe('the default transcriber', () => {
  it('is available and honestly returns nothing', async () => {
    await expect(nullTranscriber.available()).resolves.toBe(true);
    await expect(nullTranscriber.transcribe('anything.wav')).resolves.toBeNull();
  });
});

// Real --help output, trimmed to the lines that distinguish the two.
const OPENAI_HELP = `usage: whisper [-h] [--model MODEL] [--output_dir OUTPUT_DIR]
                [--output_format {txt,vtt,srt,tsv,json,all}]
  --output_dir OUTPUT_DIR, -o OUTPUT_DIR   directory to save the outputs`;

const WHISPER_CPP_HELP = `usage: whisper-cli [options] file0 file1 ...
  -otxt,     --output-txt           [false  ] output result in a text file
  -of FNAME, --output-file FNAME    [       ] output file path (without file extension)
  -m FNAME,  --model FNAME          [models/ggml-base.en.bin] model path`;

/**
 * The bug: whisper.cpp exits 0 on `--help` AND on an unknown argument, so a
 * probe that only asked "did --help succeed?" accepted it, then drove it with
 * openai-whisper's flags. It printed a usage dump, exited 0, wrote no file,
 * and the bake-off reported accuracy as "not measured" — after paying for the
 * renders it could no longer score.
 */
describe('telling the two whispers apart', () => {
  const originalPath = process.env.PATH;
  const originalModel = process.env.REFRAIN_WHISPER_MODEL;
  const made: string[] = [];

  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalModel === undefined) delete process.env.REFRAIN_WHISPER_MODEL;
    else process.env.REFRAIN_WHISPER_MODEL = originalModel;
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A stand-in for whisper.cpp: usage to stderr, exit 0, whatever the args. */
  function fakeWhisperCppOnPath(): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-fake-whisper-'));
    made.push(dir);
    const bin = path.join(dir, 'whisper-cli');
    fs.writeFileSync(bin, `#!/bin/sh\ncat >&2 <<'EOF'\n${WHISPER_CPP_HELP}\nEOF\nexit 0\n`);
    fs.chmodSync(bin, 0o755);
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ''}`;
  }

  it('reads each flavour off its own help text', () => {
    expect(whisperFlavour(OPENAI_HELP)).toBe('openai-whisper');
    expect(whisperFlavour(WHISPER_CPP_HELP)).toBe('whisper-cpp');
    expect(whisperFlavour('some other program entirely')).toBeNull();
  });

  it('never sends openai-whisper flags to whisper.cpp', () => {
    const cpp = whisperOutput('whisper-cpp', '/tmp/a.wav', '/tmp/out');
    expect(cpp.args).toContain('-otxt');
    expect(cpp.args.join(' ')).not.toContain('--output_format');
    expect(cpp.args.join(' ')).not.toContain('--output_dir');
    expect(cpp.transcript).toBe(path.join('/tmp/out', 'transcript.txt'));

    const openai = whisperOutput('openai-whisper', '/tmp/a.wav', '/tmp/out');
    expect(openai.args).toContain('--output_format');
    expect(openai.transcript).toBe(path.join('/tmp/out', 'a.txt'));
  });

  it('refuses a whisper.cpp with no model instead of reporting itself ready', async () => {
    fakeWhisperCppOnPath();
    delete process.env.REFRAIN_WHISPER_MODEL;

    await expect(whisperCliTranscriber.available()).resolves.toBe(false);
    await expect(whisperUnavailableReason()).resolves.toMatch(/REFRAIN_WHISPER_MODEL/);
  });

  it('refuses a model path that is not there', async () => {
    fakeWhisperCppOnPath();
    process.env.REFRAIN_WHISPER_MODEL = path.join(os.tmpdir(), 'no-such-ggml-model.bin');

    await expect(whisperCliTranscriber.available()).resolves.toBe(false);
    await expect(whisperUnavailableReason()).resolves.toMatch(/does not exist/);
  });

  it('reads the transcript an openai-whisper writes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-fake-whisper-'));
    made.push(dir);
    const bin = path.join(dir, 'whisper');
    // Answers --help like openai-whisper, and otherwise writes <stem>.txt into
    // the directory --output_dir names, which is the contract being relied on.
    fs.writeFileSync(
      bin,
      `#!/bin/sh
if [ "$1" = "--help" ]; then cat <<'EOF'
${OPENAI_HELP}
EOF
exit 0; fi
stem=$(basename "$1"); stem=\${stem%.*}
printf 'tyger tyger burning bright' > "$5/$stem.txt"
`,
    );
    fs.chmodSync(bin, 0o755);
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ''}`;

    await expect(whisperCliTranscriber.available()).resolves.toBe(true);
    await expect(whisperCliTranscriber.transcribe('/tmp/the-tyger.wav')).resolves.toBe(
      'tyger tyger burning bright',
    );
  });

  it('returns null rather than a transcript when the binary writes no file', async () => {
    fakeWhisperCppOnPath();
    const model = path.join(os.tmpdir(), `refrain-fake-model-${Date.now()}.bin`);
    fs.writeFileSync(model, 'not really a model');
    process.env.REFRAIN_WHISPER_MODEL = model;
    try {
      // available() is satisfied, but the binary still writes nothing. The
      // exit code says success; only the missing file tells the truth.
      await expect(whisperCliTranscriber.available()).resolves.toBe(true);
      await expect(whisperCliTranscriber.transcribe('/tmp/nope.wav')).resolves.toBeNull();
    } finally {
      fs.rmSync(model, { force: true });
    }
  });
});

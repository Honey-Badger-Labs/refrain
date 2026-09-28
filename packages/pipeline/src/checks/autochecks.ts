import type { AlignmentSpan } from '@refrain/catalogue';
import { peak, rms } from '../audio/wav.js';
import { diffWords, syllablesInLine, tokenise, sungForm, sameWhenSung } from '../text/words.js';

/**
 * Auto checks.
 *
 * These run before a human ever listens, and their whole job is to keep
 * reviewer time — the binding constraint — for judgements a machine cannot
 * make. A check that cannot run reports `skipped`, never `pass`.
 */

export type CheckStatus = 'pass' | 'fail' | 'skipped';

export interface CheckResult {
  id: string;
  status: CheckStatus;
  detail: string;
}

export interface CheckReport {
  results: CheckResult[];
  /** True only when every check that ran passed. */
  passed: boolean;
  /** True when at least one check could not run; the track needs a closer listen. */
  incomplete: boolean;
  wordAccuracy?: number;
}

export interface CheckInput {
  samples: Float32Array;
  sampleRate: number;
  lines: string[];
  alignment: AlignmentSpan[];
  /** Transcript of the rendered audio, or null when nothing could listen to it. */
  transcript: string | null;
  thresholds?: Partial<Thresholds>;
}

export interface Thresholds {
  /** Seconds per syllable that a render is expected to land between. */
  minSecondsPerSyllable: number;
  maxSecondsPerSyllable: number;
  /** A stretch quieter than this, for longer than maxSilenceSeconds, fails. */
  silenceRms: number;
  maxSilenceSeconds: number;
  /** Quiet before the first sound and after the last, judged separately. */
  maxLeadInSeconds: number;
  maxLeadOutSeconds: number;
  /** Sample magnitude at or above which a sample counts as clipped. */
  clipLevel: number;
  maxClippedSamples: number;
  /** Consecutive samples at the ceiling before it counts as flat-topped. */
  minClippedRun: number;
  /** How still a sample has to be, against its neighbour, to count as pinned. */
  flatEpsilon: number;
  minWordAccuracy: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minSecondsPerSyllable: 0.18,
  maxSecondsPerSyllable: 1.6,
  silenceRms: 0.004,
  maxSilenceSeconds: 2.5,
  maxLeadInSeconds: 3,
  maxLeadOutSeconds: 5,
  clipLevel: 0.999,
  maxClippedSamples: 8,
  // Three in a row at the ceiling is a flat top. One or two is a codec
  // reconstructing a peak slightly high, which normalising fixes.
  minClippedRun: 3,
  // A 16-bit step is 1/32768. Anything moving less than that between samples,
  // while at the ceiling, is not moving.
  flatEpsilon: 1 / 32768,
  minWordAccuracy: 0.99,
};

export function runChecks(input: CheckInput): CheckReport {
  const t = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const results: CheckResult[] = [
    checkDuration(input, t),
    checkSilence(input, t),
    checkClipping(input, t),
    checkAlignment(input),
  ];

  const accuracy = checkAccuracy(input, t);
  results.push(accuracy.result);

  return {
    results,
    passed: results.every((r) => r.status !== 'fail'),
    incomplete: results.some((r) => r.status === 'skipped'),
    ...(accuracy.wordAccuracy === undefined ? {} : { wordAccuracy: accuracy.wordAccuracy }),
  };
}

function checkDuration(input: CheckInput, t: Thresholds): CheckResult {
  const seconds = input.samples.length / input.sampleRate;
  const syllableCount = input.lines.reduce((sum, line) => sum + syllablesInLine(line), 0);
  if (syllableCount === 0) {
    return { id: 'duration', status: 'skipped', detail: 'no syllables to compare against' };
  }
  const perSyllable = seconds / syllableCount;
  const ok = perSyllable >= t.minSecondsPerSyllable && perSyllable <= t.maxSecondsPerSyllable;
  return {
    id: 'duration',
    status: ok ? 'pass' : 'fail',
    detail: `${seconds.toFixed(1)}s for ${syllableCount} syllables (${perSyllable.toFixed(2)}s each, expected ${t.minSecondsPerSyllable}–${t.maxSecondsPerSyllable})`,
  };
}

/**
 * Quiet at the head and the tail of a track is normal — a count-in, a chord
 * ringing out. Quiet in the middle is a dropped phrase. They are judged
 * separately, and against different limits, because they mean different things.
 */
function checkSilence(input: CheckInput, t: Thresholds): CheckResult {
  const windowSize = Math.max(1, Math.floor(0.05 * input.sampleRate));
  const windows: boolean[] = [];
  for (let start = 0; start < input.samples.length; start += windowSize) {
    windows.push(rms(input.samples, start, start + windowSize) >= t.silenceRms);
  }
  const seconds = (count: number) => (count * windowSize) / input.sampleRate;

  const first = windows.indexOf(true);
  if (first === -1) {
    return { id: 'silence', status: 'fail', detail: 'the whole track is silent' };
  }
  const last = windows.lastIndexOf(true);

  let worst = 0;
  let worstAt = 0;
  let run = 0;
  for (let i = first; i <= last; i++) {
    if (windows[i]) {
      run = 0;
      continue;
    }
    run++;
    if (run > worst) {
      worst = run;
      worstAt = seconds(i - run + 1);
    }
  }

  const leadIn = seconds(first);
  const leadOut = seconds(windows.length - 1 - last);
  const problems: string[] = [];
  if (leadIn > t.maxLeadInSeconds) problems.push(`${leadIn.toFixed(1)}s before the first sound`);
  if (leadOut > t.maxLeadOutSeconds) problems.push(`${leadOut.toFixed(1)}s of silence at the end`);
  if (seconds(worst) > t.maxSilenceSeconds) {
    problems.push(`a ${seconds(worst).toFixed(1)}s gap from ${worstAt.toFixed(1)}s`);
  }

  return {
    id: 'silence',
    status: problems.length === 0 ? 'pass' : 'fail',
    detail:
      problems.length === 0
        ? `lead-in ${leadIn.toFixed(1)}s, longest internal gap ${seconds(worst).toFixed(1)}s, lead-out ${leadOut.toFixed(1)}s`
        : problems.join('; '),
  };
}

/**
 * Clipping is a flat top, not a loud peak.
 *
 * Decoding a lossy file overshoots: reconstructing a waveform from MP3 puts
 * samples above the original's peak, routinely past 1.0, on audio that was
 * never clipped and sounds perfect once the level is brought down. Counting
 * every sample over the ceiling therefore fails good renders — it failed all
 * three of the first bake-off's, at peaks of 1.34, 1.15 and 1.12.
 *
 * Destroyed audio looks different: the waveform stops at the ceiling and stays
 * there, so the samples come in runs. Isolated overshoot is a level to fix;
 * a run is information that has already been lost. This counts the runs.
 */
function checkClipping(input: CheckInput, t: Thresholds): CheckResult {
  // Flat, not merely high. A smooth waveform peaking above the ceiling spends
  // several samples up there and every one of them differs from the last; a
  // clipped one stops dead and repeats the same value. The test is therefore
  // "at the ceiling AND not moving", which separates a level that needs
  // normalising from information that has already been thrown away.
  let flat = 0;
  let longest = 0;
  let run = 0;
  for (let i = 1; i < input.samples.length; i++) {
    const here = input.samples[i]!;
    const before = input.samples[i - 1]!;
    const pinned = Math.abs(here) >= t.clipLevel && Math.abs(here - before) < t.flatEpsilon;
    if (pinned) {
      run++;
      if (run > longest) longest = run;
    } else {
      if (run >= t.minClippedRun) flat += run;
      run = 0;
    }
  }
  if (run >= t.minClippedRun) flat += run;

  const top = peak(input.samples);
  const ok = flat <= t.maxClippedSamples;
  const note =
    ok && top > 1
      ? `, which is decoder overshoot rather than clipping — normalise before publishing`
      : '';
  return {
    id: 'clipping',
    status: ok ? 'pass' : 'fail',
    detail: `peak ${top.toFixed(3)}, ${flat} samples flat-topped, longest run ${longest}${note}`,
  };
}

function checkAlignment(input: CheckInput): CheckResult {
  if (input.alignment.length === 0) {
    return { id: 'alignment', status: 'skipped', detail: 'no alignment data' };
  }
  const seconds = input.samples.length / input.sampleRate;
  const problems: string[] = [];
  if (input.alignment.length !== input.lines.length) {
    problems.push(`${input.alignment.length} spans for ${input.lines.length} lines`);
  }
  let previousEnd = -Infinity;
  for (const span of input.alignment) {
    if (span.end <= span.start) problems.push(`line ${span.lineIndex} has no duration`);
    if (span.start < previousEnd) problems.push(`line ${span.lineIndex} overlaps the one before`);
    if (span.end > seconds + 0.25) problems.push(`line ${span.lineIndex} ends past the audio`);
    previousEnd = span.end;
  }
  return {
    id: 'alignment',
    status: problems.length === 0 ? 'pass' : 'fail',
    detail: problems.length === 0 ? `${input.alignment.length} spans in order` : problems.join('; '),
  };
}

function checkAccuracy(
  input: CheckInput,
  t: Thresholds,
): { result: CheckResult; wordAccuracy?: number } {
  if (input.transcript === null) {
    return {
      result: {
        id: 'accuracy',
        status: 'skipped',
        detail: 'no transcript: nothing listened to this render, so word accuracy is unknown',
      },
    };
  }
  const expected = tokenise(input.lines.join('\n'));
  const actual = tokenise(input.transcript);

  // Judged on what was sung, not on how it was spelled. A bake-off scored
  // 85.4% and was called unusable; the same audio, compared this way and
  // transcribed by a model worth the name, scored 96.9%. The gap was entirely
  // Blake's orthography and a weak transcriber, and a gate that cannot tell
  // those from a dropped word rejects good work.
  const diff = diffWords(expected.map(sungForm), actual.map(sungForm));
  const written = diffWords(expected, actual);
  const spelling = written.substituted.filter(([a, b]) => sameWhenSung(a, b));

  const ok = diff.accuracy >= t.minWordAccuracy;
  const problems: string[] = [];
  if (diff.deleted.length) problems.push(`dropped ${diff.deleted.slice(0, 6).join(', ')}`);
  if (diff.inserted.length) problems.push(`added ${diff.inserted.slice(0, 6).join(', ')}`);
  if (diff.substituted.length) {
    problems.push(
      `changed ${diff.substituted
        .slice(0, 6)
        .map(([a, b]) => `${a}→${b}`)
        .join(', ')}`,
    );
  }
  // Said out loud, because it is the difference between the two numbers and
  // the reason the strict one should not be quoted on its own.
  const aside = spelling.length
    ? ` (${spelling.length} spelling-only ${spelling.length === 1 ? 'difference' : 'differences'} not counted: ${spelling
        .slice(0, 4)
        .map(([a, b]) => `${a}/${b}`)
        .join(', ')})`
    : '';

  return {
    result: {
      id: 'accuracy',
      status: ok ? 'pass' : 'fail',
      detail: `${(diff.accuracy * 100).toFixed(1)}% of words matched${problems.length ? `: ${problems.join('; ')}` : ''}${aside}`,
    },
    wordAccuracy: diff.accuracy,
  };
}

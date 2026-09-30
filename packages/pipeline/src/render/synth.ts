import type { AlignmentSpan } from '@refrain/catalogue';
import { syllables, tokenise } from '../text/words.js';
import { makeRng, seedFrom, type Rng } from './random.js';
import { RenderError, type RenderAdapter, type RenderRequest, type RenderResult } from './types.js';

/**
 * The reference render adapter.
 *
 * It is an additive synthesiser, not a music model: it sets one note per
 * syllable over a style's chord progression and sings them on a vowel. Nothing
 * about the words is audible as speech, so it is labelled a placeholder
 * everywhere it appears and it is never presented as a finished render.
 *
 * It exists for three reasons that a silent fixture cannot serve. The app has
 * real audio to stream, seek, cache and normalise, so the player is exercised
 * end to end. The timings come out of the same pass that makes the notes, so
 * the synced-text view has true alignment data rather than guessed offsets.
 * And it costs nothing and needs no API key, so the whole pipeline runs in CI.
 *
 * A model-backed adapter implements the same interface and takes its place.
 *
 * Version 2 is a rewrite of what it plays rather than of how it is wired in.
 * Three things were wrong with version 1, in the order they were audible.
 *
 * The harmony did not line up with itself. The melody took its chord from the
 * line index and the accompaniment took its chord from a fixed bar grid, so
 * the two walked at different speeds: on a three-line chunk every single line
 * resolved onto a chord the pad was not playing. Chords now come from a plan
 * built once and read by both, so a phrase and its accompaniment cannot drift
 * apart by construction.
 *
 * The melody was a random walk. Each note stepped somewhere allowed rather
 * than somewhere wanted, which is why it wandered: no contour, no cadence,
 * nothing a listener could anticipate. A line is now shaped as an arch, chord
 * tones land on stressed syllables and passing notes fill between them, and
 * the seed varies the shape rather than generating it.
 *
 * And every syllable had the same length, which is what made it sound typed
 * rather than sung. Stress comes from the words themselves — a syllable that
 * begins a word is leant on, the rest are lighter.
 */

const SAMPLE_RATE = 44100;
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
/** How far the melody may roam, in scale degrees either side of the voice root. */
const LOW_DEGREE = -3;
const HIGH_DEGREE = 10;

type Accompaniment = 'pad' | 'pluck' | 'arpeggio' | 'drone';

export interface StyleShape {
  bpm: number;
  beatsPerSyllable: number;
  /** Scale degrees of the chord root, one per phrase. */
  progression: number[];
  accompaniment: Accompaniment;
  swing: number;
  lineGapBeats: number;
  reverbMix: number;
  /** Lowest and highest the arch reaches, in scale degrees. */
  contour: [number, number];
  /** How much the stressed syllables are leant on. 1 is flat. */
  lilt: number;
  accompanimentGain: number;
}

const STYLES: Record<string, StyleShape> = {
  hymn: {
    bpm: 82,
    beatsPerSyllable: 0.75,
    progression: [0, 3, 4, 0],
    accompaniment: 'pad',
    swing: 0,
    lineGapBeats: 1,
    reverbMix: 0.26,
    contour: [0, 4],
    lilt: 1.25,
    accompanimentGain: 0.34,
  },
  folk: {
    bpm: 112,
    beatsPerSyllable: 0.75,
    progression: [0, 4, 5, 3],
    accompaniment: 'pluck',
    swing: 0.12,
    lineGapBeats: 1,
    reverbMix: 0.14,
    contour: [-1, 5],
    lilt: 1.3,
    accompanimentGain: 0.32,
  },
  lullaby: {
    bpm: 62,
    beatsPerSyllable: 1,
    progression: [0, 5, 3, 4],
    accompaniment: 'arpeggio',
    swing: 0,
    lineGapBeats: 1.5,
    reverbMix: 0.34,
    contour: [0, 3],
    lilt: 1.15,
    accompanimentGain: 0.26,
  },
  chant: {
    // Plainsong: one chord, no pulse to speak of, the words carrying the shape.
    bpm: 58,
    beatsPerSyllable: 0.85,
    progression: [0],
    accompaniment: 'drone',
    swing: 0,
    lineGapBeats: 2,
    reverbMix: 0.42,
    contour: [0, 3],
    lilt: 1.1,
    accompanimentGain: 0.22,
  },
  carol: {
    bpm: 98,
    beatsPerSyllable: 0.7,
    progression: [0, 4, 5, 4],
    accompaniment: 'arpeggio',
    swing: 0.06,
    lineGapBeats: 1,
    reverbMix: 0.2,
    contour: [0, 5],
    lilt: 1.35,
    accompanimentGain: 0.3,
  },
};

interface VoiceShape {
  /** MIDI note of scale degree 0. */
  rootMidi: number;
  /**
   * Spectral tilt of the glottal source, as the exponent in 1/h^tilt. A real
   * glottal pulse falls off around 12 dB per octave, which is near 2; lower
   * values keep more edge in the source for the formants to work on.
   */
  tilt: number;
  vibratoHz: number;
  vibratoCents: number;
  /** Aspiration noise, mixed into the source before the formants, not after. */
  aspiration: number;
  /** The three formant centres that make this voice the vowel it is. */
  formants: [number, number, number];
  /** Q of each formant. Higher is a narrower, more vocal resonance. */
  formantQ: [number, number, number];
}

const VOICES: Record<string, VoiceShape> = {
  alto: {
    rootMidi: 57,
    tilt: 1.9,
    vibratoHz: 5.0,
    vibratoCents: 16,
    aspiration: 0.05,
    formants: [700, 1180, 2600],
    formantQ: [7.5, 10, 12],
  },
  treble: {
    rootMidi: 69,
    tilt: 1.75,
    vibratoHz: 5.6,
    vibratoCents: 20,
    aspiration: 0.04,
    formants: [840, 1560, 2900],
    formantQ: [8, 11, 13],
  },
  tenor: {
    rootMidi: 50,
    tilt: 2.0,
    vibratoHz: 4.7,
    vibratoCents: 14,
    aspiration: 0.055,
    formants: [620, 1100, 2400],
    formantQ: [7, 9.5, 11],
  },
  soprano: {
    rootMidi: 72,
    tilt: 1.65,
    vibratoHz: 5.9,
    vibratoCents: 24,
    aspiration: 0.035,
    formants: [900, 1700, 3100],
    formantQ: [8.5, 12, 14],
  },
};

export interface SynthParams {
  /** Multiplies the style tempo, for a slower or brisker take. */
  tempoScale?: number;
  gain?: number;
}

interface Note {
  midi: number;
  start: number;
  duration: number;
  velocity: number;
  /** Stressed notes get a firmer attack; unstressed ones stay soft. */
  stressed: boolean;
}

/** One line's worth of music: when it runs, and what chord is under it. */
interface Phrase {
  start: number;
  end: number;
  chordRoot: number;
}

export const synthAdapter: RenderAdapter = {
  name: 'synth',
  description:
    'Deterministic additive synthesiser. Produces listenable placeholder audio and exact line timings with no model, no key and no cost.',
  async render(request: RenderRequest): Promise<RenderResult> {
    return renderSynth(request);
  },
};

export function renderSynth(request: RenderRequest): RenderResult {
  const { chunk, preset, lines, seed } = request;
  const sampleRate = request.sampleRate || SAMPLE_RATE;
  const style = STYLES[preset.styleId];
  const voice = VOICES[preset.voiceId];
  if (!style) {
    throw new RenderError(
      `the synth adapter has no shape for style ${preset.styleId}; known: ${Object.keys(STYLES).join(', ')}`,
    );
  }
  if (!voice) {
    throw new RenderError(
      `the synth adapter has no shape for voice ${preset.voiceId}; known: ${Object.keys(VOICES).join(', ')}`,
    );
  }
  if (lines.length === 0) throw new RenderError(`chunk ${chunk.id} has no lines to sing`);

  const params = (preset.params ?? {}) as SynthParams;
  const tempoScale = clamp(params.tempoScale ?? 1, 0.5, 2);
  const beat = 60 / (style.bpm * tempoScale);
  const rng = makeRng(seedFrom(chunk.id, preset.id, seed));

  // Two beats of accompaniment before the first sung note: enough to set the
  // key, short enough that a listener who pressed play hears something at once.
  const intro = beat * 2;
  const notes: Note[] = [];
  const phrases: Phrase[] = [];
  const alignment: AlignmentSpan[] = [];
  let cursor = intro;

  lines.forEach((line, lineIndex) => {
    const stress = stressPattern(line);
    const count = stress.length;
    const chordRoot = style.progression[lineIndex % style.progression.length]!;
    const lineStart = cursor;

    // A tilt per line so successive phrases are not the same arch twice, and
    // so a different seed gives a different reading of the same chunk.
    const tilt = rng.range(-0.6, 0.9);
    const degrees = shapeLine(count, chordRoot, style, tilt, rng);

    for (let i = 0; i < count; i++) {
      const last = i === count - 1;
      const stressed = stress[i]!;
      const swing = style.swing > 0 && i % 2 === 1 ? style.swing : 0;
      const weight = stressed ? style.lilt : 2 - style.lilt;
      const duration = beat * style.beatsPerSyllable * (last ? 2.1 : weight + swing);
      notes.push({
        midi: voice.rootMidi + scaleToSemitone(degrees[i]!),
        start: cursor,
        duration,
        velocity: last ? 0.88 : stressed ? rng.range(0.84, 0.95) : rng.range(0.66, 0.78),
        stressed,
      });
      cursor += duration;
    }

    alignment.push({ lineIndex, start: round(lineStart), end: round(cursor) });
    phrases.push({ start: lineStart, end: cursor, chordRoot });
    cursor += beat * style.lineGapBeats;
  });

  const outro = beat * 3;
  const totalSeconds = cursor + outro;
  const length = Math.ceil(totalSeconds * sampleRate);
  const melody = new Float32Array(length);
  const backing = new Float32Array(length);

  for (const note of notes) {
    renderVoiceNote(melody, note, voice, sampleRate, rng);
  }
  renderAccompaniment(backing, phrases, style, voice, beat, cursor + outro, sampleRate, rng);

  const mixed = new Float32Array(length);
  const backingGain = style.accompanimentGain;
  for (let i = 0; i < length; i++) {
    mixed[i] = melody[i]! * 0.82 + backing[i]! * backingGain;
  }
  const wet = reverb(mixed, sampleRate, style.reverbMix);
  normalise(wet, (params.gain ?? 1) * 0.89);

  return {
    samples: wet,
    sampleRate,
    alignment,
    performed: [...lines],
    modelId: 'refrain-synth',
    modelVersion: '3',
    modelTerms: { commercialUse: true, version: 'in-repo', checkedOn: '2026-09-30' },
  };
}

/**
 * Which syllables carry the stress.
 *
 * English puts a beat on the first syllable of most short words, and the
 * pipeline already knows where words begin and how many syllables each has.
 * Leaning on those and lightening the rest is the cheapest thing that makes a
 * line sound spoken rather than counted out.
 */
export function stressPattern(line: string): boolean[] {
  const pattern: boolean[] = [];
  for (const word of tokenise(line)) {
    const count = Math.max(1, syllables(word));
    for (let i = 0; i < count; i++) pattern.push(i === 0);
  }
  return pattern.length > 0 ? pattern : [true];
}

/**
 * The shape of one line: an arch that starts near the chord, rises, and comes
 * home to a chord tone.
 *
 * Stressed syllables take chord tones so the harmony is stated by the melody
 * rather than only by the accompaniment under it; the syllables between them
 * take whatever scale degree the arch asks for, which is what makes them read
 * as passing notes rather than as leaps.
 */
export function shapeLine(
  count: number,
  chordRoot: number,
  style: StyleShape,
  tilt: number,
  rng: Rng,
): number[] {
  const [low, high] = style.contour;
  const tones = [chordRoot, chordRoot + 2, chordRoot + 4, chordRoot + 7];
  const degrees: number[] = [];
  let previous = chordRoot;

  for (let i = 0; i < count; i++) {
    const position = count > 1 ? i / (count - 1) : 0;
    const arch = low + (high - low) * Math.sin(Math.PI * position);
    const target = arch + tilt;
    const last = i === count - 1;

    let degree: number;
    if (last) {
      // Come to rest on the chord, and prefer to arrive from above: a falling
      // cadence is what makes a phrase sound finished.
      degree = nearest(tones, Math.min(target, previous));
    } else if (i === 0) {
      degree = nearest(tones, target);
    } else {
      const wanted = Math.round(target);
      // Keep it singable: no leap wider than a fourth between syllables.
      const bounded = clamp(wanted, previous - 3, previous + 3);
      degree = i % 2 === 0 ? nearest(tones, bounded) : bounded;
      if (degree === previous && rng.next() < 0.4) degree = previous + (rng.next() < 0.5 ? 1 : -1);
    }

    degree = clamp(degree, LOW_DEGREE, HIGH_DEGREE);
    degrees.push(degree);
    previous = degree;
  }
  return degrees;
}

function nearest(candidates: number[], target: number): number {
  let best = candidates[0]!;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * How the accompaniment spaces a chord, in MIDI notes.
 *
 * Open, not a close triad. A third stacked straight on the root down here puts
 * two partials about 29 Hz apart at around 110 Hz, which is the middle of the
 * critical band at that pitch and so the point of maximum roughness — the
 * reason this accompaniment sounded gritty however clean the notes were. Root
 * and fifth stay low and the third goes up an octave, which is what a keyboard
 * player does without being asked.
 */
export function accompanimentVoicing(chordRoot: number, root: number): number[] {
  return [
    root + scaleToSemitone(chordRoot),
    root + scaleToSemitone(chordRoot + 4),
    root + scaleToSemitone(chordRoot + 2) + 12,
  ];
}

/** Scale degrees may run past an octave in either direction. */
function scaleToSemitone(degree: number): number {
  const octave = Math.floor(degree / 7);
  const index = ((degree % 7) + 7) % 7;
  return octave * 12 + MAJOR_SCALE[index]!;
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * A two-pole bandpass, the resonance that makes a formant a formant.
 *
 * Version 2 scaled harmonic amplitudes by a bell curve and called that a
 * formant. It is not one: a resonance rings, and the ringing is most of what
 * the ear uses to hear a vowel rather than an organ stop. Filtering a source
 * gives that for free, and gives it on the transients too, where a static
 * amplitude table has nothing to say.
 */
interface Biquad {
  b0: number;
  b2: number;
  a1: number;
  a2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

function bandpass(freq: number, q: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b2: -alpha / a0,
    a1: (-2 * Math.cos(w0)) / a0,
    a2: (1 - alpha) / a0,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
}

function biquad(f: Biquad, x: number): number {
  const y = f.b0 * x + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1;
  f.x1 = x;
  f.y2 = f.y1;
  f.y1 = y;
  return y;
}

function renderVoiceNote(
  out: Float32Array,
  note: Note,
  voice: VoiceShape,
  sampleRate: number,
  rng: Rng,
): void {
  const start = Math.floor(note.start * sampleRate);
  // A little longer than its slot so the tail of one note is still sounding
  // under the attack of the next. Without the overlap every syllable is an
  // island and the line reads as separate events rather than a phrase.
  const sung = note.duration * 1.12;
  const length = Math.floor(sung * sampleRate);
  if (length <= 0) return;
  const freq = midiToHz(note.midi);
  const vibratoPhase = rng.range(0, Math.PI * 2);
  const attack = Math.min(note.stressed ? 0.035 : 0.07, sung * 0.3);
  const release = Math.min(0.2, sung * 0.45);
  // Singers arrive at a pitch rather than starting on it.
  const scoop = note.stressed ? 0.018 : 0.03;

  // The source: a glottal pulse train, built from harmonics so it is band
  // limited by construction and cannot alias. The ceiling accounts for the
  // vibrato and the scoop, which both push a partial upward after this table
  // is built.
  const ceiling = sampleRate * 0.45 * 0.97;
  const amps: number[] = [];
  const phases: number[] = [];
  for (let h = 1; freq * h < ceiling; h++) {
    amps.push(1 / Math.pow(h, voice.tilt));
    // Starting every partial at zero phase stacks them into a single spike at
    // the onset, which is heard as a click and as a hard, electronic edge on
    // the whole note. Scattering them costs nothing and is still deterministic.
    phases.push(rng.range(0, Math.PI * 2));
    if (amps.length >= 48) break;
  }
  const ampSum = amps.reduce((a, b) => a + b, 0) || 1;

  const filters = [
    bandpass(voice.formants[0], voice.formantQ[0], sampleRate),
    bandpass(voice.formants[1], voice.formantQ[1], sampleRate),
    bandpass(voice.formants[2], voice.formantQ[2], sampleRate),
  ];
  const formantGains = [1, 0.5, 0.22];

  let aspirationState = 0;
  for (let i = 0; i < length; i++) {
    const index = start + i;
    if (index >= out.length) break;
    const t = i / sampleRate;
    const env = envelope(t, sung, attack, release);
    if (env <= 0) continue;
    const bend = t < scoop ? 1 - 0.028 * (1 - t / scoop) : 1;
    const vibrato =
      1 +
      (voice.vibratoCents / 1200) *
        Math.sin(2 * Math.PI * voice.vibratoHz * t + vibratoPhase) *
        Math.min(1, t / 0.25);
    const ratio = bend * vibrato;

    let source = 0;
    for (let h = 0; h < amps.length; h++) {
      source += amps[h]! * Math.sin(2 * Math.PI * freq * (h + 1) * ratio * t + phases[h]!);
    }
    source /= ampSum;
    if (voice.aspiration > 0) {
      aspirationState = aspirationState * 0.86 + (rng.next() * 2 - 1) * 0.14;
      source += aspirationState * voice.aspiration;
    }

    let sample = 0;
    for (let f = 0; f < filters.length; f++) {
      sample += formantGains[f]! * biquad(filters[f]!, source);
    }
    out[index] = out[index]! + sample * env * note.velocity;
  }
}

/**
 * Raised cosine in and out rather than a straight line: a linear ramp through
 * zero is a corner, and a corner at this amplitude is an audible click at the
 * start of every syllable.
 */
function envelope(t: number, duration: number, attack: number, release: number): number {
  if (t < 0 || t > duration) return 0;
  if (t < attack) return 0.5 - 0.5 * Math.cos(Math.PI * (t / attack));
  const releaseStart = duration - release;
  if (t > releaseStart) {
    const x = (duration - t) / release;
    return 0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1));
  }
  return 1 - 0.18 * Math.min(1, (t - attack) / Math.max(0.001, duration - attack));
}

/**
 * The accompaniment follows the phrases, not a metronome.
 *
 * This is the fix for version 1's central fault: chords were placed on a fixed
 * bar grid while the melody took its chord from the line, so the two drifted
 * and lines resolved against the wrong triad. Both now read the same plan.
 */
function renderAccompaniment(
  out: Float32Array,
  phrases: Phrase[],
  style: StyleShape,
  voice: VoiceShape,
  beat: number,
  end: number,
  sampleRate: number,
  rng: Rng,
): void {
  const root = voice.rootMidi - 12;
  const first = phrases[0]!;

  const triadOf = (chordRoot: number): number[] => accompanimentVoicing(chordRoot, root);

  if (style.accompaniment === 'drone') {
    // One chord under the whole thing: root and fifth, the way a drone works.
    const fifth = root + scaleToSemitone(first.chordRoot + 4);
    renderSoftTone(out, root + scaleToSemitone(first.chordRoot), 0, end, sampleRate, 0.3);
    renderSoftTone(out, fifth, 0, end, sampleRate, 0.2);
    return;
  }

  // The intro states the chord the first line will resolve to.
  const spans: Phrase[] = [
    { start: 0, end: first.start, chordRoot: first.chordRoot },
    ...phrases.map((phrase, i) => ({
      start: phrase.start,
      // Hold each chord through the gap until the next line starts.
      end: i === phrases.length - 1 ? end : phrases[i + 1]!.start,
      chordRoot: phrase.chordRoot,
    })),
  ];
  for (const span of spans) {
    const duration = span.end - span.start;
    if (duration <= 0) continue;
    const triad = triadOf(span.chordRoot);

    if (style.accompaniment === 'pad') {
      for (const midi of triad) {
        renderSoftTone(out, midi, span.start, duration * 0.99, sampleRate, 0.22);
      }
      continue;
    }

    const step = style.accompaniment === 'arpeggio' ? beat * 0.5 : beat;
    const pattern = style.accompaniment === 'arpeggio' ? [0, 1, 2, 1] : [0, 2, 1, 2];
    let i = 0;
    for (let t = span.start; t < span.end; t += step, i++) {
      const midi = triad[pattern[i % pattern.length]!]!;
      const gain = style.accompaniment === 'arpeggio' ? 0.22 : 0.3;
      renderPluck(out, midi, t, Math.min(step * 1.6, span.end - t), sampleRate, gain, rng);
    }
  }
}

function renderSoftTone(
  out: Float32Array,
  midi: number,
  start: number,
  duration: number,
  sampleRate: number,
  gain: number,
): void {
  const freq = midiToHz(midi);
  const from = Math.floor(start * sampleRate);
  const length = Math.floor(duration * sampleRate);
  const attack = Math.min(0.5, duration * 0.35);
  const release = Math.min(0.6, duration * 0.45);
  for (let i = 0; i < length; i++) {
    const index = from + i;
    if (index < 0) continue;
    if (index >= out.length) break;
    const t = i / sampleRate;
    const env = envelope(t, duration, attack, release);
    const sample =
      Math.sin(2 * Math.PI * freq * t) * 0.6 +
      Math.sin(2 * Math.PI * freq * 2 * t) * 0.22 +
      Math.sin(2 * Math.PI * freq * 3 * t) * 0.09;
    out[index] = out[index]! + sample * env * gain;
  }
}

function renderPluck(
  out: Float32Array,
  midi: number,
  start: number,
  duration: number,
  sampleRate: number,
  gain: number,
  rng: Rng,
): void {
  const freq = midiToHz(midi);
  const from = Math.floor(start * sampleRate);
  const length = Math.floor(duration * sampleRate);
  const phase = rng.range(0, Math.PI * 2);
  for (let i = 0; i < length; i++) {
    const index = from + i;
    if (index < 0) continue;
    if (index >= out.length) break;
    const t = i / sampleRate;
    const env = Math.exp(-t * 5) * Math.min(1, t / 0.006);
    const sample =
      Math.sin(2 * Math.PI * freq * t + phase) * 0.7 +
      Math.sin(2 * Math.PI * freq * 2.01 * t) * 0.2 +
      Math.sin(2 * Math.PI * freq * 3.02 * t) * 0.08;
    out[index] = out[index]! + sample * env * gain;
  }
}

/** Three combs into one allpass: the cheapest thing that sounds like a room. */
function reverb(input: Float32Array, sampleRate: number, mix: number): Float32Array {
  if (mix <= 0) return input;
  const out = new Float32Array(input.length);
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((seconds) => ({
    buffer: new Float32Array(Math.max(1, Math.floor(seconds * sampleRate))),
    index: 0,
    feedback: 0.76,
    // A room absorbs treble faster than bass. An undamped comb does not, so it
    // returns the high partials over and over and the tail turns metallic.
    damp: 0,
  }));
  const allpassDelay = Math.max(1, Math.floor(0.005 * sampleRate));
  const allpass = new Float32Array(allpassDelay);
  let allpassIndex = 0;

  for (let i = 0; i < input.length; i++) {
    const dry = input[i]!;
    let wet = 0;
    for (const comb of combs) {
      const delayed = comb.buffer[comb.index]!;
      wet += delayed;
      comb.damp = comb.damp * 0.34 + delayed * 0.66;
      comb.buffer[comb.index] = dry + comb.damp * comb.feedback;
      comb.index = (comb.index + 1) % comb.buffer.length;
    }
    wet /= combs.length;
    const delayed = allpass[allpassIndex]!;
    const value = -0.6 * wet + delayed;
    allpass[allpassIndex] = wet + 0.6 * value;
    allpassIndex = (allpassIndex + 1) % allpass.length;
    out[i] = dry * (1 - mix) + value * mix;
  }
  return out;
}

function normalise(samples: Float32Array, target: number): void {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]!);
    if (v > peak) peak = v;
  }
  if (peak === 0) return;
  const gain = target / peak;
  for (let i = 0; i < samples.length; i++) samples[i] = samples[i]! * gain;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

export function styleShape(id: string): StyleShape | undefined {
  return STYLES[id];
}

export const SYNTH_STYLES = Object.keys(STYLES);
export const SYNTH_VOICES = Object.keys(VOICES);

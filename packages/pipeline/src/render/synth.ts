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
 */

const SAMPLE_RATE = 44100;
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;

interface StyleShape {
  bpm: number;
  beatsPerSyllable: number;
  /** Scale degrees of the chord root, one per phrase. */
  progression: number[];
  /** Melodic steps the style favours, in scale degrees. */
  steps: number[];
  accompaniment: 'pad' | 'pluck';
  swing: number;
  lineGapBeats: number;
  reverbMix: number;
}

const STYLES: Record<string, StyleShape> = {
  hymn: {
    bpm: 82,
    beatsPerSyllable: 0.75,
    progression: [0, 3, 4, 0],
    steps: [-2, -1, -1, 0, 1, 1, 2],
    accompaniment: 'pad',
    swing: 0,
    lineGapBeats: 1,
    reverbMix: 0.26,
  },
  folk: {
    bpm: 112,
    beatsPerSyllable: 0.75,
    progression: [0, 4, 5, 3],
    steps: [-3, -2, -1, 0, 1, 2, 3],
    accompaniment: 'pluck',
    swing: 0.12,
    lineGapBeats: 1,
    reverbMix: 0.14,
  },
};

interface VoiceShape {
  /** MIDI note of scale degree 0. */
  rootMidi: number;
  harmonics: number;
  brightness: number;
  vibratoHz: number;
  vibratoCents: number;
  breath: number;
  /** Rough formant centres, which give the tone a vowel-ish colour. */
  formants: [number, number];
}

const VOICES: Record<string, VoiceShape> = {
  alto: {
    rootMidi: 57,
    harmonics: 14,
    brightness: 1.5,
    vibratoHz: 5.0,
    vibratoCents: 18,
    breath: 0.012,
    formants: [700, 1180],
  },
  treble: {
    rootMidi: 69,
    harmonics: 11,
    brightness: 1.9,
    vibratoHz: 5.6,
    vibratoCents: 22,
    breath: 0.008,
    formants: [840, 1560],
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
  const alignment: AlignmentSpan[] = [];
  let cursor = intro;
  let degree = rng.pick([0, 2, 4]);

  lines.forEach((line, lineIndex) => {
    const counts = tokenise(line).map((w) => syllables(w));
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const lineStart = cursor;
    const chordRoot = style.progression[lineIndex % style.progression.length]!;

    for (let i = 0; i < total; i++) {
      const last = i === total - 1;
      degree = nextDegree(degree, chordRoot, last, style, rng);
      const swing = style.swing > 0 && i % 2 === 1 ? style.swing : 0;
      const duration = beat * style.beatsPerSyllable * (last ? 1.9 : 1 + swing);
      notes.push({
        midi: voice.rootMidi + scaleToSemitone(degree),
        start: cursor,
        duration,
        velocity: last ? 0.9 : rng.range(0.72, 0.95),
      });
      cursor += duration;
    }

    alignment.push({
      lineIndex,
      start: round(lineStart),
      end: round(cursor),
    });
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
  renderAccompaniment(backing, notes, style, voice, beat, cursor + outro * 0.5, sampleRate, rng);

  const mixed = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    mixed[i] = melody[i]! * 0.82 + backing[i]! * 0.34;
  }
  const wet = reverb(mixed, sampleRate, style.reverbMix);
  normalise(wet, (params.gain ?? 1) * 0.89);

  return {
    samples: wet,
    sampleRate,
    alignment,
    performed: [...lines],
    modelId: 'refrain-synth',
    modelVersion: '1',
    modelTerms: { commercialUse: true, version: 'in-repo', checkedOn: '2026-09-19' },
  };
}

function nextDegree(
  current: number,
  chordRoot: number,
  resolve: boolean,
  style: StyleShape,
  rng: Rng,
): number {
  if (resolve) {
    // End a line on a chord tone so phrases sound finished rather than cut off.
    const tones = [chordRoot, chordRoot + 2, chordRoot + 4];
    let best = tones[0]!;
    let bestDistance = Infinity;
    for (const tone of tones) {
      const distance = Math.abs(tone - current);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = tone;
      }
    }
    return clamp(best, -2, 9);
  }
  const step = rng.pick(style.steps);
  let next = current + step;
  if (next > 9) next = 9 - (next - 9);
  if (next < -2) next = -2 + (-2 - next);
  return clamp(next, -2, 9);
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

function renderVoiceNote(
  out: Float32Array,
  note: Note,
  voice: VoiceShape,
  sampleRate: number,
  rng: Rng,
): void {
  const start = Math.floor(note.start * sampleRate);
  const length = Math.floor(note.duration * sampleRate);
  if (length <= 0) return;
  const freq = midiToHz(note.midi);
  const vibratoPhase = rng.range(0, Math.PI * 2);
  const attack = Math.min(0.06, note.duration * 0.25);
  const release = Math.min(0.14, note.duration * 0.4);

  // Harmonic amplitudes, shaped by two broad formant bumps. Cheap, but it is
  // the difference between a voice-ish tone and an organ.
  const amps: number[] = [];
  for (let h = 1; h <= voice.harmonics; h++) {
    const partial = freq * h;
    if (partial > sampleRate * 0.45) break;
    const rolloff = 1 / Math.pow(h, voice.brightness);
    const shape =
      formantGain(partial, voice.formants[0], 180) * 1.0 +
      formantGain(partial, voice.formants[1], 260) * 0.7 +
      0.18;
    amps.push(rolloff * shape);
  }
  const ampSum = amps.reduce((a, b) => a + b, 0) || 1;

  for (let i = 0; i < length; i++) {
    const index = start + i;
    if (index >= out.length) break;
    const t = i / sampleRate;
    const env = envelope(t, note.duration, attack, release);
    if (env <= 0) continue;
    const vibrato =
      1 +
      (voice.vibratoCents / 1200) *
        Math.sin(2 * Math.PI * voice.vibratoHz * t + vibratoPhase) *
        Math.min(1, t / 0.25);
    let sample = 0;
    for (let h = 0; h < amps.length; h++) {
      sample += amps[h]! * Math.sin(2 * Math.PI * freq * (h + 1) * vibrato * t);
    }
    sample /= ampSum;
    if (voice.breath > 0) sample += (rng.next() * 2 - 1) * voice.breath * env;
    out[index] = out[index]! + sample * env * note.velocity;
  }
}

function formantGain(freq: number, centre: number, width: number): number {
  const x = (freq - centre) / width;
  return Math.exp(-0.5 * x * x);
}

function envelope(t: number, duration: number, attack: number, release: number): number {
  if (t < 0 || t > duration) return 0;
  if (t < attack) return t / attack;
  const releaseStart = duration - release;
  if (t > releaseStart) return Math.max(0, (duration - t) / release);
  const decayed = 1 - 0.18 * Math.min(1, (t - attack) / Math.max(0.001, duration - attack));
  return decayed;
}

function renderAccompaniment(
  out: Float32Array,
  notes: Note[],
  style: StyleShape,
  voice: VoiceShape,
  beat: number,
  to: number,
  sampleRate: number,
  rng: Rng,
): void {
  const barBeats = style.accompaniment === 'pad' ? 3 : 4;
  const barLength = beat * barBeats;
  const root = voice.rootMidi - 12;
  let bar = 0;
  for (let t = 0; t < to; t += barLength) {
    const chordRoot = style.progression[bar % style.progression.length]!;
    const triad = [chordRoot, chordRoot + 2, chordRoot + 4].map(
      (d) => root + scaleToSemitone(d),
    );
    if (style.accompaniment === 'pad') {
      for (const midi of triad) {
        renderSoftTone(out, midi, t, barLength * 0.98, sampleRate, 0.22);
      }
    } else {
      const pattern = [0, 2, 1, 2];
      for (let i = 0; i < barBeats; i++) {
        const midi = triad[pattern[i % pattern.length]!]!;
        renderPluck(out, midi, t + i * beat, beat * 0.9, sampleRate, 0.3, rng);
      }
    }
    bar++;
  }
  void notes;
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
    const env = Math.exp(-t * 6) * Math.min(1, t / 0.004);
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
      comb.buffer[comb.index] = dry + delayed * comb.feedback;
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

export const SYNTH_STYLES = Object.keys(STYLES);
export const SYNTH_VOICES = Object.keys(VOICES);

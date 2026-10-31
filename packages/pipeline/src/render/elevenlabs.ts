import { decodeToSamples } from '../audio/decode.js';
import type { RenderAdapter, RenderRequest, RenderResult } from './types.js';
import { RenderError } from './types.js';

/**
 * ElevenLabs Music render adapter.
 *
 * Unlike the generic HTTP config, this sends a composition plan so the lyrics
 * are given to the model line by line instead of buried in a prompt. That is
 * the best lever available on word accuracy, which is the bake-off question.
 *
 * Keys: read from an environment variable by name and never logged, written
 * or echoed. Alignment: the model returns no timings, so `alignment` is left
 * empty and the alignment check fails until a real aligner runs — an invented
 * alignment would silently pass. Terms: commercialUse stays false until the
 * terms review records otherwise.
 */
export const ELEVENLABS_MUSIC_URL = 'https://api.elevenlabs.io/v1/music';
export const MAX_SECTION_MS = 120_000;
export const MIN_SECTION_MS = 3_000;

export interface ElevenLabsOptions {
  apiKeyEnv?: string;
  workDir: string;
  /** Milliseconds of music per line of text, clamped per section. */
  msPerLine?: number;
  linesPerSection?: number;
  fetchImpl?: typeof fetch;
  styleHints?: Record<string, string>;
}

export interface CompositionSection {
  section_name: string;
  positive_local_styles: string[];
  negative_local_styles: string[];
  duration_ms: number;
  lines: string[];
}

export interface CompositionPlan {
  positive_global_styles: string[];
  negative_global_styles: string[];
  sections: CompositionSection[];
}

const DEFAULT_STYLES: Record<string, string> = {
  hymn: 'slow hymn in 3/4, sustained organ-like chords, stepwise melody',
  folk: 'acoustic folk in 4/4, plucked guitar, warm and brisk',
  lullaby: 'very slow lullaby, rocking arpeggio, soft and intimate',
  chant: 'plainsong chant over a held drone, free rhythm',
  carol: 'bright carol, arpeggiated accompaniment, wide melodic arch',
};

export function buildCompositionPlan(
  request: Pick<RenderRequest, 'lines' | 'preset'>,
  options: Pick<ElevenLabsOptions, 'msPerLine' | 'linesPerSection' | 'styleHints'> = {},
): CompositionPlan {
  const lines = request.lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) throw new RenderError('nothing to sing: no lines');
  const per = options.linesPerSection ?? 4;
  const msPerLine = options.msPerLine ?? 4_000;
  const styles = { ...DEFAULT_STYLES, ...(options.styleHints ?? {}) };
  const style = styles[request.preset.styleId] ?? request.preset.styleId;
  const sections: CompositionSection[] = [];
  for (let i = 0; i < lines.length; i += per) {
    const slice = lines.slice(i, i + per);
    const duration = Math.min(MAX_SECTION_MS, Math.max(MIN_SECTION_MS, slice.length * msPerLine));
    sections.push({
      section_name: `Verse ${sections.length + 1}`,
      positive_local_styles: ['clear sung vocal', 'every word intelligible'],
      negative_local_styles: ['ad libs', 'repeated lines'],
      duration_ms: duration,
      lines: slice,
    });
  }
  return {
    positive_global_styles: [style, `${request.preset.voiceId} voice`],
    negative_global_styles: ['spoken word', 'rap', 'distortion'],
    sections,
  };
}

export function createElevenLabsAdapter(options: ElevenLabsOptions): RenderAdapter {
  const envName = options.apiKeyEnv ?? 'ELEVENLABS_API_KEY';
  const doFetch = options.fetchImpl ?? fetch;
  return {
    name: 'elevenlabs-music-plan',
    description: 'ElevenLabs Music with a lyric composition plan. Not reproducible: no seed.',
    async render(request): Promise<RenderResult> {
      const apiKey = process.env[envName];
      if (!apiKey) throw new RenderError(`${envName} is not set`);
      const plan = buildCompositionPlan(request, options);
      const response = await doFetch(`${ELEVENLABS_MUSIC_URL}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ composition_plan: plan, model_id: 'music_v1' }),
      });
      if (!response.ok) {
        // Never include request headers in an error: they carry the key.
        const text = (await response.text()).slice(0, 300);
        throw new RenderError(`elevenlabs music answered ${response.status}: ${text}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { samples, sampleRate } = await decodeToSamples(bytes, options.workDir, request.sampleRate);
      return {
        samples,
        sampleRate,
        alignment: [],
        performed: plan.sections.flatMap((s) => s.lines),
        modelId: 'music_v1',
        modelVersion: response.headers.get('song-id') ?? undefined,
        modelTerms: { url: 'https://elevenlabs.io/terms-of-use', commercialUse: false },
      };
    },
  };
}

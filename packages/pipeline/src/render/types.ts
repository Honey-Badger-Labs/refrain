import type { AlignmentSpan, Chunk, Preset } from '@refrain/catalogue';

export interface RenderRequest {
  chunk: Chunk;
  preset: Preset;
  /** Prepared lines. May be re-broken from the chunk, never re-worded. */
  lines: string[];
  seed: number;
  sampleRate: number;
}

export interface RenderResult {
  samples: Float32Array;
  sampleRate: number;
  alignment: AlignmentSpan[];
  /**
   * What the adapter believes it performed, line by line. The accuracy check
   * compares a transcript of the audio against this, not against the adapter's
   * word, so an adapter cannot mark its own homework.
   */
  performed: string[];
  modelId?: string;
  modelVersion?: string;
  modelTerms?: {
    url?: string;
    version?: string;
    checkedOn?: string;
    commercialUse: boolean;
  };
}

export interface RenderAdapter {
  readonly name: string;
  readonly description: string;
  render(request: RenderRequest): Promise<RenderResult>;
}

export class RenderError extends Error {}

const adapters = new Map<string, RenderAdapter>();

export function registerAdapter(adapter: RenderAdapter): void {
  adapters.set(adapter.name, adapter);
}

export function getAdapter(name: string): RenderAdapter {
  const adapter = adapters.get(name);
  if (!adapter) {
    throw new RenderError(
      `no render adapter named ${name}. Registered: ${[...adapters.keys()].join(', ') || 'none'}`,
    );
  }
  return adapter;
}

export function listAdapters(): RenderAdapter[] {
  return [...adapters.values()];
}

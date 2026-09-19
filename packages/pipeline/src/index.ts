import { registerAdapter } from './render/types.js';
import { synthAdapter } from './render/synth.js';

registerAdapter(synthAdapter);

export * from './paths.js';
export * from './store.js';
export * from './text/words.js';
export * from './text/ingest.js';
export * from './text/lyricprep.js';
export * from './audio/wav.js';
export * from './audio/encode.js';
export * from './render/types.js';
export * from './render/random.js';
export * from './render/synth.js';
export * from './checks/autochecks.js';
export * from './checks/transcribe.js';
export * from './commands/ingest.js';
export * from './commands/render.js';
export * from './commands/review.js';
export * from './commands/publish.js';
export * from './commands/share.js';
export * from './commands/verify.js';
export * from './commands/status.js';

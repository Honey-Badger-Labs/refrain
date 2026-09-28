import { z } from 'zod';
import { ID_PATTERN, MAX_ID_LENGTH, MAX_TRACK_ID_LENGTH, TRACK_ID_PATTERN } from './ids.js';

const id = z.string().min(1).max(MAX_ID_LENGTH).regex(ID_PATTERN, 'not a valid id');
const trackIdField = z
  .string()
  .min(3)
  .max(MAX_TRACK_ID_LENGTH)
  .regex(TRACK_ID_PATTERN, 'not a valid track id');

/**
 * A relative path under the published library root. Absolute URLs, protocol
 * relative URLs and traversal are all refused: the app only ever plays files
 * from its own origin, which keeps SEC-1 and SEC-3 honest.
 */
const relativePath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/, 'not a relative path')
  .refine((p) => !p.includes('..'), 'path traversal')
  .refine((p) => !p.includes('//'), 'empty path segment');

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://'), 'must be https');

export const LicenceSchema = z.object({
  /** SPDX id where one exists, otherwise a short label such as `public-domain`. */
  id: z.string().min(2).max(64),
  name: z.string().min(2).max(200),
  url: httpsUrl.optional(),
  /** Free text: why this text is clear to use. Shown on the rights page. */
  note: z.string().max(1000).optional(),
});
export type Licence = z.infer<typeof LicenceSchema>;

export const CorpusSchema = z.object({
  id,
  title: z.string().min(1).max(200),
  /** Which edition, printing or translation. Editions carry their own copyright. */
  edition: z.string().min(1).max(200),
  author: z.string().min(1).max(200),
  /** Publication or first-appearance year of the edition used. */
  year: z.number().int().min(-3000).max(2200).optional(),
  licence: LicenceSchema,
  sourceUrl: httpsUrl,
  description: z.string().max(2000).optional(),
  books: z
    .array(
      z.object({
        id,
        title: z.string().min(1).max(200),
        order: z.number().int().min(0),
      }),
    )
    .min(1),
});
export type Corpus = z.infer<typeof CorpusSchema>;

export const ChunkSchema = z.object({
  id,
  corpusId: id,
  bookId: id,
  /** Position within the book, 1-based, as a reader would cite it. */
  number: z.number().int().min(1),
  title: z.string().min(1).max(200),
  /** The canonical lines. Principle 1: this is the truth, audio is a render. */
  lines: z.array(z.string().min(1).max(500)).min(1),
});
export type Chunk = z.infer<typeof ChunkSchema>;

export const RenderModeSchema = z.enum(['sung', 'drama']);
export type RenderMode = z.infer<typeof RenderModeSchema>;

export const StyleSchema = z.object({
  id,
  name: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
});
export type Style = z.infer<typeof StyleSchema>;

export const VoiceSchema = z.object({
  id,
  name: z.string().min(1).max(80),
  /** Where the voice comes from. Rights rule: synthetic or licensed only. */
  source: z.string().min(1).max(200),
  description: z.string().max(400).optional(),
});
export type Voice = z.infer<typeof VoiceSchema>;

export const PresetSchema = z.object({
  id,
  mode: RenderModeSchema,
  styleId: id,
  voiceId: id,
  /** Which renderer adapter produces this preset's audio. */
  adapter: z.string().min(1).max(80),
  /** Adapter-specific knobs. Opaque to the catalogue, hashed into provenance. */
  params: z.record(z.unknown()).default({}),
  promptTemplate: z.string().max(4000).optional(),
  modelId: z.string().max(200).optional(),
});
export type Preset = z.infer<typeof PresetSchema>;

export const TrackStatusSchema = z.enum(['candidate', 'approved', 'published', 'rejected']);
export type TrackStatus = z.infer<typeof TrackStatusSchema>;

/**
 * What a performance's tokens are.
 *
 * A track's alignment answers one question — which token is sounding at time
 * t — and nothing about that question is specific to text. A tongue-drum
 * arrangement indexes pads; a ukulele chart indexes chord shapes; both want
 * the same search the synced text view already does. The kind names what an
 * index points into, so a consumer knows what it has been handed before it
 * tries to draw it.
 */
export const TokenKindSchema = z.enum(['line', 'note', 'chord']);
export type TokenKind = z.infer<typeof TokenKindSchema>;

/** Token number `index` sounds from `start` to `end`, in seconds. */
export const TokenSpanSchema = z.object({
  index: z.number().int().min(0),
  start: z.number().min(0),
  end: z.number().min(0),
});
export type TokenSpan = z.infer<typeof TokenSpanSchema>;

/**
 * One line of text with the moment it starts and ends in the audio.
 *
 * This is the `line` kind of `TokenSpan`, and it keeps its own spelling on
 * purpose. `lineIndex` is what every published `catalogue.json` already says,
 * the catalogue carries a content hash, and the app refuses a mismatch — so
 * renaming the field to `index` would invalidate every library in the world
 * that this code can currently play, to buy a tidier name. `asTokenSpans`
 * bridges the two, once per track rather than once per timeupdate.
 */
export const AlignmentSpanSchema = z.object({
  lineIndex: z.number().int().min(0),
  start: z.number().min(0),
  end: z.number().min(0),
});
export type AlignmentSpan = z.infer<typeof AlignmentSpanSchema>;

/**
 * A stream of tokens with their timings — what a listener follows, or a
 * learner plays along to.
 *
 * `tokens` is what to show for each index: a line of text, a pad number, a
 * chord name. The audio it belongs to is the track's, so a performance is only
 * ever meaningful next to one.
 */
export const PerformanceSchema = z.object({
  kind: TokenKindSchema,
  tokens: z.array(z.string().max(200)).max(5000),
  spans: z.array(TokenSpanSchema),
});
export type Performance = z.infer<typeof PerformanceSchema>;

/**
 * One encoding of a track.
 *
 * Every track ships in more than one format because no single codec covers
 * every browser at a sensible size. Opus is roughly a third smaller at the
 * same quality and is what most listeners get; AAC in an .m4a is what Safari
 * and older iOS need. The app picks per device with `canPlayType`, so the
 * catalogue states the formats and never assumes one.
 */
export const AudioSourceSchema = z.object({
  path: relativePath,
  /** Full media type including codecs, so `canPlayType` can answer properly. */
  mimeType: z.string().min(3).max(100),
  codec: z.enum(['opus', 'aac']),
  bitrateKbps: z.number().int().positive().max(1024),
  bytes: z.number().int().positive(),
  /** Integrity of this file, checked before offline caching (SEC-10). */
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type AudioSource = z.infer<typeof AudioSourceSchema>;

export const TrackSchema = z.object({
  id: trackIdField,
  chunkId: id,
  presetId: id,
  status: TrackStatusSchema,
  /** Best first: the app takes the first one the browser says it can play. */
  sources: z.array(AudioSourceSchema).min(1),
  durationSeconds: z.number().positive().max(60 * 60),
  alignment: z.array(AlignmentSpanSchema),
  /**
   * Token streams other than the words. Optional, and omitted rather than
   * written empty: a track with nothing extra must serialise exactly as it did
   * before this field existed, or every published catalogue's hash moves.
   */
  performances: z.array(PerformanceSchema).max(8).optional(),
});
export type Track = z.infer<typeof TrackSchema>;

export const ReviewVerdictSchema = z.enum(['approve', 'reject']);
export const RejectReasonSchema = z.enum([
  'wrong-words',
  'bad-audio',
  'style-off',
  'timing-off',
  'other',
]);
export type RejectReason = z.infer<typeof RejectReasonSchema>;

export const ProvenanceSchema = z.object({
  trackId: trackIdField,
  adapter: z.string().min(1).max(80),
  modelId: z.string().max(200).optional(),
  modelVersion: z.string().max(200).optional(),
  /** Terms the model output was produced under, and when they were checked. */
  modelTerms: z
    .object({
      url: httpsUrl.optional(),
      version: z.string().max(100).optional(),
      checkedOn: z.string().max(40).optional(),
      commercialUse: z.boolean(),
    })
    .optional(),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  seed: z.number().int(),
  renderedAt: z.string().min(4).max(40),
  reviewer: z.string().max(200).optional(),
  verdict: ReviewVerdictSchema.optional(),
  reason: RejectReasonSchema.optional(),
  reviewedAt: z.string().max(40).optional(),
  /** Result of the transcribe-and-diff accuracy check. */
  wordAccuracy: z.number().min(0).max(1).optional(),
  notes: z.string().max(2000).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * The published catalogue. One file per corpus, generated by `refrain publish`,
 * never hand-edited (SEC-2). Only `published` tracks appear here.
 */
export const CatalogueSchema = z.object({
  schemaVersion: z.literal(1),
  corpus: CorpusSchema,
  styles: z.array(StyleSchema).min(1),
  voices: z.array(VoiceSchema).min(1),
  presets: z.array(PresetSchema).min(1),
  chunks: z.array(ChunkSchema).min(1),
  tracks: z.array(TrackSchema.extend({ status: z.literal('published') })),
  generatedAt: z.string().min(4).max(40),
  /** Hash over everything above. The app checks it on load (SEC-10). */
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Catalogue = z.infer<typeof CatalogueSchema>;

/** The tiny file the app fetches first to discover which corpora exist. */
export const CatalogueIndexSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().min(4).max(40),
  corpora: z
    .array(
      z.object({
        id,
        title: z.string().min(1).max(200),
        author: z.string().min(1).max(200),
        path: relativePath,
        trackCount: z.number().int().min(0),
        chunkCount: z.number().int().min(0),
      }),
    )
    .min(1),
});
export type CatalogueIndex = z.infer<typeof CatalogueIndexSchema>;

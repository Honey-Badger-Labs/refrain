import { describe, expect, it } from 'vitest';
import { pickSource, sizeFor, type CanPlayTypeResult } from '../src/sources.js';
import { track } from './fixtures.js';

const t = track('the-lamb', 'hymn-alto');

/** Stand-ins for the three browsers that matter. */
const chromium = (type: string): CanPlayTypeResult =>
  type.includes('opus') ? 'probably' : type.startsWith('audio/mp4') ? '' : '';
const safari = (type: string): CanPlayTypeResult =>
  type.startsWith('audio/mp4') ? 'probably' : type.includes('opus') ? '' : '';
const vague = (type: string): CanPlayTypeResult => (type.startsWith('audio/mp4') ? 'maybe' : '');
const hopeless = (): CanPlayTypeResult => '';

describe('pickSource', () => {
  it('gives Opus to a browser that can decode it', () => {
    expect(pickSource(t, chromium).codec).toBe('opus');
  });

  it('gives AAC to Safari', () => {
    expect(pickSource(t, safari).codec).toBe('aac');
  });

  it('accepts a "maybe" when nothing answered "probably"', () => {
    expect(pickSource(t, vague).codec).toBe('aac');
  });

  it('falls back to the first source when the browser says nothing works', () => {
    expect(pickSource(t, hopeless).codec).toBe('opus');
  });

  it('takes the first source outside a browser', () => {
    expect(pickSource(t).codec).toBe('opus');
  });

  it('throws for a track with no sources rather than returning undefined', () => {
    expect(() => pickSource({ ...t, sources: [] })).toThrow(/no audio sources/);
  });
});

describe('sizeFor', () => {
  it('counts only the encoding this device would fetch', () => {
    const tracks = [t, track('the-tyger', 'hymn-alto')];
    expect(sizeFor(tracks, chromium)).toBe(440_000);
    expect(sizeFor(tracks, safari)).toBe(680_000);
  });
});

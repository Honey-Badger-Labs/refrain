import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChunkSchema, type Chunk, type Track } from '@refrain/catalogue';
import { chordsOf, chordsUsed, describeShape, loopTarget, UKE_SHAPES } from '../src/lib/chords.js';
import { ChordBox } from '../src/components/ChordBox.js';
import { SyncedText } from '../src/components/SyncedText.js';

const base = { id: 'x', corpusId: 'c', bookId: 'b', number: 1, title: 'X', lines: ['one', 'two'] };

describe('chords', () => {
  it('splits and collects chord names in order', () => {
    expect(chordsOf(' C  G7 ')).toEqual(['C', 'G7']);
    expect(chordsUsed(['C G', '', 'Am C'])).toEqual(['C', 'G', 'Am']);
  });

  it('describes a shape for a screen reader', () => {
    expect(describeShape('C')).toBe('C chord on ukulele: G open, C open, E open, A fret 3');
    expect(describeShape('Hdim')).toBeNull();
  });

  it('holds only shapes a hand can make in four frets', () => {
    for (const shape of Object.values(UKE_SHAPES)) expect(Math.max(...shape)).toBeLessThanOrEqual(4);
  });

  it('loops only between a start and a later end', () => {
    expect(loopTarget(10, 4, 9)).toBe(4);
    expect(loopTarget(6, 4, 9)).toBeNull();
    expect(loopTarget(1, 4, 9)).toBe(4);
    expect(loopTarget(10, 9, 4)).toBeNull();
    expect(loopTarget(10, null, 9)).toBeNull();
  });
});

describe('music on a chunk', () => {
  it('is optional, and a chunk without it parses unchanged', () => {
    expect(ChunkSchema.parse(base)).toEqual(base);
  });
  it('accepts key, tempo and chords, and refuses anything else in a chord line', () => {
    expect(ChunkSchema.safeParse({ ...base, music: { key: 'C major', tempoBpm: 90, chords: ['C G7', ''] } }).success).toBe(true);
    expect(ChunkSchema.safeParse({ ...base, music: { chords: ['<script>'] } }).success).toBe(false);
    expect(ChunkSchema.safeParse({ ...base, music: { key: 'H' } }).success).toBe(false);
  });
});

describe('rendering', () => {
  it('draws a labelled chord box, and only a name for an unknown chord', () => {
    render(<><ChordBox name="Am" /><ChordBox name="C#dim" /></>);
    expect(screen.getByRole('img', { name: /Am chord on ukulele/ })).toBeTruthy();
    expect(screen.getByText('C#dim')).toBeTruthy();
  });

  it('puts chords above the line they belong to, and nothing when absent', () => {
    const track = { alignment: [{ lineIndex: 0, start: 0, end: 1 }, { lineIndex: 1, start: 1, end: 2 }] } as unknown as Track;
    const chunk: Chunk = { ...base, music: { chords: ['C G7', ''] } };
    render(<SyncedText chunk={chunk} track={track} currentLine={0} onSeek={() => undefined} />);
    expect(screen.getByLabelText('Chords: C, G7')).toBeTruthy();
    expect(screen.queryAllByLabelText(/^Chords:/)).toHaveLength(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Catalogue, Chunk, Track } from '@refrain/catalogue';
import { SyncedText } from '../src/components/SyncedText.js';
import { PresetPicker } from '../src/components/PresetPicker.js';
import { PlayerBar, formatTime } from '../src/components/PlayerBar.js';
import { NotFound } from '../src/pages/NotFound.js';
import type { PlayerControls, PlayerState } from '../src/player/usePlayer.js';

const chunk: Chunk = {
  id: 'the-lamb',
  corpusId: 'blake-songs',
  bookId: 'innocence',
  number: 3,
  title: 'The Lamb',
  lines: ['Little Lamb who made thee', 'Dost thou know who made thee'],
};

function makeTrack(presetId: string): Track {
  return {
    id: `the-lamb--${presetId}`,
    chunkId: 'the-lamb',
    presetId,
    status: 'published',
    sources: [
      {
        path: `library/blake-songs/the-lamb/${presetId}.webm`,
        mimeType: 'audio/webm; codecs="opus"',
        codec: 'opus',
        bitrateKbps: 32,
        bytes: 1000,
        sha256: 'a'.repeat(64),
      },
    ],
    durationSeconds: 10,
    alignment: [
      { lineIndex: 0, start: 0, end: 5 },
      { lineIndex: 1, start: 5, end: 10 },
    ],
  };
}

const catalogue = {
  schemaVersion: 1,
  corpus: {
    id: 'blake-songs',
    title: 'Songs',
    edition: 'e',
    author: 'William Blake',
    licence: { id: 'public-domain', name: 'Public domain' },
    sourceUrl: 'https://example.org/x',
    books: [{ id: 'innocence', title: 'Songs of Innocence', order: 0 }],
  },
  styles: [
    { id: 'hymn', name: 'Hymn' },
    { id: 'folk', name: 'Folk' },
  ],
  voices: [
    { id: 'alto', name: 'Alto', source: 'synthetic' },
    { id: 'treble', name: 'Treble', source: 'synthetic' },
  ],
  presets: [
    { id: 'hymn-alto', mode: 'sung', styleId: 'hymn', voiceId: 'alto', adapter: 'synth', params: {} },
    { id: 'folk-alto', mode: 'sung', styleId: 'folk', voiceId: 'alto', adapter: 'synth', params: {} },
  ],
  chunks: [chunk],
  tracks: [makeTrack('hymn-alto'), makeTrack('folk-alto')],
  generatedAt: '2026-09-19T00:00:00.000Z',
  contentHash: 'b'.repeat(64),
} as Catalogue;

describe('SyncedText', () => {
  it('renders the lines as text, never as markup', () => {
    const dangerous: Chunk = { ...chunk, lines: ['<img src=x onerror=alert(1)>'] };
    const { container } = render(
      <SyncedText
        chunk={dangerous}
        track={makeTrack('hymn-alto')}
        currentLine={-1}
        onSeek={() => {}}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('marks the active line and only that line', () => {
    render(
      <SyncedText chunk={chunk} track={makeTrack('hymn-alto')} currentLine={1} onSeek={() => {}} />,
    );
    const active = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current'));
    expect(active).toHaveLength(1);
    expect(active[0]!.textContent).toBe('Dost thou know who made thee');
  });

  it('seeks to a line when it is tapped', async () => {
    const onSeek = vi.fn();
    render(
      <SyncedText chunk={chunk} track={makeTrack('hymn-alto')} currentLine={0} onSeek={onSeek} />,
    );
    await userEvent.click(screen.getByText('Dost thou know who made thee'));
    expect(onSeek).toHaveBeenCalledWith(5);
  });

  it('does not offer to seek to a line with no timing', async () => {
    const track = { ...makeTrack('hymn-alto'), alignment: [{ lineIndex: 0, start: 0, end: 5 }] };
    const onSeek = vi.fn();
    render(<SyncedText chunk={chunk} track={track} currentLine={0} onSeek={onSeek} />);
    const second = screen.getByText('Dost thou know who made thee') as HTMLButtonElement;
    expect(second.disabled).toBe(true);
  });
});

describe('PresetPicker', () => {
  it('disables a style with no published track', () => {
    render(
      <PresetPicker
        catalogue={catalogue}
        chunkId="the-lamb"
        styleId="hymn"
        voiceId="alto"
        onChange={() => {}}
      />,
    );
    expect((screen.getByRole('button', { name: 'Treble' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Folk' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports the current choice through aria-pressed', () => {
    render(
      <PresetPicker
        catalogue={catalogue}
        chunkId="the-lamb"
        styleId="hymn"
        voiceId="alto"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Hymn' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Folk' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the voice when switching to a style that has it', async () => {
    const onChange = vi.fn();
    render(
      <PresetPicker
        catalogue={catalogue}
        chunkId="the-lamb"
        styleId="hymn"
        voiceId="alto"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Folk' }));
    expect(onChange).toHaveBeenCalledWith({ styleId: 'folk', voiceId: 'alto' });
  });
});

describe('PlayerBar', () => {
  const state: PlayerState = {
    playing: false,
    currentTime: 12,
    duration: 100,
    rate: 1,
    buffering: false,
    error: null,
  };
  const controls: PlayerControls = {
    toggle: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    skip: vi.fn(),
    setRate: vi.fn(),
  };

  it('labels the control by what pressing it does', () => {
    const { rerender } = render(
      <PlayerBar
        chunk={chunk}
        track={makeTrack('hymn-alto')}
        state={state}
        controls={controls}
        subtitle="Hymn · Alto"
      />,
    );
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    rerender(
      <PlayerBar
        chunk={chunk}
        track={makeTrack('hymn-alto')}
        state={{ ...state, playing: true }}
        controls={controls}
        subtitle="Hymn · Alto"
      />,
    );
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('disables next and previous when there is nowhere to go', () => {
    render(
      <PlayerBar
        chunk={chunk}
        track={makeTrack('hymn-alto')}
        state={state}
        controls={controls}
        subtitle="Hymn · Alto"
      />,
    );
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('announces an error politely rather than throwing it away', () => {
    render(
      <PlayerBar
        chunk={chunk}
        track={makeTrack('hymn-alto')}
        state={{ ...state, error: 'This recording would not play.' }}
        controls={controls}
        subtitle="Hymn · Alto"
      />,
    );
    expect(screen.getByText('This recording would not play.')).toBeTruthy();
  });

  it('changes speed', async () => {
    render(
      <PlayerBar
        chunk={chunk}
        track={makeTrack('hymn-alto')}
        state={state}
        controls={controls}
        subtitle="Hymn · Alto"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '1.5×' }));
    expect(controls.setRate).toHaveBeenCalledWith(1.5);
  });
});

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [9, '0:09'],
    [61, '1:01'],
    [600, '10:00'],
    [Number.NaN, '0:00'],
    [-4, '0:00'],
    [Infinity, '0:00'],
  ])('%s → %s', (input, expected) => {
    expect(formatTime(input)).toBe(expected);
  });
});

describe('NotFound', () => {
  it('says what went wrong and offers a way back', async () => {
    const onHome = vi.fn();
    render(<NotFound reason="That link does not point at anything here." onHome={onHome} />);
    expect(screen.getByText('That link does not point at anything here.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Go to the library' }));
    expect(onHome).toHaveBeenCalled();
  });
});

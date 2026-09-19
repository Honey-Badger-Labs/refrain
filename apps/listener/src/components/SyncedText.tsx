import { useEffect, useRef } from 'react';
import type { Chunk, Track } from '@refrain/catalogue';
import { spanForLine } from '../player/alignment.js';

/**
 * The text, following the audio.
 *
 * Lines come from the catalogue, which is schema-validated, and are rendered
 * as React children — never as markup. Tapping a line seeks to it, which is
 * the fastest way to find a passage and also makes the alignment data testable
 * by ear.
 */
export function SyncedText({
  chunk,
  track,
  currentLine,
  onSeek,
}: {
  chunk: Chunk;
  track: Track;
  currentLine: number;
  onSeek: (seconds: number) => void;
}) {
  const containerRef = useRef<HTMLOListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const active = activeRef.current;
    const container = containerRef.current;
    if (!active || !container) return;
    // Guarded: some embedded web views have no smooth scrolling, and following
    // the text is a nicety that must never take the page down with it.
    if (typeof container.scrollTo !== 'function') return;
    const top = active.offsetTop - container.offsetTop;
    const wanted = top - container.clientHeight / 2 + active.clientHeight / 2;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    container.scrollTo({ top: Math.max(0, wanted), behavior: reduced ? 'auto' : 'smooth' });
  }, [currentLine]);

  return (
    <ol
      ref={containerRef}
      className="card max-h-[52vh] overflow-y-auto px-5 py-6 font-serif text-lg leading-relaxed"
      aria-label={`${chunk.title}, following the recording`}
    >
      {chunk.lines.map((line, index) => {
        const active = index === currentLine;
        const span = spanForLine(track.alignment, index);
        return (
          <li key={index} ref={active ? activeRef : undefined} className="-mx-2">
            <button
              type="button"
              disabled={!span}
              onClick={() => span && onSeek(span.start)}
              aria-current={active ? 'true' : undefined}
              className={[
                'block w-full rounded-lg px-2 py-1 text-left transition-colors',
                active ? 'bg-ember-500/15 text-ember-400' : 'text-slate-300',
                span ? 'hover:bg-night-800/70' : 'cursor-default',
              ].join(' ')}
            >
              {line}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

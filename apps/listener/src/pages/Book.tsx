import type { Catalogue } from '@refrain/catalogue';
import { BackIcon, PlayIcon } from '../components/Icons.js';
import { DownloadButton } from '../components/DownloadButton.js';
import { homeHash } from '../lib/router.js';
import { chunksInBook } from '../lib/catalogue.js';
import { formatTime } from '../components/PlayerBar.js';
import { NotFound } from './NotFound.js';

export function Book({
  catalogue,
  bookId,
  preference,
  onOpen,
}: {
  catalogue: Catalogue;
  bookId: string;
  preference: { styleId: string; voiceId: string } | null;
  onOpen: (chunkId: string) => void;
}) {
  const book = catalogue.corpus.books.find((b) => b.id === bookId);
  if (!book) {
    return (
      <NotFound
        reason="That book is not in this catalogue."
        onHome={() => {
          window.location.hash = homeHash;
        }}
      />
    );
  }

  const chunks = chunksInBook(catalogue, bookId);
  const preset =
    catalogue.presets.find(
      (p) => p.styleId === preference?.styleId && p.voiceId === preference?.voiceId,
    ) ?? catalogue.presets[0];
  const tracks = preset
    ? catalogue.tracks.filter(
        (t) => t.presetId === preset.id && chunks.some((c) => c.id === t.chunkId),
      )
    : [];
  const style = catalogue.styles.find((s) => s.id === preset?.styleId)?.name ?? '';
  const voice = catalogue.voices.find((v) => v.id === preset?.voiceId)?.name ?? '';

  return (
    <div className="space-y-5">
      <a href={homeHash} className="inline-flex items-center gap-1 text-sm text-slate-400">
        <BackIcon /> All books
      </a>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{book.title}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {chunks.length} poems · {catalogue.corpus.author}
        </p>
      </header>

      <DownloadButton label={`Download this book — ${style} · ${voice}`} tracks={tracks} />

      <ul className="space-y-2">
        {chunks.map((chunk) => {
          const track = tracks.find((t) => t.chunkId === chunk.id);
          return (
            <li key={chunk.id}>
              <button
                type="button"
                onClick={() => onOpen(chunk.id)}
                className="card flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-night-800/70"
              >
                <span className="w-6 shrink-0 text-sm tabular-nums text-slate-500">
                  {chunk.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{chunk.title}</span>
                  <span className="block truncate font-serif text-sm text-slate-400">
                    {chunk.lines[0]}
                  </span>
                </span>
                {track && (
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">
                    {formatTime(track.durationSeconds)}
                  </span>
                )}
                <span className="shrink-0 text-ember-400">
                  <PlayIcon />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

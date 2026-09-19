import type { Catalogue, Chunk } from '@refrain/catalogue';
import { PlayIcon } from '../components/Icons.js';
import { rightsHash } from '../lib/router.js';

export function Home({
  catalogue,
  daily,
  onOpen,
  onBook,
}: {
  catalogue: Catalogue;
  daily: Chunk | null;
  onOpen: (chunkId: string) => void;
  onBook: (bookId: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const chunk of catalogue.chunks) {
    counts.set(chunk.bookId, (counts.get(chunk.bookId) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Refrain</h1>
        <p className="mt-1 text-sm text-slate-400">
          {catalogue.corpus.title} — {catalogue.corpus.author}. {catalogue.tracks.length} recordings,
          ready to play offline.
        </p>
      </header>

      {daily && (
        <section className="card p-5">
          <p className="text-xs uppercase tracking-wide text-ember-400">Song of the day</p>
          <h2 className="mt-1 text-xl font-semibold">{daily.title}</h2>
          <p className="mt-1 line-clamp-2 font-serif text-sm text-slate-400">{daily.lines[0]}</p>
          <button
            type="button"
            onClick={() => onOpen(daily.id)}
            className="mt-4 flex items-center gap-2 rounded-xl bg-ember-500 px-4 py-2.5 text-sm font-medium text-night-950"
          >
            <PlayIcon /> Play
          </button>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Books</h2>
        <ul className="space-y-2">
          {catalogue.corpus.books.map((book) => (
            <li key={book.id}>
              <button
                type="button"
                onClick={() => onBook(book.id)}
                className="card flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-night-800/70"
              >
                <span className="font-medium">{book.title}</span>
                <span className="text-sm text-slate-400">{counts.get(book.id) ?? 0} poems</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-4 text-sm text-slate-400">
        <p>
          Every recording here was made by a synthesiser in this repository, not by a music model.
          They are placeholders: real enough to listen to, seek through and download, and honest
          about not being finished work.
        </p>
        <a href={rightsHash} className="mt-2 inline-block text-ember-400 underline">
          Where the text and the voices come from
        </a>
      </section>
    </div>
  );
}

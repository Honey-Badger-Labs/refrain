import type { Catalogue } from '@refrain/catalogue';
import { BackIcon } from '../components/Icons.js';
import { homeHash } from '../lib/router.js';

/**
 * Rights, in public.
 *
 * Principle 4 says every track carries a provenance record. This page is the
 * listener-facing half of that: where the text came from, what the voices are,
 * and a plain statement that the recordings are synthetic.
 */
export function Rights({ catalogue }: { catalogue: Catalogue }) {
  const { corpus } = catalogue;
  return (
    <div className="space-y-5">
      <a href={homeHash} className="inline-flex items-center gap-1 text-sm text-slate-400">
        <BackIcon /> Back
      </a>

      <h1 className="text-2xl font-semibold tracking-tight">Text, voices and rights</h1>

      <section className="card space-y-2 p-5 text-sm">
        <h2 className="text-base font-semibold">The text</h2>
        <p>
          {corpus.title} by {corpus.author}
          {corpus.year ? `, ${corpus.year}` : ''}.
        </p>
        <p className="text-slate-400">{corpus.edition}</p>
        <p>
          <span className="text-slate-400">Licence: </span>
          {corpus.licence.name}
        </p>
        {corpus.licence.note && <p className="text-slate-400">{corpus.licence.note}</p>}
        <p>
          <a href={corpus.sourceUrl} className="text-ember-400 underline" rel="noreferrer noopener">
            Source text
          </a>
        </p>
      </section>

      <section className="card space-y-2 p-5 text-sm">
        <h2 className="text-base font-semibold">The voices</h2>
        <ul className="space-y-2">
          {catalogue.voices.map((voice) => (
            <li key={voice.id}>
              <span className="font-medium">{voice.name}</span>
              <span className="block text-slate-400">{voice.source}</span>
            </li>
          ))}
        </ul>
        <p className="text-slate-400">
          No real singer, actor or narrator is modelled or cloned here, and nothing is rendered in
          the style of a named living artist.
        </p>
      </section>

      <section className="card space-y-2 p-5 text-sm">
        <h2 className="text-base font-semibold">The recordings</h2>
        <p>
          Every track is generated ahead of time and served as a plain file. Nothing is generated
          while you listen, and the app sends no data anywhere: it only fetches its own files.
        </p>
        <p className="text-slate-400">
          Catalogue {catalogue.contentHash.slice(0, 12)}, published{' '}
          {new Date(catalogue.generatedAt).toISOString().slice(0, 10)}.
        </p>
      </section>
    </div>
  );
}

import { useState } from 'react';
import type { Catalogue, ResolvedRoute } from '@refrain/catalogue';
import { SyncedText } from '../components/SyncedText.js';
import { PresetPicker } from '../components/PresetPicker.js';
import { FeedbackDialog } from '../components/FeedbackDialog.js';
import { BackIcon, FlagIcon, ShareIcon } from '../components/Icons.js';
import { bookHash } from '../lib/router.js';
import { assetUrl, sharePathFor } from '../lib/catalogue.js';

export function Listen({
  catalogue,
  resolved,
  currentLine,
  onSeek,
  onSwitch,
}: {
  catalogue: Catalogue;
  resolved: ResolvedRoute;
  currentLine: number;
  onSeek: (seconds: number) => void;
  onSwitch: (next: { styleId: string; voiceId: string }) => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [shared, setShared] = useState<string | null>(null);

  const share = async () => {
    // Hand out the generated share page rather than the hash route: a crawler
    // reading a hash URL only ever sees the app shell, so a shared poem would
    // preview as "Refrain" and nothing else. The share page carries this
    // poem's title and opening line, and redirects straight back here.
    const url = new URL(
      assetUrl(sharePathFor(catalogue.corpus.id, resolved.chunk.id, resolved.preset.id)),
      window.location.href,
    ).toString();
    const title = `${resolved.chunk.title} — ${catalogue.corpus.author}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared('Link copied.');
    } catch {
      setShared(url);
    }
  };

  return (
    <div className="space-y-5">
      <a
        href={bookHash(resolved.book.id)}
        className="inline-flex items-center gap-1 text-sm text-slate-400"
      >
        <BackIcon /> {resolved.book.title}
      </a>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{resolved.chunk.title}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {catalogue.corpus.author} · {resolved.book.title} {resolved.chunk.number}
        </p>
      </header>

      <PresetPicker
        catalogue={catalogue}
        chunkId={resolved.chunk.id}
        styleId={resolved.styleId}
        voiceId={resolved.voiceId}
        onChange={onSwitch}
      />

      <SyncedText
        chunk={resolved.chunk}
        track={resolved.track}
        currentLine={currentLine}
        onSeek={onSeek}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void share()}
          className="flex items-center gap-2 rounded-xl border border-night-700 bg-night-800/70 px-3 py-2 text-sm text-slate-200 hover:bg-night-700"
        >
          <ShareIcon /> Share
        </button>
        <button
          type="button"
          onClick={() => setReporting(true)}
          className="flex items-center gap-2 rounded-xl border border-night-700 bg-night-800/70 px-3 py-2 text-sm text-slate-200 hover:bg-night-700"
        >
          <FlagIcon /> Report
        </button>
        {shared && (
          <span role="status" className="text-xs text-slate-400">
            {shared}
          </span>
        )}
      </div>

      {reporting && (
        <FeedbackDialog
          trackId={resolved.track.id}
          chunkTitle={resolved.chunk.title}
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  );
}

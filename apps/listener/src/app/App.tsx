import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  chunkOfTheDay,
  localDateIso,
  resolveRoute,
  routeToHash,
  type Catalogue,
  type Route,
} from '@refrain/catalogue';
import { loadLibrary, type Library } from '../lib/catalogue.js';
import { useHash } from '../lib/useHash.js';
import { bookHash, homeHash, navigate, replace, viewFromHash } from '../lib/router.js';
import { usePlayer } from '../player/usePlayer.js';
import { mapPosition } from '../player/alignment.js';
import { PlayerBar } from '../components/PlayerBar.js';
import { Home } from '../pages/Home.js';
import { Book } from '../pages/Book.js';
import { Listen } from '../pages/Listen.js';
import { Rights } from '../pages/Rights.js';
import { NotFound } from '../pages/NotFound.js';

const PREFERENCE_KEY = 'refrain.preset.v1';

interface Preference {
  styleId: string;
  voiceId: string;
}

function readPreference(): Preference | null {
  try {
    const raw = localStorage.getItem(PREFERENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Preference>;
    if (typeof parsed.styleId === 'string' && typeof parsed.voiceId === 'string') {
      return { styleId: parsed.styleId, voiceId: parsed.voiceId };
    }
  } catch {
    // Storage may be unavailable; a missing preference is not a problem.
  }
  return null;
}

export default function App() {
  const hash = useHash();
  const view = useMemo(() => viewFromHash(hash), [hash]);

  const [library, setLibrary] = useState<Library | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preference, setPreference] = useState<Preference | null>(() => readPreference());
  const [autoplay, setAutoplay] = useState(false);
  const resumeAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadLibrary()
      .then((loaded) => {
        if (!cancelled) setLibrary(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'The library would not load.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogue: Catalogue | null = useMemo(() => {
    if (!library) return null;
    if (view.name === 'listen') {
      return library.catalogues.find((c) => c.corpus.id === view.route.corpusId) ?? null;
    }
    return library.catalogues[0] ?? null;
  }, [library, view]);

  const resolved = useMemo(() => {
    if (!catalogue || view.name !== 'listen') return null;
    return resolveRoute(catalogue, view.route);
  }, [catalogue, view]);

  // Remember the last thing that played, so navigating away does not stop it
  // and the bar stays on screen.
  const [nowPlaying, setNowPlaying] = useState<{
    catalogue: Catalogue;
    route: Route;
  } | null>(null);

  useEffect(() => {
    if (resolved && catalogue) {
      setNowPlaying({ catalogue, route: view.name === 'listen' ? view.route : resolved });
      setPreference({ styleId: resolved.styleId, voiceId: resolved.voiceId });
      try {
        localStorage.setItem(
          PREFERENCE_KEY,
          JSON.stringify({ styleId: resolved.styleId, voiceId: resolved.voiceId }),
        );
      } catch {
        // Ignore: a remembered preference is a convenience, not state we need.
      }
    }
  }, [resolved, catalogue, view]);

  const playing = useMemo(() => {
    if (!nowPlaying) return null;
    return resolveRoute(nowPlaying.catalogue, nowPlaying.route);
  }, [nowPlaying]);

  const siblings = useMemo(() => {
    if (!playing || !nowPlaying) return [];
    return nowPlaying.catalogue.chunks
      .filter((c) => c.bookId === playing.book.id)
      .sort((a, b) => a.number - b.number);
  }, [playing, nowPlaying]);

  const step = useCallback(
    (delta: number) => {
      if (!playing || !nowPlaying) return;
      const index = siblings.findIndex((c) => c.id === playing.chunk.id);
      const next = siblings[index + delta];
      if (!next) return;
      const candidate: Route = { ...nowPlaying.route, chunkId: next.id };
      if (!resolveRoute(nowPlaying.catalogue, candidate)) return;
      resumeAtRef.current = 0;
      setAutoplay(true);
      navigate(routeToHash(candidate));
    },
    [playing, nowPlaying, siblings],
  );

  const onEnded = useCallback(() => step(1), [step]);

  const player = usePlayer({
    track: playing?.track ?? null,
    chunk: playing?.chunk ?? null,
    catalogue: nowPlaying?.catalogue ?? null,
    resumeAt: resumeAtRef.current,
    autoplay,
    onEnded,
  });

  // Switching style or voice keeps the listener where they were in the poem.
  const switchPreset = useCallback(
    (next: Preference) => {
      if (!playing || !nowPlaying) return;
      const candidate: Route = {
        ...nowPlaying.route,
        styleId: next.styleId,
        voiceId: next.voiceId,
      };
      const target = resolveRoute(nowPlaying.catalogue, candidate);
      if (!target) return;
      resumeAtRef.current = mapPosition(
        playing.track.alignment,
        target.track.alignment,
        player.state.currentTime,
        player.state.duration || playing.track.durationSeconds,
        target.track.durationSeconds,
      );
      setAutoplay(player.state.playing);
      replace(routeToHash(candidate));
    },
    [playing, nowPlaying, player.state.currentTime, player.state.duration, player.state.playing],
  );

  const openChunk = useCallback(
    (chunkId: string) => {
      if (!catalogue) return;
      const fallback = catalogue.presets[0];
      const styleId = preference?.styleId ?? fallback?.styleId;
      const voiceId = preference?.voiceId ?? fallback?.voiceId;
      const chunk = catalogue.chunks.find((c) => c.id === chunkId);
      if (!chunk || !styleId || !voiceId) return;
      const candidate: Route = {
        corpusId: catalogue.corpus.id,
        bookId: chunk.bookId,
        chunkId,
        styleId,
        voiceId,
      };
      const route = resolveRoute(catalogue, candidate)
        ? candidate
        : firstPlayable(catalogue, chunkId);
      if (!route) return;
      resumeAtRef.current = 0;
      setAutoplay(true);
      navigate(routeToHash(route));
    },
    [catalogue, preference],
  );

  if (loadError) {
    return (
      <Shell>
        <div className="card p-6">
          <h1 className="text-lg font-semibold">The library would not load</h1>
          <p className="mt-2 text-sm text-slate-400">{loadError}</p>
          <p className="mt-3 text-sm text-slate-400">
            Nothing is played until the catalogue passes its integrity check, so Refrain stops here
            rather than showing you something it cannot vouch for.
          </p>
        </div>
      </Shell>
    );
  }

  if (!library || !catalogue) {
    return (
      <Shell>
        <p className="animate-pulse text-sm text-slate-400">Loading the library…</p>
      </Shell>
    );
  }

  const daily = chunkOfTheDay(catalogue, localDateIso(new Date()));

  return (
    <Shell padded={Boolean(playing)}>
      {view.name === 'home' && (
        <Home catalogue={catalogue} daily={daily} onOpen={openChunk} onBook={(id) => navigate(bookHash(id))} />
      )}
      {view.name === 'book' && (
        <Book
          catalogue={catalogue}
          bookId={view.bookId}
          preference={preference}
          onOpen={openChunk}
        />
      )}
      {view.name === 'rights' && <Rights catalogue={catalogue} />}
      {view.name === 'listen' &&
        (resolved ? (
          <Listen
            catalogue={catalogue}
            resolved={resolved}
            currentLine={player.currentLine}
            onSeek={player.controls.seek}
            onSwitch={switchPreset}
          />
        ) : (
          <NotFound
            reason="That style, voice or poem is not in the catalogue."
            onHome={() => navigate(homeHash)}
          />
        ))}
      {view.name === 'unknown' && (
        <NotFound reason="That link does not point at anything here." onHome={() => navigate(homeHash)} />
      )}

      <audio ref={player.setAudio} preload="metadata" playsInline />

      {playing && nowPlaying && (
        <PlayerBar
          chunk={playing.chunk}
          track={playing.track}
          state={player.state}
          controls={player.controls}
          subtitle={subtitleFor(nowPlaying.catalogue, nowPlaying.route)}
          {...(siblings.findIndex((c) => c.id === playing.chunk.id) > 0
            ? { onPrevious: () => step(-1) }
            : {})}
          {...(siblings.findIndex((c) => c.id === playing.chunk.id) < siblings.length - 1
            ? { onNext: () => step(1) }
            : {})}
        />
      )}
    </Shell>
  );
}

function firstPlayable(catalogue: Catalogue, chunkId: string): Route | null {
  const chunk = catalogue.chunks.find((c) => c.id === chunkId);
  if (!chunk) return null;
  const track = catalogue.tracks.find((t) => t.chunkId === chunkId);
  const preset = catalogue.presets.find((p) => p.id === track?.presetId);
  if (!preset) return null;
  return {
    corpusId: catalogue.corpus.id,
    bookId: chunk.bookId,
    chunkId,
    styleId: preset.styleId,
    voiceId: preset.voiceId,
  };
}

function subtitleFor(catalogue: Catalogue, route: Route): string {
  const style = catalogue.styles.find((s) => s.id === route.styleId)?.name ?? route.styleId;
  const voice = catalogue.voices.find((v) => v.id === route.voiceId)?.name ?? route.voiceId;
  return `${style} · ${voice}`;
}

function Shell({ children, padded = false }: { children: React.ReactNode; padded?: boolean }) {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pt-6" style={padded ? { paddingBottom: '11rem' } : undefined}>
      {children}
    </div>
  );
}

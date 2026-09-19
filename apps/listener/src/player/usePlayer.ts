import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Catalogue, Chunk, Track } from '@refrain/catalogue';
import { pickSource } from '@refrain/catalogue';
import { assetUrl, canPlayType } from '../lib/catalogue.js';
import { lineAt } from './alignment.js';

export interface PlayerState {
  playing: boolean;
  currentTime: number;
  duration: number;
  rate: number;
  buffering: boolean;
  error: string | null;
}

export interface PlayerControls {
  toggle(): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  skip(seconds: number): void;
  setRate(rate: number): void;
}

export const RATES = [0.75, 1, 1.25, 1.5] as const;

export interface UsePlayerOptions {
  track: Track | null;
  chunk: Chunk | null;
  catalogue: Catalogue | null;
  /** Where to resume when the track changes, in seconds. */
  resumeAt?: number;
  onEnded?: () => void;
  autoplay?: boolean;
}

/**
 * The player.
 *
 * One `<audio>` element owns playback; React owns everything around it. The
 * element is the source of truth for time and rate, which is why the state
 * here is read back out of events rather than predicted — a seek that the
 * browser clamps, a rate the platform refuses, or a stall are all things the
 * UI should show honestly.
 */
export function usePlayer(options: UsePlayerOptions) {
  const { track, chunk, catalogue, onEnded, autoplay, resumeAt } = options;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayerState>({
    playing: false,
    currentTime: 0,
    duration: track?.durationSeconds ?? 0,
    rate: 1,
    buffering: false,
    error: null,
  });

  // Which encoding this device can actually decode. Opus for most, AAC for
  // Safari; decided once per track rather than guessed from the user agent.
  const src = track ? assetUrl(pickSource(track, canPlayType).path) : null;

  // Load a new source, then resume where the listener was.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    const wasPlaying = !audio.paused;
    audio.src = src;
    audio.load();
    const target = resumeAt ?? 0;
    const apply = () => {
      if (target > 0 && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(target, Math.max(0, audio.duration - 0.25));
      }
      if (wasPlaying || autoplay) void audio.play().catch(() => undefined);
    };
    if (audio.readyState >= 1) apply();
    else audio.addEventListener('loadedmetadata', apply, { once: true });
    setState((s) => ({ ...s, currentTime: target, error: null }));
    return () => audio.removeEventListener('loadedmetadata', apply);
    // `resumeAt` is intentionally not a dependency: it is the position to use
    // when the source changes, not something that should re-seek on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const sync = () =>
      setState((s) => ({
        ...s,
        playing: !audio.paused && !audio.ended,
        currentTime: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : (track?.durationSeconds ?? 0),
        rate: audio.playbackRate,
      }));
    const onWaiting = () => setState((s) => ({ ...s, buffering: true }));
    const onPlaying = () => setState((s) => ({ ...s, buffering: false, error: null }));
    const onError = () =>
      setState((s) => ({
        ...s,
        buffering: false,
        playing: false,
        error: 'This recording would not play. It may not have finished downloading.',
      }));
    const handleEnded = () => {
      setState((s) => ({ ...s, playing: false }));
      onEnded?.();
    };

    audio.addEventListener('timeupdate', sync);
    audio.addEventListener('durationchange', sync);
    audio.addEventListener('play', sync);
    audio.addEventListener('pause', sync);
    audio.addEventListener('ratechange', sync);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('canplay', onPlaying);
    audio.addEventListener('error', onError);
    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('timeupdate', sync);
      audio.removeEventListener('durationchange', sync);
      audio.removeEventListener('play', sync);
      audio.removeEventListener('pause', sync);
      audio.removeEventListener('ratechange', sync);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('canplay', onPlaying);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [onEnded, track?.durationSeconds]);

  const controls: PlayerControls = useMemo(
    () => ({
      play() {
        void audioRef.current?.play().catch(() => undefined);
      },
      pause() {
        audioRef.current?.pause();
      },
      toggle() {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) void audio.play().catch(() => undefined);
        else audio.pause();
      },
      seek(seconds: number) {
        const audio = audioRef.current;
        if (!audio) return;
        const limit = Number.isFinite(audio.duration) ? audio.duration : seconds;
        audio.currentTime = Math.min(Math.max(0, seconds), limit);
        setState((s) => ({ ...s, currentTime: audio.currentTime }));
      },
      skip(seconds: number) {
        const audio = audioRef.current;
        if (!audio) return;
        this.seek(audio.currentTime + seconds);
      },
      setRate(rate: number) {
        const audio = audioRef.current;
        if (!audio) return;
        audio.playbackRate = rate;
      },
    }),
    [],
  );

  const currentLine = useMemo(
    () => (track ? lineAt(track.alignment, state.currentTime) : -1),
    [track, state.currentTime],
  );

  useMediaSession({ chunk, catalogue, track, state, controls });

  const setAudio = useCallback((element: HTMLAudioElement | null) => {
    audioRef.current = element;
  }, []);

  return { state, controls, currentLine, setAudio, audioRef, src };
}

/**
 * Lock-screen and headphone controls.
 *
 * Guarded because `mediaSession` is absent in jsdom and in some browsers, and
 * because a thrown handler here would take the player down with it.
 */
function useMediaSession(args: {
  chunk: Chunk | null;
  catalogue: Catalogue | null;
  track: Track | null;
  state: PlayerState;
  controls: PlayerControls;
}) {
  const { chunk, catalogue, track, state, controls } = args;

  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session || !chunk || !catalogue) return;
    try {
      const MetadataCtor = window.MediaMetadata;
      if (MetadataCtor) {
        session.metadata = new MetadataCtor({
          title: chunk.title,
          artist: catalogue.corpus.author,
          album: catalogue.corpus.title,
          artwork: [
            { src: assetUrl('icon-512.png'), sizes: '512x512', type: 'image/png' },
            { src: assetUrl('icon-192.png'), sizes: '192x192', type: 'image/png' },
          ],
        });
      }
      session.setActionHandler('play', () => controls.play());
      session.setActionHandler('pause', () => controls.pause());
      session.setActionHandler('seekbackward', () => controls.skip(-10));
      session.setActionHandler('seekforward', () => controls.skip(10));
      session.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') controls.seek(details.seekTime);
      });
    } catch {
      // A browser that refuses one handler should not break the others.
    }
  }, [chunk, catalogue, controls]);

  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session) return;
    session.playbackState = state.playing ? 'playing' : 'paused';
    if (typeof session.setPositionState === 'function' && track && state.duration > 0) {
      try {
        session.setPositionState({
          duration: state.duration,
          playbackRate: state.rate,
          position: Math.min(state.currentTime, state.duration),
        });
      } catch {
        // Safari throws if position exceeds duration during a seek; ignore.
      }
    }
  }, [state.playing, state.duration, state.currentTime, state.rate, track]);
}

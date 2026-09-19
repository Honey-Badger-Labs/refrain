import type { Chunk, Track } from '@refrain/catalogue';
import { PauseIcon, PlayIcon, SkipIcon } from './Icons.js';
import { RATES, type PlayerControls, type PlayerState } from '../player/usePlayer.js';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PlayerBar({
  chunk,
  track,
  state,
  controls,
  onNext,
  onPrevious,
  subtitle,
}: {
  chunk: Chunk;
  track: Track;
  state: PlayerState;
  controls: PlayerControls;
  onNext?: () => void;
  onPrevious?: () => void;
  subtitle: string;
}) {
  const duration = state.duration || track.durationSeconds;

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-night-700/70 bg-night-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto w-full max-w-2xl px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-100">{chunk.title}</p>
            <p className="truncate text-xs text-slate-400">{subtitle}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrevious}
              disabled={!onPrevious}
              aria-label="Previous"
              className="rounded-full p-2 text-slate-300 hover:bg-night-800 disabled:opacity-30"
            >
              <SkipIcon dir={-1} />
            </button>
            <button
              type="button"
              onClick={() => controls.toggle()}
              aria-label={state.playing ? 'Pause' : 'Play'}
              aria-pressed={state.playing}
              className="rounded-full bg-ember-500 p-3 text-night-950 transition-transform hover:scale-105 active:scale-95"
            >
              {state.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!onNext}
              aria-label="Next"
              className="rounded-full p-2 text-slate-300 hover:bg-night-800 disabled:opacity-30"
            >
              <SkipIcon />
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-400">
            {formatTime(state.currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.1}
            value={Math.min(state.currentTime, duration)}
            onChange={(event) => controls.seek(Number(event.target.value))}
            aria-label="Position"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-night-700 accent-ember-400"
          />
          <span className="w-10 shrink-0 text-xs tabular-nums text-slate-400">
            {formatTime(duration)}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
            {RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => controls.setRate(rate)}
                aria-pressed={state.rate === rate}
                className={`pill px-2 py-1 text-xs ${state.rate === rate ? 'pill-on' : 'pill-off'}`}
              >
                {rate}×
              </button>
            ))}
          </div>
          <p aria-live="polite" className="truncate text-xs text-slate-400">
            {state.error ?? (state.buffering ? 'Buffering…' : '')}
          </p>
        </div>
      </div>
    </div>
  );
}

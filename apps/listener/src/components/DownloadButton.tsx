import { useCallback, useEffect, useState } from 'react';
import type { Track } from '@refrain/catalogue';
import { CheckIcon, DownloadIcon } from './Icons.js';
import {
  downloadSize,
  downloadTracks,
  formatBytes,
  isDownloaded,
  offlineSupported,
  removeTracks,
} from '../lib/offline.js';

export function DownloadButton({ label, tracks }: { label: string; tracks: Track[] }) {
  const [status, setStatus] = useState<'unknown' | 'absent' | 'working' | 'present'>('unknown');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const bytes = downloadSize(tracks);

  const refresh = useCallback(async () => {
    if (!offlineSupported() || tracks.length === 0) return setStatus('absent');
    setStatus((await isDownloaded(tracks)) ? 'present' : 'absent');
  }, [tracks]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!offlineSupported()) {
    return (
      <p className="text-sm text-slate-400">
        This browser cannot keep downloads. Refrain still plays while you are online.
      </p>
    );
  }

  const download = async () => {
    setError(null);
    setStatus('working');
    setProgress({ done: 0, total: tracks.length });
    try {
      await downloadTracks(tracks, (p) => setProgress({ done: p.done, total: p.total }));
      setStatus('present');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The download did not finish.');
      setStatus('absent');
    }
  };

  const remove = async () => {
    await removeTracks(tracks);
    await refresh();
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={status === 'present' ? remove : download}
        disabled={status === 'working' || tracks.length === 0}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-night-700 bg-night-800/70 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-night-700 disabled:opacity-60"
      >
        {status === 'present' ? <CheckIcon /> : <DownloadIcon />}
        {status === 'working'
          ? `Downloading ${progress.done} of ${progress.total}…`
          : status === 'present'
            ? `Remove download (${formatBytes(bytes)})`
            : `${label} (${formatBytes(bytes)})`}
      </button>
      {error && (
        <p role="alert" className="text-xs text-ember-400">
          {error}
        </p>
      )}
      {status === 'present' && (
        <p className="text-xs text-slate-400">Kept on this device. Plays with no network.</p>
      )}
    </div>
  );
}

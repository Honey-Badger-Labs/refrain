import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioUrl, fetchQueue, sendVerdict } from './api.js';
import { REASONS, type Queue, type QueueItem, type ReasonId } from './types.js';

/**
 * The review page.
 *
 * QC time is the pipeline's binding constraint, so this page is built around
 * one number: seconds per verdict. Everything a reviewer needs is on screen at
 * once — the text, the auto-check results, the audio — and every action has a
 * key, so a pass can be done without the mouse. `j`/`k` move, space plays,
 * `a` approves, `r` plus a digit rejects with a reason.
 *
 * It never shows a candidate's audio to anyone but the reviewer: the files
 * come from the local API, which serves them from the private candidates
 * directory and binds to localhost only.
 */
export function Studio() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [reviewer, setReviewer] = useState(() => localStorage.getItem('refrain.reviewer') ?? '');
  const [filter, setFilter] = useState<'candidate' | 'all'>('candidate');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const load = useCallback(async () => {
    try {
      setQueue(await fetchQueue());
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${cause.message}. Is the studio API running? \`npm run studio\` starts it.`
          : 'The studio API is not answering.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => {
    if (!queue) return [];
    return filter === 'all' ? queue.items : queue.items.filter((i) => i.status === 'candidate');
  }, [queue, filter]);

  const current = items[Math.min(index, Math.max(0, items.length - 1))] ?? null;

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  const verdict = useCallback(
    async (kind: 'approve' | 'reject', reason?: ReasonId) => {
      if (!current || busy) return;
      if (!reviewer.trim()) {
        setNotice('Put your name in first — a verdict without a reviewer is not a human gate.');
        return;
      }
      setBusy(true);
      try {
        await sendVerdict({
          trackId: current.id,
          verdict: kind,
          reviewer: reviewer.trim(),
          ...(reason ? { reason } : {}),
        });
        setNotice(`${current.id}: ${kind}${reason ? ` (${reason})` : ''}`);
        await load();
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : 'That verdict did not save.');
      } finally {
        setBusy(false);
      }
    },
    [current, busy, reviewer, load],
  );

  // Keyboard first. The reviewer's hands should not have to leave the keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'j') setIndex((i) => Math.min(i + 1, items.length - 1));
      else if (event.key === 'k') setIndex((i) => Math.max(0, i - 1));
      else if (event.key === 'a') void verdict('approve');
      else if (/^[1-5]$/.test(event.key)) {
        const reason = REASONS.find((r) => r.key === event.key);
        if (reason) void verdict('reject', reason.id);
      } else if (event.key === ' ') {
        event.preventDefault();
        const audio = audioRef.current;
        if (audio) {
          if (audio.paused) void audio.play().catch(() => undefined);
          else audio.pause();
        }
      } else if (event.key === 'ArrowLeft' && audioRef.current) {
        audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
      } else if (event.key === 'ArrowRight' && audioRef.current) {
        audioRef.current.currentTime += 5;
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, verdict]);

  return (
    <>
      <aside style={{ borderRight: '1px solid var(--line)', overflowY: 'auto', maxHeight: '100vh' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
          <h1 style={{ fontSize: 16, margin: '0 0 8px' }}>Review queue</h1>
          <input
            value={reviewer}
            onChange={(event) => {
              setReviewer(event.target.value);
              localStorage.setItem('refrain.reviewer', event.target.value);
            }}
            placeholder="Your name"
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--bg)',
              color: 'var(--text)',
              border: '1px solid var(--line)',
              borderRadius: 6,
            }}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            {(['candidate', 'all'] as const).map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                style={pill(filter === value)}
              >
                {value === 'candidate' ? 'To review' : 'All'}
              </button>
            ))}
            <button onClick={() => void load()} style={pill(false)}>
              Refresh
            </button>
          </div>
          {queue && (
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '10px 0 0' }}>
              {Object.entries(queue.counts)
                .map(([k, v]) => `${v} ${k}`)
                .join(' · ') || 'nothing rendered yet'}
            </p>
          )}
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                onClick={() => setIndex(i)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 16px',
                  background: i === index ? 'var(--panel)' : 'transparent',
                  color: 'inherit',
                  border: 0,
                  borderLeft: `3px solid ${i === index ? 'var(--ember)' : 'transparent'}`,
                }}
              >
                <div style={{ fontSize: 14 }}>{item.chunk?.title ?? item.id}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {item.preset ? `${item.preset.style} · ${item.preset.voice}` : item.id} ·{' '}
                  <span style={{ color: statusColour(item) }}>{statusLabel(item)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main style={{ padding: 24, overflowY: 'auto', maxHeight: '100vh' }}>
        {error && <p style={{ color: 'var(--bad)' }}>{error}</p>}
        {!error && items.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>
            Nothing waiting. Render some candidates with <kbd>refrain render</kbd>, or switch the
            filter to All.
          </p>
        )}

        {current && (
          <div style={{ maxWidth: 760 }}>
            <h2 style={{ margin: '0 0 4px' }}>{current.chunk?.title ?? current.id}</h2>
            <p style={{ color: 'var(--muted)', margin: '0 0 16px' }}>
              {current.preset ? `${current.preset.style} · ${current.preset.voice}` : ''} ·{' '}
              {current.durationSeconds.toFixed(0)}s · {current.id}
            </p>

            {current.audio && (
              <audio
                ref={audioRef}
                key={current.id}
                src={audioUrl(current.audio)}
                controls
                autoPlay
                style={{ width: '100%' }}
              />
            )}

            <Checks item={current} />

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0' }}>
              <button
                onClick={() => void verdict('approve')}
                disabled={busy}
                style={{ ...action('var(--good)'), color: '#0d0f18' }}
              >
                Approve <kbd>a</kbd>
              </button>
              {REASONS.map((reason) => (
                <button
                  key={reason.id}
                  onClick={() => void verdict('reject', reason.id)}
                  disabled={busy}
                  style={action('transparent')}
                >
                  {reason.label} <kbd>{reason.key}</kbd>
                </button>
              ))}
            </div>

            <p style={{ color: 'var(--muted)', fontSize: 12 }}>
              <kbd>space</kbd> play · <kbd>←</kbd> <kbd>→</kbd> 5s · <kbd>j</kbd> <kbd>k</kbd> move ·{' '}
              <kbd>a</kbd> approve · <kbd>1</kbd>–<kbd>5</kbd> reject with a reason
            </p>
            {notice && <p style={{ color: 'var(--ember)' }}>{notice}</p>}

            <h3 style={{ marginTop: 24, fontSize: 14 }}>The text, as it should be sung</h3>
            <ol style={{ lineHeight: 1.7, fontFamily: 'ui-serif, Georgia, serif' }}>
              {current.chunk?.lines.map((line, i) => <li key={i}>{line}</li>)}
            </ol>

            {current.provenance && (
              <>
                <h3 style={{ marginTop: 24, fontSize: 14 }}>Provenance</h3>
                <pre
                  style={{
                    background: 'var(--panel)',
                    padding: 12,
                    borderRadius: 8,
                    overflowX: 'auto',
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(current.provenance, null, 2)}
                </pre>
              </>
            )}
          </div>
        )}
      </main>
    </>
  );
}

function Checks({ item }: { item: QueueItem }) {
  if (!item.report) {
    return (
      <p style={{ color: 'var(--muted)' }}>
        No check report for this candidate. Re-render it before approving.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0' }}>
      {item.report.results.map((result) => (
        <li key={result.id} style={{ display: 'flex', gap: 10, padding: '4px 0', fontSize: 14 }}>
          <span
            style={{
              width: 70,
              color:
                result.status === 'pass'
                  ? 'var(--good)'
                  : result.status === 'fail'
                    ? 'var(--bad)'
                    : 'var(--muted)',
            }}
          >
            {result.status}
          </span>
          <span style={{ width: 90, color: 'var(--muted)' }}>{result.id}</span>
          <span>{result.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function statusLabel(item: QueueItem): string {
  if (item.status !== 'candidate') return item.status;
  if (!item.report) return 'no checks';
  if (!item.report.passed) return 'checks failed';
  return item.report.incomplete ? 'checks incomplete' : 'checks passed';
}

function statusColour(item: QueueItem): string {
  if (item.status === 'rejected') return 'var(--bad)';
  if (item.status === 'published' || item.status === 'approved') return 'var(--good)';
  if (item.report && !item.report.passed) return 'var(--bad)';
  return 'var(--muted)';
}

function pill(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 999,
    border: '1px solid var(--line)',
    background: active ? 'var(--ember)' : 'transparent',
    color: active ? '#0d0f18' : 'var(--text)',
    fontSize: 12,
  };
}

function action(background: string): React.CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid var(--line)',
    background,
    color: 'var(--text)',
    fontSize: 14,
  };
}

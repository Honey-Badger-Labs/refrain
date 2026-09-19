import { useState } from 'react';
import {
  FEEDBACK_REASONS,
  MAX_MESSAGE,
  submitFeedback,
  type FeedbackReason,
} from '../lib/feedback.js';

export function FeedbackDialog({
  trackId,
  chunkTitle,
  onClose,
}: {
  trackId: string;
  chunkTitle: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<FeedbackReason>('wrong-words');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ sent: boolean; mailtoUrl?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const outcome = await submitFeedback({ trackId, chunkTitle, reason, message });
    setResult({ sent: outcome.sent, ...(outcome.mailtoUrl ? { mailtoUrl: outcome.mailtoUrl } : {}) });
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-md p-5">
        <h2 id="feedback-title" className="text-lg font-semibold">
          Report this recording
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {chunkTitle}. This goes into the review queue, not to the public.
        </p>

        {result ? (
          <div className="mt-4 space-y-3 text-sm">
            <p>
              {result.sent
                ? 'Sent. Thank you — it will be looked at.'
                : 'Saved on this device. There is nowhere to send it from a static site, so it waits here.'}
            </p>
            {result.mailtoUrl && (
              <a
                href={result.mailtoUrl}
                className="inline-block rounded-lg bg-ember-500 px-3 py-2 font-medium text-night-950"
              >
                Open a mail draft
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="block w-full rounded-lg bg-night-800 px-3 py-2 text-slate-200"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <fieldset className="mt-4">
              <legend className="text-xs uppercase tracking-wide text-slate-400">
                What is wrong
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {FEEDBACK_REASONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={reason === option.id}
                    onClick={() => setReason(option.id)}
                    className={`pill ${reason === option.id ? 'pill-on' : 'pill-off'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="mt-4 block">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Anything else (optional)
              </span>
              <textarea
                value={message}
                maxLength={MAX_MESSAGE}
                onChange={(event) => setMessage(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-night-700 bg-night-950 p-2 text-sm text-slate-100"
                placeholder="It skips the third verse."
              />
              <span className="text-xs text-slate-500">
                {message.length} / {MAX_MESSAGE}
              </span>
            </label>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg bg-night-800 px-3 py-2 text-sm text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void send()}
                className="flex-1 rounded-lg bg-ember-500 px-3 py-2 text-sm font-medium text-night-950 disabled:opacity-60"
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

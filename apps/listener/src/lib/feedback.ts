/**
 * Track feedback.
 *
 * A static site has nowhere to POST to. Rather than pretend, feedback is held
 * locally and handed to the listener as a mail draft they can send, and an
 * endpoint can be configured at build time for a deployment that has one.
 *
 * The queue is deliberately small and the message is length-capped, so this
 * cannot become a place to store anything substantial (SEC-4). Whatever a
 * listener types is stored as text and rendered as text: the review UI never
 * treats it as markup.
 */

const STORAGE_KEY = 'refrain.feedback.v1';
const MAX_MESSAGE = 500;
const MAX_QUEUE = 25;

export interface FeedbackItem {
  trackId: string;
  chunkTitle: string;
  reason: FeedbackReason;
  message: string;
  at: string;
  sent: boolean;
}

export const FEEDBACK_REASONS = [
  { id: 'wrong-words', label: 'Words are wrong' },
  { id: 'bad-audio', label: 'Audio sounds broken' },
  { id: 'style-off', label: 'Style does not fit' },
  { id: 'timing-off', label: 'Text is out of time' },
  { id: 'other', label: 'Something else' },
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]['id'];

const endpoint = import.meta.env.VITE_FEEDBACK_ENDPOINT as string | undefined;
const mailto = import.meta.env.VITE_FEEDBACK_EMAIL as string | undefined;

export function readQueue(): FeedbackItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FeedbackItem[]).slice(0, MAX_QUEUE) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: FeedbackItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_QUEUE)));
  } catch {
    // Private mode, or a full quota. Feedback is not worth failing over.
  }
}

export interface SubmitResult {
  stored: boolean;
  sent: boolean;
  /** A mail draft the listener can send when there is no endpoint. */
  mailtoUrl?: string;
}

export async function submitFeedback(input: {
  trackId: string;
  chunkTitle: string;
  reason: FeedbackReason;
  message: string;
}): Promise<SubmitResult> {
  const item: FeedbackItem = {
    trackId: input.trackId,
    chunkTitle: input.chunkTitle,
    reason: input.reason,
    message: input.message.slice(0, MAX_MESSAGE).trim(),
    at: new Date().toISOString(),
    sent: false,
  };

  if (endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trackId: item.trackId,
          reason: item.reason,
          message: item.message,
        }),
      });
      if (response.ok) {
        item.sent = true;
        writeQueue([...readQueue(), item]);
        return { stored: true, sent: true };
      }
    } catch {
      // Offline, or the endpoint is down. Fall through and keep it locally.
    }
  }

  writeQueue([...readQueue(), item]);
  return {
    stored: true,
    sent: false,
    ...(mailto ? { mailtoUrl: buildMailto(mailto, item) } : {}),
  };
}

function buildMailto(address: string, item: FeedbackItem): string {
  const subject = `Refrain: ${item.reason} on ${item.chunkTitle}`;
  const body = [`Track: ${item.trackId}`, `Problem: ${item.reason}`, '', item.message].join('\n');
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export { MAX_MESSAGE };

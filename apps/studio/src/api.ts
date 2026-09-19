import type { Queue, ReasonId } from './types.js';

declare const __STUDIO_API__: string;

export const API = __STUDIO_API__;

export async function fetchQueue(): Promise<Queue> {
  const response = await fetch(`${API}/api/queue`);
  if (!response.ok) throw new Error(`the studio API returned ${response.status}`);
  return (await response.json()) as Queue;
}

export async function sendVerdict(input: {
  trackId: string;
  verdict: 'approve' | 'reject';
  reviewer: string;
  reason?: ReasonId;
  notes?: string;
}): Promise<void> {
  const response = await fetch(`${API}/api/verdict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { ok: boolean; error?: string };
  if (!response.ok || !body.ok) throw new Error(body.error ?? `verdict failed (${response.status})`);
}

export function audioUrl(path: string): string {
  return `${API}${path}`;
}

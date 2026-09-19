export type CheckStatus = 'pass' | 'fail' | 'skipped';

export interface CheckResult {
  id: string;
  status: CheckStatus;
  detail: string;
}

export interface CheckReport {
  results: CheckResult[];
  passed: boolean;
  incomplete: boolean;
  wordAccuracy?: number;
}

export interface QueueItem {
  id: string;
  status: 'candidate' | 'approved' | 'published' | 'rejected';
  durationSeconds: number;
  chunk: { id: string; title: string; lines: string[]; corpusId: string } | null;
  preset: { id: string; style: string; voice: string } | null;
  audio: string | null;
  report: CheckReport | null;
  provenance: {
    adapter?: string;
    modelId?: string;
    seed?: number;
    promptHash?: string;
    renderedAt?: string;
    reviewer?: string;
    verdict?: 'approve' | 'reject';
    reason?: string;
    wordAccuracy?: number;
  } | null;
}

export interface Queue {
  items: QueueItem[];
  counts: Partial<Record<QueueItem['status'], number>>;
}

export const REASONS = [
  { id: 'wrong-words', label: 'Wrong words', key: '1' },
  { id: 'bad-audio', label: 'Bad audio', key: '2' },
  { id: 'style-off', label: 'Style off', key: '3' },
  { id: 'timing-off', label: 'Timing off', key: '4' },
  { id: 'other', label: 'Other', key: '5' },
] as const;

export type ReasonId = (typeof REASONS)[number]['id'];

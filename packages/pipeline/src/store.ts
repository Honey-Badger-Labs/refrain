import fs from 'node:fs';
import path from 'node:path';
import type { Chunk, Corpus, Preset, Provenance, Style, Track, Voice } from '@refrain/catalogue';

/**
 * The studio's records.
 *
 * A JSON file on disk is enough for the pilot and keeps the repo runnable with
 * no services. Everything goes through this interface, so swapping in Postgres
 * later means writing one more implementation, not touching the commands.
 */
export interface StudioRecords {
  schemaVersion: 1;
  corpora: Corpus[];
  styles: Style[];
  voices: Voice[];
  presets: Preset[];
  chunks: Chunk[];
  tracks: Track[];
  provenance: Provenance[];
  feedback: FeedbackItem[];
}

export interface FeedbackItem {
  id: string;
  trackId: string;
  /** Always rendered as plain text in the review UI (SEC-4). */
  message: string;
  receivedAt: string;
}

export interface Store {
  read(): StudioRecords;
  write(records: StudioRecords): void;
  update(fn: (records: StudioRecords) => void): StudioRecords;
}

export function emptyRecords(): StudioRecords {
  return {
    schemaVersion: 1,
    corpora: [],
    styles: [],
    voices: [],
    presets: [],
    chunks: [],
    tracks: [],
    provenance: [],
    feedback: [],
  };
}

export class JsonStore implements Store {
  constructor(private readonly file: string) {}

  read(): StudioRecords {
    if (!fs.existsSync(this.file)) return emptyRecords();
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<StudioRecords>;
    return { ...emptyRecords(), ...raw, schemaVersion: 1 };
  }

  write(records: StudioRecords): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // Write to a sibling then rename: a crash mid-write leaves the old file
    // intact rather than a half-written one.
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
  }

  update(fn: (records: StudioRecords) => void): StudioRecords {
    const records = this.read();
    fn(records);
    this.write(records);
    return records;
  }
}

/** Upsert by id, preserving array order for a stable diff. */
export function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((x) => x.id === item.id);
  if (index === -1) list.push(item);
  else list[index] = item;
  return list;
}

export function upsertProvenance(list: Provenance[], item: Provenance): Provenance[] {
  const index = list.findIndex((x) => x.trackId === item.trackId);
  if (index === -1) list.push(item);
  else list[index] = { ...list[index], ...item };
  return list;
}

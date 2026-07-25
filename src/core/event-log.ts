import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { DATA_DIR } from '../config/config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('event-log');

/** Rows kept on disk. At a few hundred bytes each this is a couple of MB. */
const MAX_ROWS = 5_000;
/** Rows older than this are dropped even if the count is under the cap. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Pruning walks the table, so it runs every N inserts rather than every one. */
const PRUNE_EVERY = 200;
/** Default page size. Clients never need the whole table. */
const DEFAULT_LIMIT = 200;

const MAX_STRING = 500; // per-string cap inside a record
const MAX_KEYS = 24; // per-record key cap

export interface LoggedEvent {
  id: number;
  type: string;
  data: unknown;
  time: number;
}

/**
 * Clamps what a record can hold. Payloads include text that comes straight from
 * a tracker — a "failure reason" can be an HTML error page — and without a cap
 * that text would be stored verbatim. Clamping on the way in keeps rows small.
 */
function clamp(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 2) return undefined; // records are shallow; drop anything deeper
  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map((v) => clamp(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
    const clamped = clamp(v, depth + 1);
    if (clamped !== undefined) out[key] = clamped;
  }
  return out;
}

/**
 * The event history behind the UI's event log.
 *
 * Backed by SQLite through node:sqlite, which is built into Node so this costs
 * no dependency. Chosen over a JSON file because the process is expected to run
 * for months: rows are appended individually instead of rewriting the whole
 * history on every change, and nothing beyond the page being served is held in
 * memory, so the footprint stays flat however long it runs.
 *
 * Growth is bounded from three directions: every recorded string is clamped,
 * rows are capped by count, and rows are capped by age.
 *
 * Clients receive a page as one snapshot rather than a replay of individual
 * events. The previous approach re-sent each event on every socket connection
 * without its timestamp, so a reconnect duplicated the backlog and stamped it
 * all with the reconnect time.
 */
export class EventLog {
  private db: DatabaseSync;
  private insertsSincePrune = 0;

  constructor(dataDir: string = DATA_DIR) {
    this.db = new DatabaseSync(join(dataDir, 'events.db'));
    // WAL keeps readers off the writer's back and avoids an fsync per commit;
    // NORMAL is the usual durability tradeoff for a log we can afford to lose
    // the tail of after a hard power cut.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT    NOT NULL,
        data TEXT    NOT NULL,
        time INTEGER NOT NULL
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS events_time ON events(time)');
    this.prune();
  }

  record(type: string, data: unknown): LoggedEvent {
    const time = Date.now();
    const serialised = JSON.stringify(clamp(data) ?? {});

    const result = this.db
      .prepare('INSERT INTO events(type, data, time) VALUES (?, ?, ?)')
      .run(type, serialised, time);

    if (++this.insertsSincePrune >= PRUNE_EVERY) this.prune();

    return { id: Number(result.lastInsertRowid), type, data: JSON.parse(serialised), time };
  }

  /** Newest first, matching how the UI lists them. */
  list(limit: number = DEFAULT_LIMIT): LoggedEvent[] {
    const rows = this.db
      .prepare('SELECT id, type, data, time FROM events ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, MAX_ROWS))) as Array<{
      id: number;
      type: string;
      data: string;
      time: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      time: r.time,
      data: safeParse(r.data),
    }));
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
    return row.n;
  }

  clear(): void {
    this.db.exec('DELETE FROM events');
  }

  /** Returns false when the id was not present, so the route can 404. */
  remove(id: number): boolean {
    const result = this.db.prepare('DELETE FROM events WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private prune(): void {
    this.insertsSincePrune = 0;
    try {
      this.db.prepare('DELETE FROM events WHERE time < ?').run(Date.now() - MAX_AGE_MS);
      // Keep the newest MAX_ROWS by dropping anything below that watermark
      this.db
        .prepare(
          `DELETE FROM events WHERE id <= (
             SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET ?
           )`
        )
        .run(MAX_ROWS);
    } catch (err) {
      logger.error({ err }, 'Failed to prune the event log');
    }
  }

  destroy(): void {
    try {
      this.db.close();
    } catch {
      // already closed, or never opened — nothing useful to do here
    }
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventLog } from '../src/core/event-log.js';

let dir: string;
let log: EventLog | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seedr-events-'));
});

afterEach(() => {
  log?.destroy();
  log = null;
  rmSync(dir, { recursive: true, force: true });
});

function open(): EventLog {
  log = new EventLog(dir);
  return log;
}

describe('EventLog', () => {
  it('assigns increasing ids and stamps the time', () => {
    const l = open();
    const before = Date.now();

    const first = l.record('started', {});
    const second = l.record('announce:failure', { error: 'boom' });

    expect(second.id).toBeGreaterThan(first.id);
    expect(second.type).toBe('announce:failure');
    expect(second.data).toEqual({ error: 'boom' });
    expect(second.time).toBeGreaterThanOrEqual(before);
  });

  it('lists newest first', () => {
    const l = open();
    l.record('a', {});
    l.record('b', {});

    expect(l.list().map((e) => e.type)).toEqual(['b', 'a']);
  });

  it('creates the database file and reloads history', () => {
    const l = open();
    l.record('started', {});
    l.record('stopped', {});
    l.destroy();

    expect(existsSync(join(dir, 'events.db'))).toBe(true);

    log = new EventLog(dir);
    expect(log.list().map((e) => e.type)).toEqual(['stopped', 'started']);
  });

  it('continues the id sequence across a reopen', () => {
    const l = open();
    const first = l.record('a', {});
    l.destroy();

    log = new EventLog(dir);
    expect(log.record('b', {}).id).toBeGreaterThan(first.id);
  });

  it('removes a single event by id', () => {
    const l = open();
    const keep = l.record('a', {});
    const drop = l.record('b', {});

    expect(l.remove(drop.id)).toBe(true);
    expect(l.list().map((e) => e.id)).toEqual([keep.id]);
  });

  it('reports an unknown id rather than removing something else', () => {
    const l = open();
    l.record('a', {});

    expect(l.remove(999999)).toBe(false);
    expect(l.list()).toHaveLength(1);
  });

  it('clears everything, and the clear survives a reopen', () => {
    const l = open();
    l.record('a', {});
    l.record('b', {});
    l.clear();
    expect(l.list()).toEqual([]);
    l.destroy();

    log = new EventLog(dir);
    expect(log.list()).toEqual([]);
  });

  it('pages rather than returning the whole table', () => {
    const l = open();
    for (let i = 1; i <= 50; i++) l.record('announce:success', { i });

    expect(l.list(10)).toHaveLength(10);
    expect((l.list(10)[0]!.data as { i: number }).i).toBe(50);
    expect(l.count()).toBe(50);
  });

  it('survives a row whose payload is not valid JSON', () => {
    const l = open();
    l.record('a', { ok: true });
    // corrupt the stored payload the way a botched manual edit would
    (l as unknown as { db: { exec(sql: string): void } }).db.exec(
      "UPDATE events SET data = 'not json' WHERE id = 1"
    );

    expect(l.list()[0]!.data).toEqual({});
  });

  // The app is expected to stay up for months, so nothing may grow unbounded
  describe('bounds', () => {
    it('clamps a huge string coming from a tracker', () => {
      const l = open();
      const hostile = 'x'.repeat(200_000);

      const rec = l.record('announce:failure', { error: hostile });

      const stored = (rec.data as { error: string }).error;
      expect(stored.length).toBeLessThan(600);
      expect(stored.endsWith('…')).toBe(true);
    });

    it('clamps strings nested one level down', () => {
      const l = open();
      const rec = l.record('announce:failure', { inner: { error: 'y'.repeat(10_000) } });
      const inner = (rec.data as { inner: { error: string } }).inner;
      expect(inner.error.length).toBeLessThan(600);
    });

    it('drops structures nested deeper than a record needs', () => {
      const l = open();
      // Records are shallow in practice, so one level of nesting is kept and
      // anything below it is dropped rather than walked
      const rec = l.record('x', { a: { b: { c: { d: 'deep' } } } });
      expect(rec.data).toEqual({ a: {} });
    });

    it('caps the number of keys kept from a record', () => {
      const l = open();
      const wide: Record<string, number> = {};
      for (let i = 0; i < 200; i++) wide[`k${i}`] = i;

      const rec = l.record('x', wide);

      expect(Object.keys(rec.data as object).length).toBeLessThanOrEqual(24);
    });

    it('caps the row count so the table cannot grow without bound', () => {
      const l = open();
      // enough to cross the prune threshold several times
      for (let i = 0; i < 5_400; i++) l.record('announce:success', { i });

      expect(l.count()).toBeLessThanOrEqual(5_000);
      // the newest are the ones kept
      expect((l.list(1)[0]!.data as { i: number }).i).toBe(5_399);
    });

    it('keeps memory flat by never loading more than a page', () => {
      const l = open();
      for (let i = 0; i < 3_000; i++) l.record('announce:success', { i });

      const page = l.list();
      expect(page).toHaveLength(200); // the default page, not 3000
      const bytes = Buffer.byteLength(JSON.stringify(page), 'utf-8');
      expect(bytes).toBeLessThan(256 * 1024);
    });
  });
});

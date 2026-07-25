import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupWebSocket } from '../src/web/websocket.js';

class FakeSocket extends EventEmitter {
  handshake: any;
  emitted: Array<{ event: string; data: any }> = [];
  id = 'socket-1';

  constructor(handshake: any = {}) {
    super();
    this.handshake = handshake;
  }

  emit(event: string, data?: any): boolean {
    this.emitted.push({ event, data });
    return true;
  }
}

class FakeIO extends EventEmitter {
  engine = { clientsCount: 0 };
  middlewares: Array<(socket: any, next: (err?: Error) => void) => void> = [];
  emitted: Array<{ event: string; data: any }> = [];

  use(fn: (socket: any, next: (err?: Error) => void) => void) {
    this.middlewares.push(fn);
    return this;
  }

  emit(event: string, data?: any): boolean {
    this.emitted.push({ event, data });
    return super.emit(event, data);
  }

  connect(socket: FakeSocket) {
    super.emit('connection', socket);
  }
}

describe('setupWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // History is delivered as one snapshot the client replaces, so a reconnect
  // cannot append a second copy of the backlog
  it('sends initial state and an event snapshot on connect', () => {
    const io = new FakeIO();
    const seedManager = new EventEmitter() as any;
    seedManager.getStatus = vi.fn(() => ({ running: true, torrents: [] }));
    const recorded = [{ id: 1, type: 'started', data: {}, time: 1000 }];
    seedManager.eventLog = { record: vi.fn(), list: vi.fn(() => recorded) };

    setupWebSocket(io as any, seedManager);

    const socket = new FakeSocket({ headers: {}, auth: {} });
    io.connect(socket);

    expect(socket.emitted[0]).toEqual({ event: 'state', data: { running: true, torrents: [] } });
    expect(socket.emitted).toContainEqual({ event: 'events:snapshot', data: recorded });
    // no per-event replay any more
    expect(socket.emitted.some((evt) => evt.event === 'started')).toBe(false);
  });

  it('records forwarded events and broadcasts them as log records', () => {
    const io = new FakeIO();
    const seedManager = new EventEmitter() as any;
    seedManager.getStatus = vi.fn(() => ({ running: true, torrents: [] }));
    const record = vi.fn((type: string, data: unknown) => ({ id: 7, type, data, time: 5000 }));
    seedManager.eventLog = { record, list: vi.fn(() => []) };

    setupWebSocket(io as any, seedManager);

    seedManager.emit('announce:failure', { error: 'timeout' });

    expect(record).toHaveBeenCalledWith('announce:failure', { error: 'timeout' });
    expect(io.emitted).toContainEqual({ event: 'announce:failure', data: { error: 'timeout' } });
    expect(io.emitted).toContainEqual({
      event: 'event:new',
      data: { id: 7, type: 'announce:failure', data: { error: 'timeout' }, time: 5000 },
    });
  });

  it('forwards config:updated without logging it', () => {
    const io = new FakeIO();
    const seedManager = new EventEmitter() as any;
    seedManager.getStatus = vi.fn(() => ({ running: true, torrents: [] }));
    const record = vi.fn();
    seedManager.eventLog = { record, list: vi.fn(() => []) };

    setupWebSocket(io as any, seedManager);
    seedManager.emit('config:updated', { theme: 'midnight' });

    expect(io.emitted).toContainEqual({ event: 'config:updated', data: { theme: 'midnight' } });
    expect(record).not.toHaveBeenCalled();
  });

  it('broadcasts state periodically while clients are connected and stops after close', () => {
    const io = new FakeIO();
    io.engine.clientsCount = 1;
    const seedManager = new EventEmitter() as any;
    seedManager.getStatus = vi.fn(() => ({ running: true, count: 1 }));

    setupWebSocket(io as any, seedManager);

    vi.advanceTimersByTime(1000);
    expect(io.emitted.some((evt) => evt.event === 'state')).toBe(true);

    const priorCount = io.emitted.length;
    io.emit('close');
    vi.advanceTimersByTime(2000);
    expect(io.emitted.length).toBe(priorCount + 1);
  });

  it('removes seed manager listeners when the socket server closes', () => {
    const io = new FakeIO();
    const seedManager = new EventEmitter() as any;
    seedManager.getStatus = vi.fn(() => ({ running: true }));

    setupWebSocket(io as any, seedManager);

    expect(seedManager.listenerCount('started')).toBe(1);
    expect(seedManager.listenerCount('announce:success')).toBe(1);

    io.emit('close');

    expect(seedManager.listenerCount('started')).toBe(0);
    expect(seedManager.listenerCount('announce:success')).toBe(0);
  });

  it('accepts programmatic auth tokens when basic auth is enabled', () => {
    const io = new FakeIO();
    const seedManager = new EventEmitter() as any;
    seedManager.getStatus = vi.fn(() => ({ running: true }));

    setupWebSocket(io as any, seedManager, {
      enabled: true,
      username: 'admin',
      password: 'secret',
    });

    const middleware = io.middlewares[0]!;
    const next = vi.fn();
    middleware(
      new FakeSocket({
        headers: {},
        auth: { token: 'admin:secret' },
      }),
      next
    );

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects unauthorized sockets when basic auth is enabled', () => {
    const io = new FakeIO();
    const seedManager = new EventEmitter() as any;
    seedManager.getStatus = vi.fn(() => ({ running: true }));

    setupWebSocket(io as any, seedManager, {
      enabled: true,
      username: 'admin',
      password: 'secret',
    });

    const middleware = io.middlewares[0]!;
    const next = vi.fn();
    middleware(new FakeSocket({ headers: {}, auth: {} }), next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0]?.[0]?.message).toBe('Unauthorized');
  });
});

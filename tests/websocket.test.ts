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

  it('replays recent events and sends initial state on connect', () => {
    const io = new FakeIO();
    const seedManager = new EventEmitter() as any;
    seedManager.getStatus = vi.fn(() => ({ running: true, torrents: [] }));

    setupWebSocket(io as any, seedManager);

    seedManager.emit('started', {});
    seedManager.emit('announce:failure', { error: 'timeout' });

    const socket = new FakeSocket({ headers: {}, auth: {} });
    io.connect(socket);

    expect(socket.emitted[0]).toEqual({ event: 'state', data: { running: true, torrents: [] } });
    expect(socket.emitted.some((evt) => evt.event === 'started')).toBe(true);
    expect(socket.emitted.some((evt) => evt.event === 'announce:failure')).toBe(true);
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

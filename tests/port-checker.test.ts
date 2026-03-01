import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { checkPortReachable } from '../src/utils/port-checker.js';

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
});

function jsonResponse(data: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

/** Run checkPortReachable while advancing fake timers so poll delays resolve instantly */
async function runWithTimers(ip: string, port: number) {
  const promise = checkPortReachable(ip, port);
  // Advance timers multiple times to cover all poll delays
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(3500);
  }
  return promise;
}

describe('checkPortReachable', () => {
  it('should return reachable when nodes report success', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        ok: 1,
        request_id: 'abc123',
        nodes: {
          'us1.node': ['US', 'US East'],
          'eu1.node': ['DE', 'EU West'],
        },
      })
    );
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        'us1.node': [{ time: 0.05, address: '1.2.3.4' }],
        'eu1.node': [{ time: 0.12, address: '1.2.3.4' }],
      })
    );

    const result = await runWithTimers('1.2.3.4', 51413);
    expect(result.reachable).toBe(true);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.every((n) => n.success)).toBe(true);
  });

  it('should return not reachable when nodes report errors', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        ok: 1,
        request_id: 'abc123',
        nodes: {
          'us1.node': ['US', 'US East'],
        },
      })
    );
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        'us1.node': [{ error: 'Connection timed out' }],
      })
    );

    const result = await runWithTimers('1.2.3.4', 51413);
    expect(result.reachable).toBe(false);
    expect(result.nodes[0].success).toBe(false);
    expect(result.nodes[0].error).toBe('Connection timed out');
  });

  it('should handle null (pending) node results after max polls', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        ok: 1,
        request_id: 'abc123',
        nodes: {
          'us1.node': ['US', 'US East'],
        },
      })
    );
    // All 4 polls return null
    mockFetch.mockReturnValue(
      jsonResponse({
        'us1.node': null,
      })
    );

    const result = await runWithTimers('1.2.3.4', 51413);
    expect(result.reachable).toBe(false);
    expect(result.nodes[0].error).toBe('Timeout (no response)');
  });

  it('should throw on non-OK start response', async () => {
    vi.useRealTimers();
    mockFetch.mockReturnValueOnce(jsonResponse({}, false, 429));
    await expect(checkPortReachable('1.2.3.4', 51413)).rejects.toThrow('check-host.net returned 429');
  });

  it('should throw when request_id is missing', async () => {
    vi.useRealTimers();
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: 0 }));
    await expect(checkPortReachable('1.2.3.4', 51413)).rejects.toThrow('Failed to start port check');
  });

  it('should handle mixed results (some success, some failure)', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        ok: 1,
        request_id: 'abc123',
        nodes: {
          'us1.node': ['US', 'US East'],
          'eu1.node': ['DE', 'EU West'],
        },
      })
    );
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        'us1.node': [{ time: 0.05, address: '1.2.3.4' }],
        'eu1.node': [{ error: 'Connection refused' }],
      })
    );

    const result = await runWithTimers('1.2.3.4', 51413);
    expect(result.reachable).toBe(true);
    const successNode = result.nodes.find((n) => n.success);
    const failNode = result.nodes.find((n) => !n.success);
    expect(successNode).toBeDefined();
    expect(failNode).toBeDefined();
  });

  it('should handle unexpected response format', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        ok: 1,
        request_id: 'abc123',
        nodes: {
          'us1.node': ['US', 'US East'],
        },
      })
    );
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        'us1.node': [],
      })
    );

    const result = await runWithTimers('1.2.3.4', 51413);
    expect(result.reachable).toBe(false);
    expect(result.nodes[0].error).toBe('No result');
  });
});

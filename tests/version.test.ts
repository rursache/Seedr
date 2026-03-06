import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getVersionInfo', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('node:fs');
  });

  it('falls back to the second path when the first read fails', async () => {
    const readFileSync = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('missing dist version');
      })
      .mockImplementationOnce(() => JSON.stringify({
        version: '1.2.3',
        commit: 'abc123',
        buildDate: '2026-03-06',
        isTagged: true,
      }));

    vi.doMock('node:fs', () => ({ readFileSync }));
    const { getVersionInfo } = await import('../src/utils/version.js');

    expect(getVersionInfo()).toEqual({
      version: '1.2.3',
      commit: 'abc123',
      buildDate: '2026-03-06',
      isTagged: true,
    });
    expect(readFileSync).toHaveBeenCalledTimes(2);
  });

  it('returns the dev fallback when no version file can be read', async () => {
    const readFileSync = vi.fn(() => {
      throw new Error('missing');
    });

    vi.doMock('node:fs', () => ({ readFileSync }));
    const { getVersionInfo } = await import('../src/utils/version.js');

    expect(getVersionInfo()).toEqual({
      version: 'dev',
      commit: 'unknown',
      buildDate: 'unknown',
      isTagged: false,
    });
  });

  it('caches the parsed version info after the first read', async () => {
    const readFileSync = vi.fn(() => JSON.stringify({
      version: '2.0.0',
      commit: 'def456',
      buildDate: '2026-03-06',
      isTagged: false,
    }));

    vi.doMock('node:fs', () => ({ readFileSync }));
    const { getVersionInfo } = await import('../src/utils/version.js');

    const first = getVersionInfo();
    const second = getVersionInfo();

    expect(first).toEqual(second);
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });
});

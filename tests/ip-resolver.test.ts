import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { resolveExternalIpv4, resolveExternalIpv6 } from '../src/utils/ip-resolver.js';

beforeEach(() => {
  mockFetch.mockReset();
});

function okResponse(text: string) {
  return Promise.resolve({
    ok: true,
    text: () => Promise.resolve(text),
  });
}

function failResponse(status = 500) {
  return Promise.resolve({
    ok: false,
    status,
    text: () => Promise.resolve(''),
  });
}

describe('resolveExternalIpv4', () => {
  it('should return IP from the first successful provider', async () => {
    mockFetch.mockReturnValueOnce(okResponse('1.2.3.4'));
    const ip = await resolveExternalIpv4();
    expect(ip).toBe('1.2.3.4');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should fall through to next provider on failure', async () => {
    mockFetch
      .mockReturnValueOnce(failResponse())
      .mockReturnValueOnce(okResponse('5.6.7.8'));
    const ip = await resolveExternalIpv4();
    expect(ip).toBe('5.6.7.8');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should fall through on network error', async () => {
    mockFetch
      .mockReturnValueOnce(Promise.reject(new Error('network error')))
      .mockReturnValueOnce(okResponse('9.10.11.12'));
    const ip = await resolveExternalIpv4();
    expect(ip).toBe('9.10.11.12');
  });

  it('should return null if all providers fail', async () => {
    mockFetch.mockReturnValue(failResponse());
    const ip = await resolveExternalIpv4();
    expect(ip).toBeNull();
  });

  it('should skip empty responses', async () => {
    mockFetch
      .mockReturnValueOnce(okResponse(''))
      .mockReturnValueOnce(okResponse('  '))
      .mockReturnValueOnce(okResponse('1.1.1.1'));
    const ip = await resolveExternalIpv4();
    expect(ip).toBe('1.1.1.1');
  });

  it('should trim whitespace from IP', async () => {
    mockFetch.mockReturnValueOnce(okResponse('  1.2.3.4\n'));
    const ip = await resolveExternalIpv4();
    expect(ip).toBe('1.2.3.4');
  });
});

describe('resolveExternalIpv6', () => {
  it('should return IPv6 address from successful provider', async () => {
    mockFetch.mockReturnValueOnce(okResponse('2001:db8::1'));
    const ip = await resolveExternalIpv6();
    expect(ip).toBe('2001:db8::1');
  });

  it('should reject non-IPv6 addresses (no colon)', async () => {
    // If an IPv6 provider returns an IPv4 address, it should be skipped
    mockFetch
      .mockReturnValueOnce(okResponse('1.2.3.4'))
      .mockReturnValueOnce(okResponse('2001:db8::2'));
    const ip = await resolveExternalIpv6();
    expect(ip).toBe('2001:db8::2');
  });

  it('should return null if no IPv6 available', async () => {
    mockFetch.mockReturnValue(failResponse());
    const ip = await resolveExternalIpv6();
    expect(ip).toBeNull();
  });
});

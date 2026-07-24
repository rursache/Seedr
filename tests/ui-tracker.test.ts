import { describe, it, expect } from 'vitest';
import { trackerHost, trackerName } from '../ui/src/utils/tracker';

describe('trackerHost', () => {
  it('extracts the hostname from an announce URL', () => {
    expect(trackerHost('http://tracker.example.com/announce')).toBe('tracker.example.com');
    expect(trackerHost('https://flacsfor.me:443/announce?key=abc')).toBe('flacsfor.me');
    expect(trackerHost('udp://tracker.opentrackr.org:1337/announce')).toBe('tracker.opentrackr.org');
  });

  it('falls back to the raw value when the URL cannot be parsed', () => {
    expect(trackerHost('not a url')).toBe('not a url');
  });

  it('reports unknown for an empty tracker', () => {
    expect(trackerHost('')).toBe('Unknown');
  });
});

describe('trackerName', () => {
  it('strips common prefixes and title-cases the domain', () => {
    expect(trackerName('tracker.scenetime.com')).toBe('Scenetime');
    expect(trackerName('announce.example.org')).toBe('Example');
    expect(trackerName('www.example.org')).toBe('Example');
    expect(trackerName('tracker2.example.org')).toBe('Example');
  });

  it('handles a bare two-part domain', () => {
    expect(trackerName('flacsfor.me')).toBe('Flacsfor');
  });

  it('handles a single-label host', () => {
    expect(trackerName('localhost')).toBe('Localhost');
  });
});

export function trackerHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url || 'Unknown';
  }
}

/**
 * Derive a human-friendly tracker name from the hostname.
 * e.g. "tracker.scenetime.com" → "Scenetime", "flacsfor.me" → "Flacsfor"
 */
export function trackerName(hostname: string): string {
  // Remove common prefixes
  const stripped = hostname.replace(/^(tracker[0-9]*|announce|tr|www)\./, '');
  // Take the domain name part (before TLD)
  const parts = stripped.split('.');
  const name = parts.length >= 2 ? parts[parts.length - 2]! : parts[0]!;
  // Title-case
  return name.charAt(0).toUpperCase() + name.slice(1);
}

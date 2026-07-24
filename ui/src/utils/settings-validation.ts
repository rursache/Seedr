/**
 * Field rules for the settings form. They mirror the zod schema the backend
 * validates against, so the user sees the problem before the save round-trips.
 * Each returns a warning string, or null when the value is acceptable.
 */

/** An empty port field is allowed — saving falls back to the default. */
export function validatePort(value: number | '' | null | undefined): string | null {
  if (value === null || value === undefined || (value as unknown) === '') return null;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) {
    return 'Must be between 1 and 65535';
  }
  return null;
}

export function validateUploadRates(minRate: number, maxRate: number): string | null {
  if (minRate < 0 || maxRate < 0) return 'Upload rates must be positive';
  if (minRate > maxRate) return 'Min upload rate is higher than max';
  return null;
}

export function validateSimultaneousSeed(value: number): string | null {
  if (value !== -1 && (!Number.isInteger(value) || value < 1)) return 'Must be -1 (all) or at least 1';
  return null;
}

/** Only meaningful when the active torrent count is capped. */
export function validateRotationInterval(value: number, simultaneousSeed: number): string | null {
  if (simultaneousSeed === -1) return null;
  if (!Number.isInteger(value) || value < 1 || value > 999999) {
    return 'Must be between 1 and 999999 minutes';
  }
  return null;
}

export function validateRatioTarget(value: number): string | null {
  if (value !== -1 && value <= 0) return 'Must be -1 (unlimited) or a positive number';
  return null;
}

export function validatePeerCounts(minLeechers: number, minSeeders: number): string | null {
  if (minLeechers < 0 || !Number.isInteger(minLeechers)) return 'Min leechers must be 0 or more';
  if (minSeeders < 0 || !Number.isInteger(minSeeders)) return 'Min seeders must be 0 or more';
  return null;
}

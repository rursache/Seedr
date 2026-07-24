import { describe, it, expect } from 'vitest';
import {
  validatePort,
  validateUploadRates,
  validateSimultaneousSeed,
  validateRotationInterval,
  validateRatioTarget,
  validatePeerCounts,
} from '../ui/src/utils/settings-validation';

describe('validatePort', () => {
  it('accepts an empty value so the default can apply', () => {
    expect(validatePort('')).toBeNull();
    expect(validatePort(null)).toBeNull();
    expect(validatePort(undefined)).toBeNull();
  });

  it('accepts the valid range', () => {
    expect(validatePort(1)).toBeNull();
    expect(validatePort(49152)).toBeNull();
    expect(validatePort(65535)).toBeNull();
  });

  it('rejects out of range and non-integer ports', () => {
    expect(validatePort(0)).not.toBeNull();
    expect(validatePort(65536)).not.toBeNull();
    expect(validatePort(-1)).not.toBeNull();
    expect(validatePort(80.5)).not.toBeNull();
  });
});

describe('validateUploadRates', () => {
  it('accepts min below or equal to max', () => {
    expect(validateUploadRates(100, 500)).toBeNull();
    expect(validateUploadRates(100, 100)).toBeNull();
    expect(validateUploadRates(0, 0)).toBeNull();
  });

  it('rejects negatives and an inverted range', () => {
    expect(validateUploadRates(-1, 500)).not.toBeNull();
    expect(validateUploadRates(100, -1)).not.toBeNull();
    expect(validateUploadRates(600, 500)).not.toBeNull();
  });
});

describe('validateSimultaneousSeed', () => {
  it('accepts -1 and any positive integer', () => {
    expect(validateSimultaneousSeed(-1)).toBeNull();
    expect(validateSimultaneousSeed(1)).toBeNull();
    expect(validateSimultaneousSeed(20)).toBeNull();
  });

  it('rejects zero, other negatives and fractions', () => {
    expect(validateSimultaneousSeed(0)).not.toBeNull();
    expect(validateSimultaneousSeed(-2)).not.toBeNull();
    expect(validateSimultaneousSeed(1.5)).not.toBeNull();
  });
});

describe('validateRotationInterval', () => {
  it('is skipped entirely when the active count is unlimited', () => {
    expect(validateRotationInterval(0, -1)).toBeNull();
    expect(validateRotationInterval(-99, -1)).toBeNull();
  });

  it('accepts the valid range when the active count is capped', () => {
    expect(validateRotationInterval(1, 5)).toBeNull();
    expect(validateRotationInterval(999999, 5)).toBeNull();
  });

  it('rejects out of range values when capped', () => {
    expect(validateRotationInterval(0, 5)).not.toBeNull();
    expect(validateRotationInterval(1000000, 5)).not.toBeNull();
    expect(validateRotationInterval(1.5, 5)).not.toBeNull();
  });
});

describe('validateRatioTarget', () => {
  it('accepts -1 and positive ratios', () => {
    expect(validateRatioTarget(-1)).toBeNull();
    expect(validateRatioTarget(0.5)).toBeNull();
    expect(validateRatioTarget(2)).toBeNull();
  });

  it('rejects zero and other non-positive values', () => {
    expect(validateRatioTarget(0)).not.toBeNull();
    expect(validateRatioTarget(-5)).not.toBeNull();
  });
});

describe('validatePeerCounts', () => {
  it('accepts zero and positive integers', () => {
    expect(validatePeerCounts(0, 0)).toBeNull();
    expect(validatePeerCounts(1, 3)).toBeNull();
  });

  it('rejects negatives and fractions', () => {
    expect(validatePeerCounts(-1, 0)).not.toBeNull();
    expect(validatePeerCounts(0, -1)).not.toBeNull();
    expect(validatePeerCounts(1.5, 0)).not.toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { compareVersions } from '../../../scripts/promote-latest.mjs';

// promote-latest never moves `latest` backwards, so this ordering is what stops a run from an old
// commit undoing a release. semver.org §11, with the versions this repo actually ships.
describe('compareVersions', () => {
  it('orders the beta series numerically, not as text', () => {
    expect(compareVersions('0.1.0-beta.1', '0.1.0-beta.2')).toBe(-1);
    expect(compareVersions('0.1.0-beta.10', '0.1.0-beta.2')).toBe(1);
    expect(compareVersions('0.1.0-beta.2', '0.1.0-beta.2')).toBe(0);
  });

  it('ranks a prerelease below its release, and rc above beta', () => {
    expect(compareVersions('0.1.0-rc.1', '0.1.0')).toBe(-1);
    expect(compareVersions('0.1.0', '0.1.0-beta.2')).toBe(1);
    expect(compareVersions('0.1.0-beta.9', '0.1.0-rc.1')).toBe(-1);
  });

  it('compares the release core before any prerelease', () => {
    expect(compareVersions('0.2.0-beta.1', '0.1.0')).toBe(1);
    expect(compareVersions('0.1.1-beta.1', '0.1.0-rc.5')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
  });

  it('ranks a shorter prerelease below a longer one with the same prefix', () => {
    expect(compareVersions('0.1.0-beta', '0.1.0-beta.1')).toBe(-1);
  });
});

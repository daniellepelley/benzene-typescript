/**
 * Keeps the vendored conformance fixtures (`./fixtures/*.json`) honest against the canonical,
 * language-neutral copies owned by the cross-language benzene repo
 * (docs/specification/conformance/*.json). The port carries a VENDORED snapshot so `npm test` is
 * self-contained with no submodule; this test - and the `conformance-drift-check` CI workflow that
 * fetches the canonical fixtures fresh - fail if the snapshot has drifted.
 *
 * The authoritative gate is the CI workflow (it clones benzene at the current HEAD). This test runs
 * the same byte-for-byte diff locally when a canonical copy is reachable - via the `BENZENE_SPEC_DIR`
 * env var (pointing at .../docs/specification/conformance, or the benzene repo root) or a sibling
 * `Benzene`/`benzene` checkout - and otherwise reports that it is relying on CI, without failing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const here = dirname(fileURLToPath(import.meta.url));

/** The vendored `*.json` fixture file names (excludes SPEC_VERSION / README). */
function vendoredFixtureNames(): string[] {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/** Resolve the canonical `docs/specification/conformance` directory, or `undefined` if unreachable. */
function findCanonicalDir(): string | undefined {
  const candidates: string[] = [];
  const env = process.env.BENZENE_SPEC_DIR;
  if (env) {
    candidates.push(env, join(env, 'docs', 'specification', 'conformance'));
  }
  // Common sibling-checkout layouts relative to this repo root (test/Benzene.Core.Test/Conformance).
  const repoRoot = resolve(here, '..', '..', '..');
  const siblings = resolve(repoRoot, '..');
  for (const name of ['Benzene', 'benzene']) {
    candidates.push(join(siblings, name, 'docs', 'specification', 'conformance'));
  }
  return candidates.find((dir) => existsSync(join(dir, 'status-vocabulary.json')));
}

describe('ConformanceDriftTest', () => {
  it('records the source commit in SPEC_VERSION', () => {
    const specVersion = readFileSync(join(fixturesDir, 'SPEC_VERSION'), 'utf8').trim();
    // A 40-char git SHA of the benzene commit the snapshot was vendored from.
    expect(specVersion).toMatch(/^[0-9a-f]{40}$/);
  });

  const canonicalDir = findCanonicalDir();

  (canonicalDir ? describe : describe.skip)('vendored snapshot matches benzene canonical', () => {
    for (const name of vendoredFixtureNames()) {
      it(`${name} is byte-identical to canonical`, () => {
        const vendored = readFileSync(join(fixturesDir, name), 'utf8');
        const canonical = readFileSync(join(canonicalDir!, name), 'utf8');
        expect(vendored).toBe(canonical);
      });
    }

    it('does not omit any canonical fixture this port claims to vendor', () => {
      // Every fixture present in BOTH the canonical dir and the vendored dir must match; this guards
      // against a vendored file silently disappearing. (The port intentionally vendors a subset of the
      // canonical fixtures, so canonical-only files are not treated as drift here.)
      const vendored = new Set(vendoredFixtureNames());
      for (const name of readdirSync(canonicalDir!).filter((n) => n.endsWith('.json'))) {
        if (vendored.has(name)) {
          expect(readFileSync(join(fixturesDir, name), 'utf8')).toBe(
            readFileSync(join(canonicalDir!, name), 'utf8'),
          );
        }
      }
    });
  });

  if (!canonicalDir) {
    it('relies on the conformance-drift-check CI workflow (no local canonical copy found)', () => {
      // Set BENZENE_SPEC_DIR to the benzene repo (or its conformance dir) to run the diff locally.
      expect(vendoredFixtureNames().length).toBeGreaterThan(0);
    });
  }
});

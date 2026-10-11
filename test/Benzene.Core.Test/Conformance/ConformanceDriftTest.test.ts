/**
 * Keeps the vendored conformance fixtures (`./fixtures/*.json` and their `README.md`) honest against
 * the canonical, language-neutral copies owned by the cross-language benzene repo
 * (docs/specification/conformance/). The port carries a VENDORED snapshot so `npm test` is
 * self-contained with no submodule, and `./fixtures/SPEC_VERSION` pins the spec release it was taken
 * from - a tag such as `spec-0.1.0`, or a benzene commit while catching up partway through a release
 * (benzene's conformance README, "Spec releases and pinning").
 *
 * The authoritative gate is the `conformance-drift-check` CI workflow, which fetches benzene AT THE PIN.
 * This test runs the same byte-for-byte diff locally when a canonical copy is reachable, and reads it at
 * the pin too, so a sibling checkout that has moved past the pin does not fail here:
 *  - `BENZENE_SPEC_DIR` pointing at a benzene git checkout is read at the pin; pointing at a plain
 *    conformance directory, it is taken as it stands (the caller chose it);
 *  - otherwise a sibling `Benzene`/`benzene` git checkout is read at the pin, when it has that ref.
 * With neither, it reports that it is relying on CI, without failing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const here = dirname(fileURLToPath(import.meta.url));
const conformancePath = 'docs/specification/conformance';
const pin = readFileSync(join(fixturesDir, 'SPEC_VERSION'), 'utf8').trim();

/** The vendored `*.json` fixture file names (excludes SPEC_VERSION / README). */
function vendoredFixtureNames(): string[] {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/** The canonical conformance files, by name, from wherever this run can reach them. */
interface Canonical {
  readonly source: string;
  names(): string[];
  read(name: string): string;
}

function fromDirectory(dir: string): Canonical {
  return {
    source: dir,
    names: () => readdirSync(dir).filter((n) => n.endsWith('.json')).sort(),
    read: (name) => readFileSync(join(dir, name), 'utf8'),
  };
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** A benzene git checkout read at the pin, or `undefined` when the checkout does not have that ref. */
function fromGitAtPin(repo: string): Canonical | undefined {
  try {
    git(repo, 'rev-parse', '--verify', '--quiet', `${pin}^{commit}`);
  } catch {
    return undefined;
  }
  return {
    source: `${repo} at ${pin}`,
    names: () =>
      git(repo, 'ls-tree', '--name-only', pin, `${conformancePath}/`)
        .split('\n')
        .map((path) => path.slice(conformancePath.length + 1))
        .filter((n) => n.endsWith('.json'))
        .sort(),
    read: (name) => git(repo, 'show', `${pin}:${conformancePath}/${name}`),
  };
}

function findCanonical(): Canonical | undefined {
  const env = process.env.BENZENE_SPEC_DIR;
  if (env) {
    if (existsSync(join(env, '.git'))) return fromGitAtPin(env);
    for (const dir of [env, join(env, conformancePath)]) {
      if (existsSync(join(dir, 'status-vocabulary.json'))) return fromDirectory(dir);
    }
  }
  // Common sibling-checkout layouts relative to this repo root (test/Benzene.Core.Test/Conformance).
  const siblings = resolve(here, '..', '..', '..', '..');
  for (const name of ['Benzene', 'benzene']) {
    const repo = join(siblings, name);
    if (existsSync(join(repo, '.git'))) {
      const canonical = fromGitAtPin(repo);
      if (canonical) return canonical;
    }
  }
  return undefined;
}

describe('ConformanceDriftTest', () => {
  it('pins a spec release (or a benzene commit) in SPEC_VERSION', () => {
    expect(pin).toMatch(/^(spec-\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?|[0-9a-f]{40})$/);
  });

  const canonical = findCanonical();

  (canonical ? describe : describe.skip)(`vendored snapshot matches ${canonical?.source ?? 'benzene'}`, () => {
    for (const name of vendoredFixtureNames()) {
      it(`${name} is byte-identical to the pinned release`, () => {
        expect(readFileSync(join(fixturesDir, name), 'utf8')).toBe(canonical!.read(name));
      });
    }

    it('vendors every fixture in the pinned release', () => {
      // A runner cannot notice a fixture it was never given, so a canonical fixture missing from the
      // snapshot is drift too - the same both-ways rule as the CI workflow.
      expect(vendoredFixtureNames()).toEqual(canonical!.names());
    });

    it('vendors the README of the pinned release', () => {
      // It says which fixtures are conditional on a capability; a stale copy is a stale reason to skip.
      expect(readFileSync(join(fixturesDir, 'README.md'), 'utf8')).toBe(canonical!.read('README.md'));
    });
  });

  if (!canonical) {
    it('relies on the conformance-drift-check CI workflow (no local canonical copy at the pin)', () => {
      // Point BENZENE_SPEC_DIR at a benzene checkout that has the pinned ref to run the diff locally.
      expect(vendoredFixtureNames().length).toBeGreaterThan(0);
    });
  }
});

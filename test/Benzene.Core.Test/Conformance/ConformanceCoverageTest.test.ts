/**
 * Closes the blind spot the drift check leaves open: `ConformanceDriftTest` (and the
 * `conformance-drift-check` workflow) prove every vendored fixture's BYTES match canonical, but
 * nothing proved a runner ever OPENS one. A fixture could be vendored, byte-perfect, and read by
 * nobody — which is exactly how `problem-details-cases.json`'s `httpRules` group and three mesh
 * fixtures sat unrun.
 *
 * So: every `fixtures/*.json` must be named in a `load(...)` call by some test under
 * `test/`, unless it is on the explicit opt-out list below. The list is the honest place to record
 * "this port does not claim that fixture (yet)" — a decision, written down, rather than silence.
 *
 * The reference is deliberately matched as a `load('<name>')` call rather than a bare mention of the
 * file name, so a passing comment about a fixture cannot make it look covered. A runner that grows a
 * different way of reading a fixture has to be taught to this test.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const thisFile = fileURLToPath(import.meta.url);
const testRoot = resolve(fixturesDir, '..', '..', '..');

/**
 * Fixtures this port deliberately does not run, each with the reason it is absent. Deleting an entry
 * (and writing the runner) is always the preferred way off this list. Currently empty: the last two
 * entries (`mesh-service-version-cases.json` / `mesh-version-order-cases.json`, which awaited a
 * cross-port claim-or-drop decision) came off it when this port claimed the §2.4/§2.5 versioned
 * catalog - `MeshCollectorConformanceTest` and `MeshVersionOrderConformanceTest` now run them.
 */
const notClaimed: Readonly<Record<string, string>> = {};

function vendoredFixtureNames(): string[] {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function testSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'fixtures') {
        testSourceFiles(path, out);
      }
    } else if (entry.endsWith('.ts') && path !== thisFile) {
      out.push(path);
    }
  }
  return out;
}

const sources = testSourceFiles(testRoot).map((path) => readFileSync(path, 'utf8'));

/** True when some runner actually opens `name` — a `load(...)` call naming it, generic or not. */
function isLoadedByARunner(name: string): boolean {
  const call = new RegExp(`\\bload\\s*(<[^>]*>)?\\s*\\(\\s*['"\`]${name.replace(/\./g, '\\.')}['"\`]`);
  return sources.some((source) => call.test(source));
}

describe('ConformanceCoverageTest', () => {
  for (const name of vendoredFixtureNames()) {
    const reason = notClaimed[name];

    if (reason === undefined) {
      it(`${name} is run by a conformance runner`, () => {
        expect(
          isLoadedByARunner(name),
          `${name} is vendored but no runner loads it. Either add a runner, or add it to this ` +
            `test's notClaimed list with the reason this port does not claim it.`,
        ).toBe(true);
      });
    } else {
      it(`${name} is deliberately not claimed (${reason})`, () => {
        // The opt-out must stay honest in both directions: once a runner exists, the entry goes.
        expect(
          isLoadedByARunner(name),
          `${name} is on the notClaimed list but a runner now loads it — drop the opt-out entry.`,
        ).toBe(false);
      });
    }
  }

  it('the opt-out list names only fixtures that are actually vendored', () => {
    const vendored = new Set(vendoredFixtureNames());
    for (const name of Object.keys(notClaimed)) {
      expect(vendored.has(name), `${name} is on the notClaimed list but is not vendored`).toBe(true);
    }
  });
});

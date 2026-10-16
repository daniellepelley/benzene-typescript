#!/usr/bin/env node
/**
 * Points the `latest` dist-tag of every publishable workspace at its current version.
 *
 * A release publishes under the `beta` dist-tag, but `npm install @benzenejs/<pkg>` with no tag
 * resolves `latest`. npm sets `latest` itself only on a package's very first publish, so without
 * this a package that existed before a release keeps its OLD `latest`: after `0.1.0-beta.2`, the 25
 * packages first published at `0.1.0-beta.1` still installed the August build by default, while
 * the 104 created by the release installed `0.1.0-beta.2`. One command, two different releases.
 *
 * So, after a publish, move `latest` to the version just released — for every package, skipping the
 * ones already there. Like the publisher, it is driven by the registry and safe to re-run.
 *
 * It never moves `latest` backwards: a package whose `latest` is already a higher version than this
 * checkout's is left alone and reported, so running it from an old commit cannot undo a release.
 * And it never points `latest` at a version that isn't on the registry; that fails the run, since it
 * means the publish it follows did not finish.
 *
 * Usage:  node scripts/promote-latest.mjs [--dry-run]
 * Env:    NODE_AUTH_TOKEN         npm token with write access to the @benzenejs scope
 *         PROMOTE_DELAY_MS        pause between tag changes (default: 1000)
 *         RATE_LIMIT_BUDGET_MS    total time to spend waiting out 429s (default: 1800000 = 30min)
 */
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { publishablePackages } from './workspace-packages.mjs';

const TAG = 'latest';
const dryRun = process.argv.includes('--dry-run');
const delayMs = Number(process.env.PROMOTE_DELAY_MS ?? 1000);
const rateLimitBudgetMs = Number(process.env.RATE_LIMIT_BUDGET_MS ?? 30 * 60_000);
const rateLimitBackoffMs = (attempt) => Math.min(attempt, 5) * 60_000;
const MAX_RETRIES_ON_OTHER_ERROR = 3;
const otherErrorBackoffMs = (attempt) => attempt * 15_000;

/**
 * Semver precedence (semver.org §11), enough for this repo's versions: `-1` when `a` < `b`, `0`
 * when equal, `1` when greater. A version with a prerelease ranks below the same version without
 * one; prerelease identifiers compare numerically when both are numeric, otherwise as text, and a
 * numeric identifier ranks below a textual one.
 */
export function compareVersions(a, b) {
  const [coreA, preA] = splitVersion(a);
  const [coreB, preB] = splitVersion(b);
  for (let i = 0; i < 3; i++) {
    if (coreA[i] !== coreB[i]) return coreA[i] < coreB[i] ? -1 : 1;
  }
  if (preA.length === 0 || preB.length === 0) {
    return preA.length === preB.length ? 0 : preA.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.max(preA.length, preB.length); i++) {
    if (i >= preA.length) return -1;
    if (i >= preB.length) return 1;
    const [x, y] = [preA[i], preB[i]];
    if (x === y) continue;
    const [nx, ny] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function splitVersion(version) {
  const [core, pre] = version.split('+')[0].split(/-(.*)/s);
  return [core.split('.').map(Number), pre ? pre.split('.') : []];
}

/** The registry's view of a package: its versions and dist-tags. A plain unauthenticated GET. */
async function registryEntry(name) {
  const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not read the registry entry for ${name}: HTTP ${response.status}`);
  const metadata = await response.json();
  return { versions: Object.keys(metadata.versions ?? {}), tags: metadata['dist-tags'] ?? {} };
}

function addTag(pkg) {
  const args = ['dist-tag', 'add', `${pkg.name}@${pkg.version}`, TAG];
  const result = spawnSync('npm', args, { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  if (result.error) throw Object.assign(result.error, { output });
  if (result.status !== 0) throw Object.assign(new Error(`npm dist-tag exited ${result.status}`), { output });
}

function isAuthFailure(message) {
  return /E404|EOTP|ENEEDAUTH|E401|E403/.test(message);
}

async function main() {
  const packages = publishablePackages();
  console.log(`${packages.length} publishable workspace package(s); checking their '${TAG}' tags…`);

  const todo = [];
  const notPublished = [];
  const ahead = [];
  let alreadyCurrent = 0;
  for (const pkg of packages) {
    const entry = await registryEntry(pkg.name);
    if (!entry || !entry.versions.includes(pkg.version)) {
      notPublished.push(pkg);
      continue;
    }
    const current = entry.tags[TAG];
    if (current === pkg.version) {
      alreadyCurrent++;
    } else if (current && compareVersions(current, pkg.version) > 0) {
      ahead.push(`${pkg.name} (${TAG} is ${current})`);
    } else {
      todo.push({ ...pkg, from: current ?? '(none)' });
    }
  }

  console.log(`${alreadyCurrent} already at their current version, ${todo.length} to move.`);
  if (ahead.length > 0) {
    console.log(`Left alone, because '${TAG}' is already newer than this checkout:\n  ${ahead.join('\n  ')}`);
  }
  if (notPublished.length > 0) {
    console.error(
      `\n${notPublished.length} package(s) are not on the registry at this checkout's version, so ` +
        `'${TAG}' cannot point at them:\n  ${notPublished.map((p) => `${p.name}@${p.version}`).join('\n  ')}\n` +
        `Finish the publish first (re-run the Release workflow), then run this again.`,
    );
  }

  let moved = 0;
  let rateLimitWaitedMs = 0;
  const failures = [];

  for (const [index, pkg] of todo.entries()) {
    console.log(`[${index + 1}/${todo.length}] ${pkg.name}: ${TAG} ${pkg.from} -> ${pkg.version}`);
    if (dryRun) continue;

    let rateLimitAttempt = 0;
    let otherAttempt = 0;
    for (;;) {
      try {
        addTag(pkg);
        moved++;
        if (delayMs > 0 && index < todo.length - 1) await sleep(delayMs);
        break;
      } catch (error) {
        const message = `${error.output ?? ''}${error.message ?? error}`;

        if (isAuthFailure(message)) {
          console.error(
            `\nnpm refused to change the '${TAG}' tag of ${pkg.name}: an authentication failure, ` +
              `not a problem with the package.\n` +
              `Check that NPM_TOKEN is a granular access token with read AND write access to the ` +
              `@benzenejs scope and "Bypass two-factor authentication" ticked (EOTP means it is ` +
              `missing). See docs/publishing.md.\n`,
          );
          process.exit(1);
        }

        if (/E429|Too Many Requests/i.test(message)) {
          const backoffMs = rateLimitBackoffMs(++rateLimitAttempt);
          if (rateLimitWaitedMs + backoffMs > rateLimitBudgetMs) {
            console.error(
              `\nRate-limited by npm with ${todo.length - moved} tag(s) still to move. Re-run to ` +
                `resume; packages already at their current version are skipped.`,
            );
            process.exit(1);
          }
          rateLimitWaitedMs += backoffMs;
          console.log(`  rate-limited; waiting ${backoffMs / 60_000}min before retrying ${pkg.name}`);
          await sleep(backoffMs);
          continue;
        }

        if (otherAttempt < MAX_RETRIES_ON_OTHER_ERROR) {
          const backoffMs = otherErrorBackoffMs(++otherAttempt);
          console.log(`  failed; retrying in ${backoffMs / 1000}s (${otherAttempt}/${MAX_RETRIES_ON_OTHER_ERROR})`);
          await sleep(backoffMs);
          continue;
        }

        console.error(`  giving up on ${pkg.name}; continuing with the rest.`);
        failures.push(pkg.name);
        break;
      }
    }
  }

  const verb = dryRun ? 'Would move' : 'Moved';
  console.log(
    `\n${verb} ${dryRun ? todo.length : moved}, already current ${alreadyCurrent}, ` +
      `left alone ${ahead.length}, not published ${notPublished.length}, failed ${failures.length} ` +
      `of ${packages.length}.`,
  );
  if (failures.length > 0) {
    console.error(`Failed: ${failures.join(', ')}\nRe-run to retry just these.`);
  }
  if (failures.length > 0 || notPublished.length > 0) process.exit(1);
}

// Importable for its comparison (the test does), runnable as a script.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

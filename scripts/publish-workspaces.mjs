#!/usr/bin/env node
/**
 * Publishes every publishable workspace that isn't already on the registry at its current version.
 *
 * This replaces a plain `npm publish --workspaces` in the release workflow, because that command
 * is all-or-nothing in both directions: it aborts the whole batch on the first package that
 * fails, and it refuses to start again afterwards, since the packages it DID publish can never
 * be published again at that version. That is exactly how `0.1.0-beta.1` ended up half-released —
 * 25 packages on npm, 104 missing — with every re-run dying on package #1.
 *
 * So: skip what's already out, publish the rest one at a time, and treat a re-run as a resume.
 * Interrupt it, re-run it, run it after a partly-successful CI job — it always picks up exactly
 * where it left off, because the registry is the source of truth for what's done.
 *
 * Usage:  node scripts/publish-workspaces.mjs [--dry-run]
 * Env:    NPM_DIST_TAG            dist-tag to publish under (default: beta)
 *         PUBLISH_DELAY_MS        pause between publishes (default: 5000)
 *         RATE_LIMIT_BUDGET_MS    total time to spend waiting out 429s (default: 3600000 = 1h)
 */
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { publishablePackages, isPublished } from './workspace-packages.mjs';

const dryRun = process.argv.includes('--dry-run');
const tag = process.env.NPM_DIST_TAG || 'beta';
const delayMs = Number(process.env.PUBLISH_DELAY_MS ?? 5000);
// npm doesn't document its publish rate limit, but bulk-publishing dozens of brand-new packages
// commonly trips one, and it clears in minutes rather than instantly. Wait it out up to a budget,
// then stop and report — a later run resumes, so patience here is a convenience, not a necessity.
const rateLimitBudgetMs = Number(process.env.RATE_LIMIT_BUDGET_MS ?? 60 * 60_000);
const rateLimitBackoffMs = (attempt) => Math.min(attempt, 5) * 60_000;
// Anything else that looks transient (a 5xx, a network blip) gets a few quick retries.
const MAX_RETRIES_ON_OTHER_ERROR = 3;
const otherErrorBackoffMs = (attempt) => attempt * 15_000;

const packages = publishablePackages();
console.log(`${packages.length} publishable workspace package(s); checking the registry…`);

const todo = [];
let alreadyPublished = 0;
for (const pkg of packages) {
  let published;
  try {
    published = await isPublished(pkg.name, pkg.version);
  } catch (error) {
    // A registry read that fails is not a reason to abandon a release: try the publish and let npm
    // be the authority. A duplicate comes back as "cannot publish over", which is handled below.
    console.error(`  ${error.message} — will attempt ${pkg.name} anyway.`);
    published = false;
  }
  if (published) {
    alreadyPublished++;
    continue;
  }
  todo.push(pkg);
}

console.log(`${alreadyPublished} already published at this version, ${todo.length} to publish.\n`);
if (todo.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

/**
 * Runs `npm publish` for one package, echoing npm's output while keeping a copy of it. The output
 * has to be captured rather than inherited: which failure this is (auth, rate limit, already out)
 * is only knowable from npm's own text, and `stdio: 'inherit'` would send it straight past us.
 */
function publish(pkg) {
  const args = ['publish', '--access', 'public', '--tag', tag];
  if (dryRun) args.push('--dry-run');

  const result = spawnSync('npm', args, { cwd: pkg.dir, encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);

  if (result.error) throw Object.assign(result.error, { output });
  if (result.status !== 0) throw Object.assign(new Error(`npm publish exited ${result.status}`), { output });
}

/**
 * A 404 on PUT means npm did not accept our identity — it is what the registry returns for a
 * package you may not write to, including one you aren't authenticated for at all. It is NOT a
 * transient error and it will be identical for all 129 packages, so stop on the first one and
 * say what to check, rather than grinding through a hundred copies of the same failure.
 */
function isAuthFailure(message) {
  return /E404|EOTP|ENEEDAUTH|E401|E403/.test(message) && !/cannot publish over/i.test(message);
}

let published = 0;
let rateLimitWaitedMs = 0;
const failures = [];

for (const [index, pkg] of todo.entries()) {
  let rateLimitAttempt = 0;
  let otherAttempt = 0;

  for (;;) {
    try {
      console.log(`[${index + 1}/${todo.length}] publishing ${pkg.name}@${pkg.version}`);
      publish(pkg);
      published++;
      if (delayMs > 0 && index < todo.length - 1) await sleep(delayMs);
      break;
    } catch (error) {
      const message = `${error.output ?? ''}${error.message ?? error}`;

      // Two runs racing, or a registry read that was a few seconds stale: already out, move on.
      if (/cannot publish over/i.test(message)) {
        console.log(`  ${pkg.name}@${pkg.version} is already published — skipping.`);
        alreadyPublished++;
        break;
      }

      if (isAuthFailure(message)) {
        console.error(
          `\nnpm refused to publish ${pkg.name} as an authentication failure, not a problem with ` +
            `the package.\n\nCheck, in this order:\n` +
            `  1. The NPM_TOKEN secret is set on the repository and is a granular access token ` +
            `with read AND write access to the @benzenejs scope (a read-only or expired token ` +
            `produces exactly this 404).\n` +
            `  2. If you meant to publish via trusted publishing (OIDC) instead, the package must ` +
            `already exist on npm and have a Trusted Publisher registered for this repository and ` +
            `workflow file. npm has no "pending publisher", so a package that does not exist yet ` +
            `CANNOT be created by OIDC — it needs a token for its first publish.\n`,
        );
        process.exit(1);
      }

      const rateLimited = /E429|Too Many Requests/i.test(message);
      if (rateLimited) {
        const backoffMs = rateLimitBackoffMs(++rateLimitAttempt);
        if (rateLimitWaitedMs + backoffMs > rateLimitBudgetMs) {
          console.error(
            `\nRate-limited by npm with ${todo.length - published} package(s) still to publish, ` +
              `and the ${Math.round(rateLimitBudgetMs / 60_000)} minute wait budget is spent.\n` +
              `Nothing is broken — re-run this to resume; it will skip the ${published + alreadyPublished} ` +
              `package(s) already on the registry.`,
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

      console.error(`  giving up on ${pkg.name}@${pkg.version}; continuing with the rest.`);
      failures.push(pkg.name);
      break;
    }
  }
}

console.log(`\nPublished ${published}, already had ${alreadyPublished}, failed ${failures.length} of ${packages.length}.`);
if (failures.length > 0) {
  console.error(`Failed: ${failures.join(', ')}\nRe-run to retry just these — everything else is skipped.`);
  process.exit(1);
}

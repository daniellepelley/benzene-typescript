#!/usr/bin/env node
// Publishes every src/* package not yet on the registry at its current version, skipping ones
// already published (npm registry versions are immutable — re-publishing the same version always
// 403s) and backing off on 429 rate-limit responses instead of aborting the whole batch.
//
// Safe to interrupt and re-run: it re-checks the registry on every run, so it always resumes
// exactly where it left off. Requires `npm login` to already be done in this shell.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const srcDir = new URL('../src/', import.meta.url).pathname;
const DELAY_BETWEEN_PUBLISHES_MS = 5000;
// npm doesn't document its publish rate limit, but bulk-publishing dozens of brand-new packages
// commonly trips one somewhere around 25-30 in a short window; real-world reports suggest it's a
// multi-hour cooldown, not a multi-minute one. Backoff climbs to 30 minutes per retry and allows
// up to ~6 hours of total patience so this can be kicked off and left running unattended.
const MAX_RETRIES_ON_RATE_LIMIT = 15;
const rateLimitBackoffMs = (attempt) => Math.min(5 * attempt, 30) * 60_000;

const folders = readdirSync(srcDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

function isAlreadyPublished(name, version) {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out === version;
  } catch {
    return false; // npm view exits non-zero when the name/version isn't found yet
  }
}

function publish(pkgDir) {
  execFileSync('npm', ['publish', '--access', 'public', '--tag', 'beta'], {
    cwd: pkgDir,
    stdio: 'inherit',
  });
}

let published = 0;
let skipped = 0;

for (const folder of folders) {
  const pkgDir = join(srcDir, folder);
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

  if (isAlreadyPublished(pkg.name, pkg.version)) {
    console.log(`[skip] ${pkg.name}@${pkg.version} already published`);
    skipped++;
    continue;
  }

  let attempt = 0;
  for (;;) {
    try {
      console.log(`[publish] ${pkg.name}@${pkg.version} (${published + skipped + 1}/${folders.length})`);
      publish(pkgDir);
      published++;
      await sleep(DELAY_BETWEEN_PUBLISHES_MS);
      break;
    } catch (err) {
      const message = String(err.stderr ?? err.message ?? err);
      const rateLimited = message.includes('E429') || message.includes('Too Many Requests');
      if (rateLimited && attempt < MAX_RETRIES_ON_RATE_LIMIT) {
        attempt++;
        const backoffMs = rateLimitBackoffMs(attempt);
        console.log(`[rate-limited] backing off ${backoffMs / 60_000}min before retrying ${pkg.name} (attempt ${attempt}/${MAX_RETRIES_ON_RATE_LIMIT})`);
        await sleep(backoffMs);
        continue;
      }
      console.error(`[failed] ${pkg.name}@${pkg.version} — stopping. Re-run this script to resume.`);
      process.exit(1);
    }
  }
}

console.log(`Done. Published ${published}, already had ${skipped} (total ${folders.length}).`);

#!/usr/bin/env node
/**
 * Registers this repository's Release workflow as the trusted publisher of every @benzenejs
 * package, so releases publish over OIDC instead of with a long-lived token.
 *
 * Run it from a laptop, logged in to npm as a maintainer — not from CI. npm requires two-factor
 * authentication to change a package's trust settings, and a granular token with "bypass 2FA" is
 * refused outright. The first package prompts for 2FA; tick "skip two-factor authentication for the
 * next 5 minutes" on that prompt and the rest go through without one. About 80 fit in the window, so
 * a full run takes two passes: when the window closes, run it again — it skips every package that is
 * already set up.
 *
 * It never replaces a different trusted publisher (npm allows one per package): a package already
 * trusting something else is reported and left alone. And it skips packages that are not on npm
 * yet, since trust can be registered only for a package that exists.
 *
 * Needs npm 11.15 or later (`npm install -g npm@latest`).
 *
 * Usage:  node scripts/trust-publishers.mjs [--dry-run]
 * Env:    TRUST_DELAY_MS   pause between registrations (default: 2000, as npm recommends)
 */
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { publishablePackages, registryState } from './workspace-packages.mjs';
import { compareVersions } from './promote-latest.mjs';

const REPOSITORY = 'daniellepelley/benzene-typescript';
const WORKFLOW = 'release.yml';
const MIN_NPM = '11.15.0';

const dryRun = process.argv.includes('--dry-run');
const delayMs = Number(process.env.TRUST_DELAY_MS ?? 2000);

function npm(args, options = {}) {
  return spawnSync('npm', args, { encoding: 'utf8', ...options });
}

/**
 * The package's trusted publishers, from `npm trust list --json`: one JSON object per configuration
 * (`{ id, type, file, repository, permissions }`), nothing at all when there are none.
 */
function trustedPublishers(name) {
  const result = npm(['trust', 'list', name, '--json']);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) throw Object.assign(new Error(`npm trust list exited ${result.status}`), { output });
  return (result.stdout.match(/^\{[\s\S]*?^\}/gm) ?? []).map((text) => JSON.parse(text));
}

function isOurs(config) {
  return config.repository === REPOSITORY && config.file === WORKFLOW;
}

async function main() {
  const npmVersion = npm(['--version']).stdout.trim();
  if (compareVersions(npmVersion, MIN_NPM) < 0) {
    console.error(`npm ${npmVersion} has no 'npm trust'; it needs ${MIN_NPM} or later. Run: npm install -g npm@latest`);
    process.exit(1);
  }

  const packages = publishablePackages();
  console.log(`${packages.length} publishable workspace package(s); checking their trusted publishers…`);

  let alreadyTrusted = 0;
  let toRegister = 0;
  let registered = 0;
  const notOnNpm = [];
  const trustsSomethingElse = [];

  for (const pkg of packages) {
    if (!(await registryState(pkg.name, pkg.version)).exists) {
      notOnNpm.push(pkg.name);
      continue;
    }

    let configs;
    try {
      configs = trustedPublishers(pkg.name);
    } catch (error) {
      process.stdout.write(error.output ?? '');
      console.error(
        `\nCould not read the trusted publishers of ${pkg.name}. Log in as a maintainer of the ` +
          `@benzenejs scope first (npm login), then run this again.`,
      );
      process.exit(1);
    }

    if (configs.some(isOurs)) {
      alreadyTrusted++;
      continue;
    }
    if (configs.length > 0) {
      trustsSomethingElse.push(`${pkg.name} (${configs.map((c) => `${c.repository ?? c.type} ${c.file ?? ''}`.trim()).join(', ')})`);
      continue;
    }

    console.log(`${pkg.name}: trust ${REPOSITORY} ${WORKFLOW}`);
    toRegister++;
    if (dryRun) continue;

    // Inherited output, because the first registration asks for 2FA in this terminal.
    const result = npm(
      ['trust', 'github', pkg.name, '--repo', REPOSITORY, '--file', WORKFLOW, '--allow-publish', '--yes'],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) {
      console.error(
        `\nnpm did not register ${pkg.name} (exit ${result.status}). If the 5-minute 2FA window has ` +
          `closed or npm is rate-limiting, wait a minute and run this again: the ${registered} ` +
          `registered so far, and every package already set up, are skipped.`,
      );
      process.exit(1);
    }
    registered++;
    if (delayMs > 0) await sleep(delayMs);
  }

  const verb = dryRun ? 'To register' : 'Registered';
  console.log(
    `\n${verb}: ${dryRun ? toRegister : registered}, ` +
      `already trusted: ${alreadyTrusted}, not on npm yet: ${notOnNpm.length}, ` +
      `trusting something else: ${trustsSomethingElse.length}, of ${packages.length}.`,
  );
  if (notOnNpm.length > 0) {
    console.log(`Not on npm yet, so nothing to trust (publish first):\n  ${notOnNpm.join('\n  ')}`);
  }
  if (trustsSomethingElse.length > 0) {
    console.log(
      `Left alone, because each already has a different trusted publisher (npm trust list <pkg>, ` +
        `then npm trust revoke, to replace it):\n  ${trustsSomethingElse.join('\n  ')}`,
    );
  }
}

await main();

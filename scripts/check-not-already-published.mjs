#!/usr/bin/env node
/**
 * Preflight for the release workflow: refuse to start a publish that cannot succeed, and say why.
 *
 * npm will not overwrite a published version. Re-running the release without bumping produces a
 * bare `npm error 404 ... could not be found or you do not have permission to access it` on the
 * FIRST package it reaches - which reads like a missing scope or a broken trusted-publisher
 * configuration, and sent a real investigation down that path. It actually means "this exact
 * version is already on the registry".
 *
 * This checks every workspace package's name@version against the registry before anything is
 * published, and fails with a message that names the version and the fix. It also reports the
 * mirror-image mistake - a partially published release, where some packages went out and others
 * did not - rather than leaving it to be discovered one 404 at a time.
 *
 * Read-only: a plain GET per package, no auth, no side effects.
 */
import { execFileSync } from 'node:child_process';

const workspaces = JSON.parse(
  execFileSync('npm', ['query', '.workspace'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
);

const published = [];
const unpublished = [];

for (const pkg of workspaces) {
  if (pkg.private === true) continue;

  const url = `https://registry.npmjs.org/${pkg.name.replace('/', '%2F')}`;
  const response = await fetch(url);

  if (response.status === 404) {
    unpublished.push(`${pkg.name}@${pkg.version} (package not on the registry yet)`);
    continue;
  }
  if (!response.ok) {
    console.error(`Could not read ${url}: HTTP ${response.status}. Skipping the preflight check.`);
    process.exit(0); // a registry blip must not block a release that would otherwise succeed
  }

  const metadata = await response.json();
  if (Object.keys(metadata.versions ?? {}).includes(pkg.version)) {
    published.push(`${pkg.name}@${pkg.version}`);
  } else {
    unpublished.push(`${pkg.name}@${pkg.version}`);
  }
}

if (published.length === 0) {
  console.log(`Nothing is published yet at these versions; ${unpublished.length} package(s) to publish.`);
  process.exit(0);
}

if (unpublished.length === 0) {
  console.error(
    `Every package is ALREADY published at this version — there is nothing to release.\n\n` +
      published.map((p) => `  ${p}`).join('\n') +
      `\n\nBump the version (npm version <new> --workspaces, or edit the version field) and ` +
      `re-run. npm never overwrites a published version; attempting it fails with a 404 that ` +
      `reads like a permissions or scope problem, which is why this check exists.`,
  );
  process.exit(1);
}

console.error(
  `This release is PARTIALLY published: ${published.length} package(s) are already on the ` +
    `registry at this version and ${unpublished.length} are not. Publishing now would fail on ` +
    `the first already-published package and leave the rest out.\n\n` +
    `Already published:\n` +
    published.map((p) => `  ${p}`).join('\n') +
    `\n\nNot yet published:\n` +
    unpublished.map((p) => `  ${p}`).join('\n') +
    `\n\nBump the version across all workspaces so the release is one consistent set.`,
);
process.exit(1);

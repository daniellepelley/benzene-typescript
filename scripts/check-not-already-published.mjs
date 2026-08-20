#!/usr/bin/env node
/**
 * Preflight for the release workflow: say, before anything is built or published, exactly which
 * packages this release would put on the registry — and refuse a release that has nothing to do.
 *
 * npm will not overwrite a published version, so the interesting states are "all new" (a normal
 * release), "partly out" (a previous run stopped midway — the publisher resumes and finishes it),
 * and "all out" (this version is fully released; publishing again can only fail). Only the last
 * is an error. Printing the split up front is what turns a half-finished release from a mystery
 * 404 on package #1 into a line that names the count.
 *
 * Read-only: a plain GET per package, no auth, no side effects.
 */
import { publishablePackages, isPublished } from './workspace-packages.mjs';

const packages = publishablePackages();
const published = [];
const unpublished = [];

for (const pkg of packages) {
  try {
    (await isPublished(pkg.name, pkg.version) ? published : unpublished).push(`${pkg.name}@${pkg.version}`);
  } catch (error) {
    // A registry blip must not block a release that would otherwise succeed; the publisher checks
    // again per package, and npm itself is the final authority on what may be published.
    console.error(`${error.message} — skipping the preflight check.`);
    process.exit(0);
  }
}

if (published.length === 0) {
  console.log(`Nothing is published yet at this version; ${unpublished.length} package(s) to publish.`);
  process.exit(0);
}

if (unpublished.length === 0) {
  console.error(
    `All ${published.length} package(s) are ALREADY published at this version — there is nothing ` +
      `to release.\n\nBump the version across every workspace and re-run. npm never overwrites a ` +
      `published version; attempting it fails with a 404 that reads like a permissions or scope ` +
      `problem, which is why this check exists.`,
  );
  process.exit(1);
}

console.log(
  `This release is PARTIALLY published: ${published.length} package(s) are already on the ` +
    `registry at this version, ${unpublished.length} are not. The publish step skips the ` +
    `former and publishes the latter, completing the set.\n\n` +
    `Already published:\n` +
    published.map((p) => `  ${p}`).join('\n') +
    `\n\nTo publish:\n` +
    unpublished.map((p) => `  ${p}`).join('\n'),
);

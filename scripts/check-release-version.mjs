#!/usr/bin/env node
// Verifies every publishable package under src/ shares one version (the release workflow publishes
// them in lockstep), and — when running against a `vX.Y.Z` tag push — that the tag matches it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = new URL('../src/', import.meta.url).pathname;
const folders = readdirSync(srcDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const versions = new Map();
for (const folder of folders) {
  const pkg = JSON.parse(readFileSync(join(srcDir, folder, 'package.json'), 'utf8'));
  versions.set(pkg.name, pkg.version);
}

const unique = new Set(versions.values());
if (unique.size !== 1) {
  console.error('Package versions are not consistent:', Object.fromEntries(versions));
  process.exit(1);
}
const version = [...unique][0];

const ref = process.env.GITHUB_REF ?? '';
if (ref.startsWith('refs/tags/')) {
  const tag = ref.slice('refs/tags/'.length);
  if (tag !== `v${version}`) {
    console.error(`Tag '${tag}' does not match package version '${version}' (expected v${version})`);
    process.exit(1);
  }
}

console.log(`All ${folders.length} packages at ${version}`);

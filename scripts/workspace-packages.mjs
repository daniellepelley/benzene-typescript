#!/usr/bin/env node
/**
 * The one list of packages a release touches, shared by every release script.
 *
 * `npm publish --workspaces` publishes every non-private workspace, so the preflight and the
 * publisher have to agree on exactly that set. They used to work it out separately — one via
 * `npm query .workspace`, the other by scanning `src/` — and neither was right: `npm query`
 * returns an EMPTY array when node_modules isn't installed (so the preflight silently passed
 * having checked nothing), and the `src/`-only scan would miss a publishable package added
 * under another workspace root.
 *
 * This reads the root package.json's `workspaces` globs and resolves them on disk, so it needs
 * no install and cannot quietly come back empty.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function readPackage(dir) {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function resolveGlob(pattern) {
  // The root package.json uses only `dir/*` and plain directory patterns. Anything else would
  // silently resolve to nothing here, so it's rejected rather than guessed at.
  if (!pattern.endsWith('/*')) {
    if (pattern.includes('*')) {
      throw new Error(`Unsupported workspace pattern '${pattern}' — only 'dir/*' and plain paths are handled.`);
    }
    return [join(root, pattern)];
  }
  const parent = join(root, pattern.slice(0, -2));
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name))
    .sort();
}

/** Every workspace package, private ones included, sorted by directory (npm's own order). */
export function workspacePackages() {
  const rootPkg = readPackage(root);
  const patterns = rootPkg?.workspaces ?? [];
  const packages = [];

  for (const pattern of patterns) {
    for (const dir of resolveGlob(pattern)) {
      const pkg = readPackage(dir);
      if (!pkg?.name) continue;
      packages.push({ dir, name: pkg.name, version: pkg.version, private: pkg.private === true });
    }
  }

  if (packages.length === 0) {
    throw new Error(`Found no workspace packages under ${root} — the workspace layout has moved.`);
  }
  return packages;
}

/** The packages a release actually publishes: every workspace that isn't private. */
export function publishablePackages() {
  const publishable = workspacePackages().filter((pkg) => !pkg.private);
  if (publishable.length === 0) {
    throw new Error('Every workspace package is private — there is nothing a release could publish.');
  }
  return publishable;
}

/** Whether `name@version` is already on the registry. A plain unauthenticated GET. */
export async function isPublished(name, version) {
  const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
  if (response.status === 404) return false; // package doesn't exist at all yet
  if (!response.ok) throw new Error(`Could not read the registry entry for ${name}: HTTP ${response.status}`);
  const metadata = await response.json();
  return Object.keys(metadata.versions ?? {}).includes(version);
}

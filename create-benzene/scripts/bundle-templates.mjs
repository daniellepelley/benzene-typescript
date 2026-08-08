#!/usr/bin/env node
// bundle-templates — makes `create-benzene` self-contained for publishing.
//
// The starter templates live once, in the repo's top-level `templates/` folder (consistent with the
// .NET/Go/Python ports). npm can't ship files from outside a package's own directory, so before the
// tarball is built we copy that folder into `create-benzene/templates/`, and afterwards we remove the
// copy so it never lingers in the working tree. Wired as `prepack`/`postpack` in package.json.
//
//   node scripts/bundle-templates.mjs            # copy ../../templates -> ./templates  (prepack)
//   node scripts/bundle-templates.mjs --clean    # remove ./templates                   (postpack)
//
// The bundled `create-benzene/templates/` is a build artifact — it is gitignored and must never be
// committed; the canonical source is the top-level `templates/` folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(scriptDir, '..');
const bundledDir = path.join(pkgDir, 'templates');
const repoTemplatesDir = path.resolve(pkgDir, '..', 'templates');

const clean = process.argv.includes('--clean');

if (clean) {
  fs.rmSync(bundledDir, { recursive: true, force: true });
  console.log('bundle-templates: removed bundled create-benzene/templates/');
} else {
  if (!fs.existsSync(repoTemplatesDir)) {
    throw new Error(`bundle-templates: canonical templates folder not found at ${repoTemplatesDir}`);
  }
  fs.rmSync(bundledDir, { recursive: true, force: true });
  fs.cpSync(repoTemplatesDir, bundledDir, { recursive: true });
  console.log(`bundle-templates: copied ${repoTemplatesDir} -> ${bundledDir} for packing`);
}

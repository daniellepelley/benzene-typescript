#!/usr/bin/env node
// Compiles every package under src/ to CommonJS (see tsconfig.build.json) and distributes each
// package's own compiled output — plus any non-.ts static assets it ships (e.g. the Mesh UI's
// .html files) — into that package's own dist/ directory, which is what "main"/"types" in each
// package.json point at for publishing.
//
// tsc compiles the whole src/ tree as one program into a single scratch `build/` directory
// (mirroring src/**'s folder structure), which is then fanned out per-package and removed.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(repoRoot, 'src');
const scratchDir = join(repoRoot, 'build');

rmSync(scratchDir, { recursive: true, force: true });

console.log('Compiling src/** to CommonJS...');
execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: repoRoot, stdio: 'inherit' });

const packageDirs = readdirSync(srcDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

for (const pkg of packageDirs) {
  const distDir = join(srcDir, pkg, 'dist');
  rmSync(distDir, { recursive: true, force: true });

  const compiledDir = join(scratchDir, pkg);
  if (existsSync(compiledDir)) {
    cpSync(compiledDir, distDir, { recursive: true });
  }

  copyStaticAssets(join(srcDir, pkg), distDir);
}

rmSync(scratchDir, { recursive: true, force: true });
console.log(`Built ${packageDirs.length} packages into src/*/dist/.`);

// Copies non-.ts, non-package.json files (e.g. .html assets read via __dirname at runtime) from a
// package's source tree into its dist/ tree, preserving relative position.
function copyStaticAssets(pkgSrcDir, distDir) {
  for (const entry of readdirSync(pkgSrcDir, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'package.json') continue;
    const from = join(pkgSrcDir, entry.name);
    if (entry.isDirectory()) {
      copyStaticAssets(from, join(distDir, entry.name));
      continue;
    }
    if (entry.name.endsWith('.ts')) continue;
    mkdirSync(distDir, { recursive: true });
    cpSync(from, join(distDir, entry.name));
  }
}

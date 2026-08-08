#!/usr/bin/env node
// Verifies each bundled template end-to-end: generate a sample project with the CLI, then typecheck it
// (`tsc --noEmit`) and run its component test (`vitest`) AGAINST THE LOCAL WORKSPACE PACKAGES.
//
// How local linking works: the sample project is generated into `create-benzene/.verify/<id>-svc`,
// inside this repo. Its generated package.json references the real (unpublished) `@benzene/*` names, but
// Node/tsc/vitest resolve them via the repo's own `node_modules/@benzene/*` symlinks (npm workspaces
// already link every `src/*` package there) by walking up from the generated dir. No `npm install` runs
// in the generated project — that would try the registry and fail — so this proves the exact published
// project shape typechecks and tests green with the packages linked locally.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(pkgDir, '..');
const verifyRoot = path.join(pkgDir, '.verify');
const cli = path.join(pkgDir, 'index.js');
const verifyVitestConfig = path.join(scriptDir, 'vitest.verify.config.mjs');

const TEMPLATES = ['aws-apigateway', 'aws-sqs'];

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

function generate(templateId, dest, extraArgs = []) {
  run('node', [cli, dest, '--template', templateId, '--overwrite', ...extraArgs], repoRoot);
}

fs.rmSync(verifyRoot, { recursive: true, force: true });
fs.mkdirSync(verifyRoot, { recursive: true });

for (const templateId of TEMPLATES) {
  console.log(`\n=== ${templateId} : generate + typecheck + test ===`);
  const dest = path.join(verifyRoot, `${templateId}-svc`);
  generate(templateId, dest);

  console.log(`--- tsc --noEmit (${templateId}) ---`);
  run('npx', ['tsc', '--noEmit', '-p', path.join(dest, 'tsconfig.json')], repoRoot);

  console.log(`--- vitest run (${templateId}) ---`);
  run('npx', ['vitest', 'run', '--root', dest, '--config', verifyVitestConfig], repoRoot);
}

// Prove --no-tests prunes the test project + its devDeps and still typechecks.
console.log(`\n=== aws-sqs --no-tests : generate + typecheck ===`);
const noTestsDest = path.join(verifyRoot, 'aws-sqs-notests-svc');
generate('aws-sqs', noTestsDest, ['--no-tests']);
if (fs.existsSync(path.join(noTestsDest, 'test'))) {
  throw new Error('--no-tests still emitted a test/ directory');
}
const prunedPkg = JSON.parse(fs.readFileSync(path.join(noTestsDest, 'package.json'), 'utf8'));
if (prunedPkg.scripts?.test || prunedPkg.devDependencies?.vitest) {
  throw new Error('--no-tests did not prune the test script / vitest devDependency');
}
run('npx', ['tsc', '--noEmit', '-p', path.join(noTestsDest, 'tsconfig.json')], repoRoot);

console.log('\nAll templates verified: generated, typechecked, and tests green against local packages.');

/**
 * Bundles each Lambda entry point in `functions/` into a self-contained zip under `artifacts/`, ready for
 * the Terraform stack in `deploy/` to upload. One zip per function (`<name>.zip`, each containing a single
 * `index.js` exporting `handler`), matching the `*_zip` variables in `deploy/variables.tf`.
 *
 * The AWS SDK v3 (`@aws-sdk/*`) is marked external — the `nodejs22.x` managed runtime already ships it, so
 * bundling it in would just bloat the zip. Everything else (the `@benzene/*` workspace packages and this
 * example's own code) is bundled in, so the zip has no `node_modules` dependency at all.
 *
 * Output is an ESM `index.mjs` (matching the ESM `@benzene/*` sources) with a `handler` export, which
 * Lambda's nodejs22.x runtime loads via the `index.handler` handler string.
 *
 * Usage: `node scripts/bundle.mjs` (or `npm run bundle` from this example). Requires the `zip` CLI.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleDir = dirname(dirname(fileURLToPath(import.meta.url)));
const functionsDir = join(exampleDir, 'functions');
const artifactsDir = join(exampleDir, 'artifacts');

// The seven deployable functions: the six Cloud Services + the mesh. Names match deploy/variables.tf's
// `<name>_zip` and deploy/main.tf's `local.services` keys (mesh is separate).
const functions = ['orders', 'payments', 'shipping', 'inventory', 'notifications', 'analytics', 'mesh'];

rmSync(artifactsDir, { recursive: true, force: true });
mkdirSync(artifactsDir, { recursive: true });

for (const name of functions) {
  const stageDir = join(artifactsDir, name);
  mkdirSync(stageDir, { recursive: true });

  await build({
    entryPoints: [join(functionsDir, `${name}.ts`)],
    outfile: join(stageDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    minify: true,
    sourcemap: false,
    // Provided by the managed runtime — don't bundle the SDK.
    external: ['@aws-sdk/*'],
    logLevel: 'info',
  });

  // Zip the single index.mjs at the archive root, so the Lambda handler is `index.handler`.
  execFileSync('zip', ['-j', '-q', join(artifactsDir, `${name}.zip`), join(stageDir, 'index.mjs')], {
    stdio: 'inherit',
  });
  rmSync(stageDir, { recursive: true, force: true });
  console.log(`✓ artifacts/${name}.zip`);
}

console.log(`\nBundled ${functions.length} functions into ${artifactsDir}`);

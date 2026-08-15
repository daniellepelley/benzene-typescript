/**
 * Bundles each Function App entry point in `functions/` into a self-contained zip under `artifacts/`,
 * ready for the Terraform stack in `deploy/` (via `az functionapp deployment source config-zip`) to
 * upload. One zip per Function App (`<name>.zip`), each containing:
 *   - `index.js` — the bundled trigger registrations (esbuild bundles the `@benzenejs/*` workspace
 *     packages, the `@azure/*` SDK clients, and this example's own code — no `node_modules` needed at
 *     runtime, matching `aws-lambda-mesh`'s zero-`node_modules` zips);
 *   - `host.json` — the shared config (`routePrefix: ""`, see `../host.json`) every Function App needs;
 *   - `package.json` — `{ "main": "index.js" }` (CommonJS, no `"type": "module"`), the minimum the Azure
 *     Functions Node v4 programming model needs to load the bundle and run its
 *     `app.http(...)`/`app.serviceBusQueue(...)`/etc. registrations;
 *   - (mesh only) `mesh-ui.html` / `mesh-spec-ui.html` — `@benzenejs/mesh-ui`'s two pages are read with a
 *     runtime `readFileSync` relative to its own module directory, not compiled in, so esbuild can't see
 *     that read; they're copied next to `index.js` by hand (see `meshUiAssets` below).
 *
 * CJS, not ESM: `@azure/functions`' own prebuilt module is CommonJS and does a handful of `require(...)`
 * calls (including of Node builtins like `util`) that only resolve correctly once actually bundled AS
 * CommonJS — esbuild's `format: 'esm'` output wraps those in a `Dynamic require of "..." is not
 * supported` shim that throws at load time for exactly this shape of dependency. `format: 'cjs'` avoids
 * the shim entirely (a real `require`), and is also the default/most broadly supported module format for
 * an Azure Functions Node app.
 *
 * Usage: `node scripts/bundle.mjs` (or `npm run bundle` from this example). Requires the `zip` CLI.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleDir = dirname(dirname(fileURLToPath(import.meta.url)));
const functionsDir = join(exampleDir, 'functions');
const artifactsDir = join(exampleDir, 'artifacts');
const hostJson = join(exampleDir, 'host.json');
const require = createRequire(import.meta.url);

// @benzenejs/mesh-ui's MeshUiMiddleware/MeshSpecUiMiddleware read these two HTML pages with a runtime
// `readFileSync(join(__dirname, ...))` (they're served as-is, not compiled in) — esbuild can't see that
// read (it's not an import), so it never bundles them. They need copying next to the mesh bundle's
// index.js by hand, or /mesh-ui and /mesh-spec-ui.html 404 with ENOENT on a real deploy.
const meshUiDir = dirname(require.resolve('@benzenejs/mesh-ui/package.json'));
const meshUiAssets = ['mesh-ui.html', 'mesh-spec-ui.html'].map((f) => join(meshUiDir, 'dist', f));

// The seven deployable Function Apps: the six Cloud Services + the mesh. Names match deploy/main.tf's
// `local.services` keys (mesh is separate).
const functions = ['orders', 'payments', 'shipping', 'inventory', 'notifications', 'analytics', 'mesh'];

rmSync(artifactsDir, { recursive: true, force: true });
mkdirSync(artifactsDir, { recursive: true });

for (const name of functions) {
  const stageDir = join(artifactsDir, name);
  mkdirSync(stageDir, { recursive: true });

  await build({
    entryPoints: [join(functionsDir, `${name}.ts`)],
    outfile: join(stageDir, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    sourcemap: false,
    // @azure/functions-core is itself marked "external" inside @azure/functions' own prebuilt bundle
    // (it's the worker-provided interop module the real Azure Functions Node host injects at runtime,
    // not an installable package) — esbuild can't resolve it locally and shouldn't try to bundle it.
    external: ['@azure/functions-core'],
    logLevel: 'info',
  });

  copyFileSync(hostJson, join(stageDir, 'host.json'));
  writeFileSync(join(stageDir, 'package.json'), JSON.stringify({ name: `azure-functions-mesh-${name}`, main: 'index.js' }, null, 2));
  if (name === 'mesh') {
    for (const asset of meshUiAssets) {
      copyFileSync(asset, join(stageDir, asset.split('/').pop()));
    }
  }

  execFileSync('zip', ['-jr', '-q', join(artifactsDir, `${name}.zip`), stageDir], { stdio: 'inherit' });
  // -j above would junk paths and drop host.json's directory nesting; host.json/package.json/index.js are
  // all directly inside stageDir, so junking paths is exactly what we want (a flat zip root).
  rmSync(stageDir, { recursive: true, force: true });
  console.log(`✓ artifacts/${name}.zip`);
}

console.log(`\nBundled ${functions.length} Function Apps into ${artifactsDir}`);

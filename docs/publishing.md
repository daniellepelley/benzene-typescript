# Publishing the packages

Benzene ships as 129 independent packages on npm under the `@benzenejs` scope (one per `src/*`
folder — see the workspace layout in the root README). They are released **in lockstep at one
shared version** and published by the [`release`](../.github/workflows/release.yml) workflow using
**npm trusted publishing** — OpenID Connect, so no npm tokens are stored in the repository.

## Pre-1.0: every release is a beta, and never resolves by default

Until Benzene for TypeScript reaches 1.0, every version carries a prerelease identifier —
`0.1.0-beta.1`, `0.1.0-beta.2`, …, `0.1.0-rc.1`, never a bare `0.1.0` — **and** is published under
the npm dist-tag `beta`, never `latest`. Both matter, for different reasons:

- The dist-tag is what actually protects consumers: `npm install @benzenejs/core` resolves the
  `latest` tag by default, and since we never publish one, that command **fails outright** rather
  than silently installing a prerelease. Only an explicit `npm install @benzenejs/core@beta` or
  `npm install @benzenejs/core@0.1.0-beta.1` will resolve it.
- The prerelease version segment makes that intent visible in the version number itself (matching
  the `-beta.N` convention the .NET port already uses in `VERSIONING.md`), and means that if a
  `latest` tag is ever set by mistake, semver-aware tooling still treats it as a prerelease.

Inter-package dependencies (`@benzenejs/abstractions: 0.1.0-beta.1`, etc.) stay pinned to the exact
shared version — a coordinated bump keeps the whole stack installable together.

## What a release does

Pushing a tag `vX.Y.Z` (or running the workflow manually) triggers two jobs:

1. **build-and-verify** — checks that all 129 `src/*/package.json` files carry the *same* version
   (and, for a tag, that it equals `v<version>`), builds every package to CommonJS (`npm run
   build`), typechecks, runs the full test suite, and does a `--dry-run` pack of every package.
2. **publish** — rebuilds (cheap — a few seconds) and runs `npm publish --workspaces --access
   public --tag beta` once, authenticating via OIDC. The private workspaces under `test/` and
   `examples/` are skipped automatically (`npm publish --workspaces` only publishes non-private
   ones); npm routes each `@benzenejs/*` package to its own project and verifies the trusted-publisher
   identity per package.

## One-time maintainer setup

Unlike PyPI, **npm cannot pre-register a trusted publisher for a package that doesn't exist yet** —
there's no "pending publisher" equivalent. The package has to be created by one real, manual publish
first, and only then can trusted publishing be configured for it.

1. **Create every package with one manual publish.** Locally, with npm CLI ≥ 11.5.1 and Node ≥
   22.14 (`npm install -g npm@latest` if unsure):

   ```bash
   npm login
   npm run build
   npm publish --workspaces --access public --tag beta
   ```

   This single command creates and publishes all 129 `@benzenejs/*` packages at once — it is **not**
   a per-package manual step. `--access public` is required the first time each package is created
   (npm defaults new scoped packages to private, which would need a paid plan).

2. **Register a trusted publisher for each package.** On npmjs.com, for each package —
   `npm.com/package/@benzenejs/<name>/access` → **Trusted Publisher** → **GitHub Actions** — add:

   | Field | Value |
   |---|---|
   | Organization or user | `daniellepelley` |
   | Repository | `benzene-typescript` |
   | Workflow filename | `release.yml` |
   | Allowed actions | `npm publish` |
   | Environment name | *(leave blank unless you add a matching `environment:` to the `publish` job for required-reviewer approval gating)* |

   This is a genuinely per-package, click-through step for all 129 packages — there is no bulk API
   for it today. Do it in one sitting after the manual publish above.

## Cutting a release

1. Bump the version in **all 129** `src/*/package.json` (and the matching `@benzenejs/*` dependency
   pins in any package that depends on another) to the new version — they must match; the workflow
   enforces it. Pre-1.0, that means a prerelease identifier every time: `0.1.0-beta.2`,
   `0.1.0-beta.3`, … (bump the counter), or `0.1.0-rc.1` once the `0.1.0` line is stabilizing. Only
   drop the prerelease suffix (ship a bare `X.Y.Z`) — and start publishing under the `latest`
   dist-tag instead of `beta` — for an actual 1.0-and-beyond stable release, deliberately decided,
   not as a default. `node scripts/sync-workspace-paths.mjs` doesn't need re-running for a version
   bump — only after adding/removing/renaming a package.
2. Commit, then tag and push:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. Watch the `Release` workflow. On success, `npm install @benzenejs/http@<version>` (and friends)
   resolves the new version, pulling its `@benzenejs/*` dependencies from the registry. A bare
   `npm install @benzenejs/http` continues to fail outright (no `latest` tag), same as before.

## Trying it without publishing

- **Build and pack locally** exactly as CI does — no credentials needed:

  ```bash
  npm run build
  npm publish --workspaces --dry-run --access public
  ```

- **A single package**, if you only want to inspect one tarball:

  ```bash
  npm pack --dry-run --workspace=@benzenejs/core
  ```

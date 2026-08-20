# Publishing the packages

Benzene ships as 129 independent packages on npm under the `@benzenejs` scope (one per `src/*`
folder — see the workspace layout in the root README). They are released **in lockstep at one
shared version** by the [`release`](../.github/workflows/release.yml) workflow, which authenticates
with the `NPM_TOKEN` repository secret and lets **npm trusted publishing** (OpenID Connect) take
over for any package that has a trusted publisher registered.

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
2. **publish** — rebuilds (cheap — a few seconds) and runs `node scripts/publish-workspaces.mjs`,
   which publishes every non-private workspace that isn't already on the registry at this version,
   one at a time, under the `beta` dist-tag. The private workspaces under `test/` and `examples/`
   are skipped, same as `npm publish --workspaces` would.

   **The publish is resumable, and that is the point.** npm can never re-publish a version, so a
   plain `npm publish --workspaces` is unrecoverable if it stops partway: every re-run dies on the
   first package it already published, and the packages it never reached stay missing. (That is
   exactly what happened to `0.1.0-beta.1` — 25 packages published, 104 not.) Because the script
   asks the registry what is already out and skips it, finishing a half-done release is just
   re-running the workflow.

## Authentication: why a token, and where OIDC fits

Unlike PyPI, **npm cannot pre-register a trusted publisher for a package that doesn't exist yet** —
there's no "pending publisher" equivalent. A package has to be created by a real, token-authenticated
publish first, and only then can trusted publishing be configured for it. So the workflow cannot run
on OIDC alone: it needs a token.

1. **Set the `NPM_TOKEN` secret** (required). On npmjs.com → **Access Tokens** → **Generate New
   Token** → **Granular Access Token**, give it **Read and write** access to the `@benzenejs`
   scope, then add it to the repository as the `NPM_TOKEN` secret (Settings → Secrets and variables
   → Actions). The workflow checks it is present before building and fails with a clear message if
   it isn't — an absent secret otherwise leaves `NODE_AUTH_TOKEN` at `actions/setup-node`'s literal
   `XXXXX-XXXXX-XXXXX-XXXXX` placeholder, and every publish 404s as if the scope didn't exist.

   `--access public` is passed on every publish because npm defaults new scoped packages to
   private, which would need a paid plan.

2. **Optionally, register a trusted publisher per package.** Once a package exists on the registry,
   registering this repository and workflow as its trusted publisher means npm authenticates that
   package's publishes over OIDC and ignores the token entirely — worth doing, but strictly a
   hardening step, and one that can only ever cover packages that already exist. On npmjs.com, for
   each package —
   `npm.com/package/@benzenejs/<name>/access` → **Trusted Publisher** → **GitHub Actions** — add:

   | Field | Value |
   |---|---|
   | Organization or user | `daniellepelley` |
   | Repository | `benzene-typescript` |
   | Workflow filename | `release.yml` |
   | Allowed actions | `npm publish` |
   | Environment name | *(leave blank unless you add a matching `environment:` to the `publish` job for required-reviewer approval gating)* |

   This is a genuinely per-package, click-through step — there is no bulk API for it today.

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

## If a release stops partway

npm rate-limits bulk publishing, and 129 brand-new packages is enough to trip it. When that
happens the run fails with `E429` and a count of what is left, and **nothing is broken**:

- **Re-run the `Release` workflow** (Actions → the failed run → *Re-run failed jobs*, or
  *Run workflow* again). Already-published packages are skipped, so the run picks up exactly where
  the last one stopped.
- Within a run, the script waits out rate limits for up to an hour before giving up; set
  `RATE_LIMIT_BUDGET_MS` on the step to change that.

The same script publishes from a laptop, if you'd rather finish a release by hand:

```bash
npm login
npm run build
npm run publish:workspaces -- --dry-run   # see the plan; drop the flag to actually publish
```

It reads the registry to decide what to do, so running it locally and re-running the workflow are
interchangeable, and neither can double-publish. `node scripts/check-not-already-published.mjs`
prints the same split without publishing anything.

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

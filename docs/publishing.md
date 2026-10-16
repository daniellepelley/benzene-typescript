# Publishing the packages

Benzene ships as 129 independent packages on npm under the `@benzenejs` scope (one per `src/*`
folder — see the workspace layout in the root README). They are released **in lockstep at one
shared version** by the [`release`](../.github/workflows/release.yml) workflow, which authenticates
through **npm trusted publishing** (OpenID Connect): no stored secret, for every package that has
this repository registered as its trusted publisher. A token is needed only to create a package.

## Pre-1.0: every release is a beta, and `latest` follows it

Until Benzene for TypeScript reaches 1.0, every version carries a prerelease identifier —
`0.1.0-beta.1`, `0.1.0-beta.2`, …, `0.1.0-rc.1`, never a bare `0.1.0` (matching the `-beta.N`
convention the .NET port uses in `VERSIONING.md`). The version string is what says "early testing,
not production"; semver-aware tooling treats it as a prerelease wherever it is installed from.

Each release publishes under the `beta` dist-tag and then points **`latest`** at the same version,
so `npm install @benzenejs/core` with no tag installs the newest release. This was not always the
policy: the release used to publish under `beta` only, so that a plain install would fail. npm
defeats that — it sets `latest` on a package's first publish whatever tag is passed — and the result
was worse than either choice: after `0.1.0-beta.2`, the 104 packages it created installed
`0.1.0-beta.2` by default, while the 25 first published at `0.1.0-beta.1` still installed the August
build. Moving `latest` on every release keeps one command meaning one release.

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
   are skipped, same as `npm publish --workspaces` would. Then it runs
   `node scripts/promote-latest.mjs`, which points `latest` at the version just published for every
   package not already there. It never moves `latest` backwards, and it fails if any package is
   missing at this version (finish the publish first). To retry just that step, re-run the publish
   job: it finds nothing left to publish and goes straight on to `latest`. (The **Promote latest**
   workflow runs the step alone too, with an optional dry run, but it needs `NPM_TOKEN`; see below.)

   **The publish is resumable, and that is the point.** npm can never re-publish a version, so a
   plain `npm publish --workspaces` is unrecoverable if it stops partway: every re-run dies on the
   first package it already published, and the packages it never reached stay missing. (That is
   exactly what happened to `0.1.0-beta.1` — 25 packages published, 104 not.) Because the script
   asks the registry what is already out and skips it, finishing a half-done release is just
   re-running the workflow.

## Authentication: trusted publishing, and when a token is still needed

Releases publish through **npm trusted publishing**. The publish job has `id-token: write`; npm
exchanges the GitHub Actions identity for a short-lived token scoped to one package, provided that
package names this repository and `release.yml` as its trusted publisher. There is no long-lived
secret to leak or rotate, and every publish carries a provenance statement. Moving `latest` works the
same way.

npm is retiring direct publishing with "bypass 2FA" granular tokens (from January 2027), so trusted
publishing is the path to keep releases automated.

### Registering the trusted publishers (once, by a maintainer)

Trust can only be registered for a package that already exists, and only by a logged-in maintainer
with two-factor authentication: npm refuses a bypass-2FA token for it, so this cannot run in CI.
From a clone, with npm 11.15 or later:

```bash
npm install -g npm@latest
npm login
node scripts/trust-publishers.mjs --dry-run   # what it would register
node scripts/trust-publishers.mjs
```

For each package it registers GitHub Actions, repository `daniellepelley/benzene-typescript`,
workflow `release.yml`, allowed to publish. The first registration asks for 2FA; tick **skip
two-factor authentication for the next 5 minutes** and the rest go straight through. About 80 fit in
that window, so expect to run it twice: it skips every package already set up, and leaves alone (and
lists) any package that trusts something else, since npm allows only one trusted publisher per
package. `npm trust list @benzenejs/<name>` shows a package's setting.

The same setting is on npmjs.com, per package, under **Settings → Trusted Publisher → GitHub
Actions**:

| Field | Value |
|---|---|
| Organization or user | `daniellepelley` |
| Repository | `benzene-typescript` |
| Workflow filename | `release.yml` |
| Allowed actions | `npm publish` |
| Environment name | *(blank, unless you add a matching `environment:` to the `publish` job for required-reviewer approval)* |

### The `NPM_TOKEN` secret: optional, for new packages

npm has no "pending publisher": a package that is not on npm yet **cannot** be created by trusted
publishing. So the workflow still accepts an `NPM_TOKEN` secret (a granular access token with read
and write access to the `@benzenejs` scope). When it is set, npm tries trusted publishing first and
falls back to the token. When it is not, a release that would add a package stops before publishing
anything and names the new package, rather than releasing everything else and leaving it behind.

Once every package is registered, delete the secret. The **Promote latest** workflow is the one
thing that then stops working: npm allows one trusted publisher per package and that is `release.yml`,
so a separate workflow file cannot move `latest` over OIDC. Re-running the Release publish job does
the same job.

`--access public` is passed on every publish because npm defaults new scoped packages to private,
which would need a paid plan.

### Adding a package

A new `src/*` package has to reach npm once before trusted publishing can take it over. Either keep
`NPM_TOKEN` set for the release that adds it, or publish its first version by hand and then register
it:

```bash
npm run build
cd src/<Benzene.NewPackage>
npm publish --access public --tag beta   # prompts for 2FA
cd ../..
node scripts/trust-publishers.mjs        # registers just the new one; the rest are skipped
```

Then run the Release workflow as usual. It skips what is already on npm, so the hand-published
package is not published twice.

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
   resolves the new version, pulling its `@benzenejs/*` dependencies from the registry, and so does
   a bare `npm install @benzenejs/http`, through `latest`.

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

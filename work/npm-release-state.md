# The npm release is half-published, and the error message hid it

**Status: the workflow is fixed and the decision is taken — finish `0.1.0-beta.1`. What remains is
one maintainer action (the `NPM_TOKEN` secret) and a workflow re-run.**

## What is actually on npm

`0.1.0-beta.1` was published on 2026-08-14 and **stopped partway through**. npm publishes
workspaces alphabetically, and the run died at `@benzenejs/azure-cosmos-db`:

| | Count | Examples |
|---|---|---|
| Published at `0.1.0-beta.1` | 25 | `abstractions`, `ajv`, `aws-lambda*`, `azure-cosmos-db` |
| **Not on the registry at all** | 104 | **`core`**, **`results`**, `http`, `testing`, `mesh-*`, `clients-*` |

Verified directly against the registry:

```
GET registry.npmjs.org/@benzenejs/abstractions   -> 200
GET registry.npmjs.org/@benzenejs/azure-cosmos-db -> 200
GET registry.npmjs.org/@benzenejs/core            -> 404
GET registry.npmjs.org/@benzenejs/results         -> 404
```

So `npm install @benzenejs/core` fails today. The port is not installable from npm.

## Why the re-run failed, and why the 404 was misread

The 2026-08-19 re-run failed with:

```
npm error 404 Not Found - PUT https://registry.npmjs.org/@benzenejs%2fabstractions
npm error 404  The requested resource '@benzenejs/abstractions@0.1.0-beta.1' could not be
               found or you do not have permission to access it.
```

That reads as "you may not overwrite this published version", and the first pass at this concluded
exactly that. It is **not** what happened: overwriting an existing version returns `403
EPUBLISHCONFLICT`, *"You cannot publish over the previously published versions"*. A `404` on `PUT`
for a package that a `GET` resolves publicly means the registry did not accept our identity at all.

The job log says why, one line above the failure:

```
env:
  NODE_AUTH_TOKEN: XXXXX-XXXXX-XXXXX-XXXXX
```

That is `actions/setup-node`'s literal placeholder, written into the generated `.npmrc` because the
workflow passed no token. It expected OIDC (trusted publishing) to authenticate instead — but npm
only uses OIDC for a package that already has a Trusted Publisher registered, and none had been
registered (step 2 of the old one-time setup was never done). npm fell back to the placeholder
token, and the registry answered `404`.

The version conflict was real too, and would have been the *next* failure. It was the second
blocker, not the first.

## What changed here

- **`NPM_TOKEN` is now the workflow's credential**, checked for presence before anything is built,
  with `id-token: write` still granted so trusted publishing takes over per package where it is
  registered. This is the only route that can create the 104 packages that do not exist yet: npm
  has no "pending publisher", so a package that isn't on the registry cannot be published by OIDC.
- **The publish step is resumable** — `scripts/publish-workspaces.mjs` skips whatever is already on
  the registry at the current version and publishes the rest, one at a time, backing off on npm's
  rate limit. A run that stops partway is finished by re-running the workflow. `npm publish
  --workspaces` could not do this, and that is why one interrupted publish bricked every
  subsequent attempt.
- **The preflight reports rather than blocks** on a partial release, since a partial release is now
  a recoverable state; it fails only when every package is already published at this version.
- `scripts/workspace-packages.mjs` is the single source of the package list. The preflight used to
  get it from `npm query .workspace`, which returns an empty array when `node_modules` is missing —
  so it could silently pass having checked nothing.

## The decision taken

**Finish `0.1.0-beta.1`**: publish the missing 104 at the current version rather than bumping the
whole set to `0.1.0-beta.2`.

The trade-off, recorded honestly: the 25 packages already on the registry are the 14 August build,
and `@benzenejs/abstractions` has changed since (`BenzeneError` moved into it and
`IBenzeneResult.errors` widened to `BenzeneError[]`). Consumers of `0.1.0-beta.1` will therefore get
old abstractions against new dependents. The next bump to `0.1.0-beta.2` publishes all 129 as one
consistent set and supersedes it under the `beta` tag.

## What is left to do

1. Create a granular access token on npmjs.com with **read and write** on the `@benzenejs` scope,
   and add it as the `NPM_TOKEN` repository secret.
2. Re-run the `Release` workflow. Expect it to publish 104 packages and skip 25 — and expect npm to
   rate-limit somewhere in the middle, which is what the re-run-to-resume behaviour is for.
3. Optional hardening, once every package exists: register a Trusted Publisher per package, after
   which OIDC authenticates those publishes and the token stops being exercised.

# The npm release is half-published, and the error message hid it

**Status: needs an owner decision. No publish was attempted from this session.**

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

## Why nobody noticed

The 2026-08-19 re-run failed with:

```
npm error 404 Not Found - PUT https://registry.npmjs.org/@benzenejs%2fabstractions
npm error 404  The requested resource '@benzenejs/abstractions@0.1.0-beta.1' could not be
               found or you do not have permission to access it.
```

That is npm's message for "you may not overwrite this published version", but it reads like a
missing scope or a broken trusted-publisher configuration — which is where an investigation
naturally goes, and it never reaches the real story (the first package is already out, and
the other 104 are still missing).

`scripts/check-not-already-published.mjs` now runs in the release workflow's build-and-verify
job and reports exactly this, by name and count, before anything is published.

## The decision to make

Publishing the missing 104 at `0.1.0-beta.1` would complete the set, but it would be an
**inconsistent** one: `@benzenejs/abstractions` on the registry is the 14 August build, and
abstractions has changed since (`BenzeneError` moved into it and `IBenzeneResult.errors`
widened to `BenzeneError[]`). A consumer would get old abstractions with new dependents.

The safe route is to bump every workspace to `0.1.0-beta.2` and publish the whole set as one
consistent release. That is a release decision with an irreversible outward-facing effect
(npm versions cannot be reused), so it is left here rather than taken.

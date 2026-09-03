# work/ — working docs

Temporary planning and design notes for work that is genuinely in flight. Nothing here describes
what the port *does* — that lives in `docs/` and `docs/capability-matrix.md`.

Convention: when a plan's work ships, the doc does not stay here — it moves to
[`archive/`](archive/README.md), stamped with the evidence, and any live remainder is extracted
into a `remaining-items.md` here (created on demand; deleted when it empties). If a doc is in this
folder, it is expected to still be actionable.

Current contents:

- `dotnet-parity-plan-2026-09.md` — the prioritized plan (4 waves + do-not-port + blocked-upstream
  watch list) for catching this port up to benzene-dotnet's post-2026-08-20 fix rounds and the
  spec/conformance changes, with per-item TS-source evidence and .NET `R<round> #<n>` citations.
- `npm-release-state.md` — the npm release of `0.1.0-beta.1` is half-published (verified
  2026-08-20: `@benzenejs/abstractions` resolves, `@benzenejs/core` is 404); one maintainer action
  (the `NPM_TOKEN` secret) plus a workflow re-run remain.

(`remaining-items.md` was deleted 2026-09-03 per its own convention: its last two entries —
standalone-client typed wiring and error-payload bodies — shipped with W3.12 of the parity plan.)

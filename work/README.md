# work/ — working docs

Temporary planning and design notes for work that is genuinely in flight. Nothing here describes
what the port *does* — that lives in `docs/` and `docs/capability-matrix.md`.

Convention: when a plan's work ships, the doc does not stay here — it moves to
[`archive/`](archive/README.md), stamped with the evidence, and any live remainder is extracted
(see `remaining-items.md`). If a doc is in this folder, it is expected to still be actionable.

Current contents:

- `npm-release-state.md` — `0.1.0-beta.1` is half-published (`@benzenejs/core` is still 404);
  every workspace is now `0.1.0-beta.2`, verified for release. One maintainer action remains: an
  `NPM_TOKEN` that publishes without a one-time password (the 2026-10-13 run stopped on `EOTP`).
- `remaining-items.md` — live remainders extracted from archived plans.

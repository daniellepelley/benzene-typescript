# work/archive — actioned working docs

Plans and design notes whose work has shipped. They are kept as history, stamped with the evidence
that the work is done; the truth about what the port does now lives in the code, `docs/`, and
`docs/capability-matrix.md`. One line per file:

- `typed-outbound-responses.md` — design note for typed outbound responses (`TResponse` through the
  send path). Archived 2026-08-20: Option A shipped in `@benzenejs/clients` +
  `@benzenejs/clients-in-process` (`BenzeneMessageClientResponse`, `asBenzeneResult`, envelope-aware
  sender, in-process converter); its two open questions moved to `work/remaining-items.md`.
- `npm-release-state.md` — why `0.1.0-beta.1` was half-published and the 2026-10-13 run stopped on
  `EOTP`. Archived 2026-10-15: `0.1.0-beta.2` of all 130 packages is on npm (Release run
  38694481287, from `13f30ee`); its two remainders are in `work/remaining-items.md`.

# Vendored conformance fixtures

Snapshot of `docs/specification/conformance/*.json` from the **benzene** repo (the canonical,
language-neutral source of truth). Do not edit here. `SPEC_VERSION` records the source commit; the
`conformance-drift-check` workflow (and `ConformanceDriftTest`) fail if this snapshot has drifted
from the canonical copy.

Re-vendor: `cp <benzene>/docs/specification/conformance/*.json test/Benzene.Core.Test/Conformance/fixtures/`
and update `SPEC_VERSION` to the new benzene commit.

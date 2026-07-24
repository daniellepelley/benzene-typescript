/**
 * Port of Benzene.CloudService.Probe - an external, black-box HTTP conformance probe for the Cloud Service
 * Profile (R1-R8): it hits a live service's `/benzene/*` surfaces and returns a tri-state
 * (Satisfied/NotSatisfied/Inconclusive) assessment built only from what it observed, never trusting the
 * service's own claims. Self-contained (no Benzene package deps); `HttpClient` -> an injectable `fetch`
 * (`@benzene/health-checks-http`'s adaptation) with a `baseUrl`.
 */
export * from './CloudServiceProbePaths';
export * from './CloudServiceProbeOptions';
export * from './CloudServiceProbeReport';
export * from './CloudServiceProbe';

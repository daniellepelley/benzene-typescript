/** Port of Benzene.CloudService.Probe.CloudServiceProbePaths. */

/**
 * The default service standard's well-known HTTP paths (mandatory-by-default under the Cloud Service
 * Profile's R7).
 *
 * These three string literals deliberately duplicate `Benzene.CloudService.CloudServicePaths` rather than
 * referencing it: this package must stay usable against ANY Benzene Cloud Service reachable over HTTP -
 * including non-.NET ports, since the profile is a language-neutral spec - so it cannot take a reference on
 * the wiring package it exists to independently audit. The duplication is the point.
 */
export const CloudServiceProbePaths = {
  /** The wire-envelope endpoint (profile R4). */
  invoke: '/benzene/invoke',

  /** The derived spec document (profile R5). */
  spec: '/benzene/spec',

  /** The aggregated health check response (profile R3). */
  health: '/benzene/health',
} as const;

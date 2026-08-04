/** Port of Benzene.CloudService.CloudServicePaths. */

/**
 * The default service standard's well-known HTTP paths (docs/specification/design-principles.md §5,
 * made mandatory-by-default by the Cloud Service Profile's R7). Every path remains configurable via
 * {@link ICloudServiceBuilder}, but a deployment that relocates a surface accepts the documented
 * degradation — fleet tooling assumes these defaults.
 *
 * C# `static class` of `const string`s → a frozen object (the port convention); the string VALUES are
 * the contract.
 */
export const CloudServicePaths = {
  /** The wire-envelope endpoint (profile R4): `{topic, headers, body}` in, `{statusCode, headers, body}` out. */
  invoke: '/benzene/invoke',

  /** The derived spec document (profile R5). */
  spec: '/benzene/spec',

  /** The aggregated health check response (profile R3). */
  health: '/benzene/health',
} as const;

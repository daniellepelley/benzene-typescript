/** Port of Benzene.HealthChecks.Constants. */

/** Fixed values used by the health check middleware. */
export const Constants = {
  /** The name assigned to the middleware registered by the `useHealthCheck` helpers, used to identify it in the pipeline. */
  healthCheckMiddlewareName: 'Health Check',

  /** A message topic the health check middleware always responds to, in addition to whatever topic it was configured with. */
  defaultHealthCheckTopic: 'healthcheck',

  /**
   * The ONLY topic a liveness check middleware responds to - it does NOT also match
   * `defaultHealthCheckTopic`, so `useLivenessCheck` and `useReadinessCheck` can coexist in one
   * pipeline without one silently shadowing the other on a shared fallback topic.
   */
  defaultLivenessTopic: 'liveness',

  /** The topic used by the `useReadinessCheck` helpers. See `defaultLivenessTopic` for why it doesn't also match `defaultHealthCheckTopic`. */
  defaultReadinessTopic: 'readiness',
} as const;

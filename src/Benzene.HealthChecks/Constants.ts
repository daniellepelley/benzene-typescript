/** Port of Benzene.HealthChecks.Constants. */
import { BenzeneTopic } from '@benzenejs/abstractions';

/** Fixed values used by the health check middleware. */
export const Constants = {
  /** The name assigned to the middleware registered by the `useHealthCheck` helpers, used to identify it in the pipeline. */
  healthCheckMiddlewareName: 'Health Check',

  /** A message topic the health check middleware always responds to, in addition to whatever topic it was configured with. */
  defaultHealthCheckTopic: BenzeneTopic.healthCheck,

  /**
   * The ONLY topic a liveness check middleware responds to - it does NOT also match
   * `defaultHealthCheckTopic`, so `useLivenessCheck` and `useReadinessCheck` can coexist in one
   * pipeline without one silently shadowing the other on a shared fallback topic.
   */
  defaultLivenessTopic: BenzeneTopic.liveness,

  /** The topic used by the `useReadinessCheck` helpers. See `defaultLivenessTopic` for why it doesn't also match `defaultHealthCheckTopic`. */
  defaultReadinessTopic: BenzeneTopic.readiness,
} as const;

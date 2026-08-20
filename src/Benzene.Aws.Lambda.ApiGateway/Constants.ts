/**
 * Port of Benzene.Aws.Lambda.ApiGateway.Constants.
 *
 * Constants used across the API Gateway package.
 */
import { BenzeneTopic } from '@benzenejs/abstractions';

export const Constants = {
  /** The `content-type` response header name. */
  contentTypeHeader: 'content-type',

  /** The default topic used for health-check requests when none is specified. */
  defaultHealthCheckTopic: BenzeneTopic.healthCheck,
} as const;

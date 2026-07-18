/**
 * Port of Benzene.Aws.Lambda.ApiGateway.Constants.
 *
 * Constants used across the API Gateway package.
 */
export const Constants = {
  /** The `content-type` response header name. */
  contentTypeHeader: 'content-type',

  /** The default topic used for health-check requests when none is specified. */
  defaultHealthCheckTopic: 'healthcheck',
} as const;

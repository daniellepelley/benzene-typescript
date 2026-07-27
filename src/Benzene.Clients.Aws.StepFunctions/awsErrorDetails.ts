/**
 * Pulls the non-sensitive discriminators an AWS SDK v3 error already carries: its `name` (the error
 * code, e.g. `AccessDenied`) and `$metadata.httpStatusCode`. Returns empties for a non-AWS error (e.g.
 * a raw connectivity failure). Shared by this package's health check.
 */
export function awsErrorDetails(error: unknown): { errorCode?: string; statusCode?: number } {
  if (error !== null && typeof error === 'object') {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return { errorCode: e.name, statusCode: e.$metadata?.httpStatusCode };
  }
  return {};
}

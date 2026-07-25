/**
 * Well-known result statuses and their success/failure classification.
 * Port of Benzene.Results.BenzeneResultStatus.
 *
 * The string VALUES are the normative **wire** status vocabulary from `docs/specification/wire-contracts.md`
 * §3 - lowercase-kebab-case and case-sensitive (`ok`, `not-found`, `validation-error`), identical to the
 * .NET constants. This is a cross-language contract: a Benzene service in any language writes these exact
 * strings as the response envelope's `statusCode`, so a TypeScript service and a .NET service (or mesh
 * aggregator) reading each other's responses classify statuses identically.
 */
export const BenzeneResultStatus = {
  accepted: 'accepted',
  ok: 'ok',
  created: 'created',
  updated: 'updated',
  deleted: 'deleted',
  ignored: 'ignored',
  notFound: 'not-found',
  badRequest: 'bad-request',
  validationError: 'validation-error',
  serviceUnavailable: 'service-unavailable',
  notImplemented: 'not-implemented',
  unexpectedError: 'unexpected-error',
  conflict: 'conflict',
  forbidden: 'forbidden',
  unauthorized: 'unauthorized',
  tooManyRequests: 'too-many-requests',
  timeout: 'timeout',

  isSuccess(status: string | undefined): boolean {
    return status !== undefined && successStatuses.has(status);
  },

  isFailure(status: string | undefined): boolean {
    return status !== undefined && failureStatuses.has(status);
  },

  isKnown(status: string | undefined): boolean {
    return BenzeneResultStatus.isSuccess(status) || BenzeneResultStatus.isFailure(status);
  },

  isTransient(status: string | undefined): boolean {
    return status !== undefined && transientStatuses.has(status);
  },
} as const;

const successStatuses = new Set(['ok', 'created', 'accepted', 'updated', 'deleted', 'ignored']);

const failureStatuses = new Set([
  'bad-request',
  'validation-error',
  'unauthorized',
  'forbidden',
  'not-found',
  'conflict',
  'too-many-requests',
  'timeout',
  'not-implemented',
  'service-unavailable',
  'unexpected-error',
]);

const transientStatuses = new Set(['service-unavailable', 'too-many-requests', 'timeout']);

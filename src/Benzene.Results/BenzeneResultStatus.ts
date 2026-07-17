/**
 * Well-known result statuses and their success/failure classification.
 * Port of Benzene.Results.BenzeneResultStatus.
 */
export const BenzeneResultStatus = {
  accepted: 'Accepted',
  ok: 'Ok',
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  ignored: 'Ignored',
  notFound: 'NotFound',
  badRequest: 'BadRequest',
  validationError: 'ValidationError',
  serviceUnavailable: 'ServiceUnavailable',
  notImplemented: 'NotImplemented',
  unexpectedError: 'UnexpectedError',
  conflict: 'Conflict',
  forbidden: 'Forbidden',
  unauthorized: 'Unauthorized',
  tooManyRequests: 'TooManyRequests',
  timeout: 'Timeout',

  isSuccess(status: string | undefined | null): boolean {
    return status != null && successStatuses.has(status);
  },

  isFailure(status: string | undefined | null): boolean {
    return status != null && failureStatuses.has(status);
  },

  isKnown(status: string | undefined | null): boolean {
    return BenzeneResultStatus.isSuccess(status) || BenzeneResultStatus.isFailure(status);
  },

  isTransient(status: string | undefined | null): boolean {
    return status != null && transientStatuses.has(status);
  },
} as const;

const successStatuses = new Set(['Ok', 'Created', 'Accepted', 'Updated', 'Deleted', 'Ignored']);

const failureStatuses = new Set([
  'BadRequest',
  'ValidationError',
  'Unauthorized',
  'Forbidden',
  'NotFound',
  'Conflict',
  'TooManyRequests',
  'Timeout',
  'NotImplemented',
  'ServiceUnavailable',
  'UnexpectedError',
]);

const transientStatuses = new Set(['ServiceUnavailable', 'TooManyRequests', 'Timeout']);

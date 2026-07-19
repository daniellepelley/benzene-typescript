import { IBenzeneResultOf } from '@benzene/abstractions';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';

/**
 * Maps a numeric/string HTTP status code to a Benzene result status (and result).
 * Port of Benzene.Clients.Common.BenzeneResultHttpMapper.
 *
 * The code -> status table is the INVERSE of `@benzene/http`'s `DefaultHttpStatusCodeMapper`
 * status -> code table (200->Ok, 201->Created, 202->Accepted, 400->BadRequest, 401->Unauthorized,
 * 403->Forbidden, 404->NotFound, 409->Conflict, 422->ValidationError, 429->TooManyRequests,
 * 500->UnexpectedError, 501->NotImplemented, 503->ServiceUnavailable, 504->Timeout). It carries a
 * few extras the forward table has no single owner for: 204->Ok (the forward table sends both
 * `Updated` and `Deleted` to 204, so the inverse collapses 204 to `Ok`), 408->Timeout, and
 * 502->ServiceUnavailable.
 *
 * C# `null` -> `undefined`; the static class of extension-style helpers becomes an object literal.
 */
export const BenzeneResultHttpMapper = {
  /** Port of C# `IBenzeneResult<T> Map<T>(string statusCode)` (no payload; success carries no value). */
  map<T>(statusCode: string): IBenzeneResultOf<T> {
    switch (statusCode) {
      case '200':
      case '201':
      case '202':
      case '204':
        return BenzeneResult.set<T>(BenzeneResultHttpMapper.mapBenzeneResultStatus(statusCode), undefined, true);
      case '400':
      case '401':
      case '403':
      case '404':
      case '408':
      case '409':
      case '422':
      case '429':
      case '500':
      case '501':
      case '502':
      case '503':
      case '504':
        return BenzeneResult.set<T>(BenzeneResultHttpMapper.mapBenzeneResultStatus(statusCode), undefined, false);
      default:
        return BenzeneResult.unexpectedError<T>(`Status code ${statusCode} not mapped`);
    }
  },

  /** Port of C# `string MapBenzeneResultStatus(string statusCode)`. */
  mapBenzeneResultStatus(statusCode: string): string {
    switch (statusCode) {
      case '200':
      case '204':
        return BenzeneResultStatus.ok;
      case '201':
        return BenzeneResultStatus.created;
      case '202':
        return BenzeneResultStatus.accepted;
      case '400':
        return BenzeneResultStatus.badRequest;
      case '401':
        return BenzeneResultStatus.unauthorized;
      case '403':
        return BenzeneResultStatus.forbidden;
      case '404':
        return BenzeneResultStatus.notFound;
      case '408':
        return BenzeneResultStatus.timeout;
      case '409':
        return BenzeneResultStatus.conflict;
      case '422':
        return BenzeneResultStatus.validationError;
      case '429':
        return BenzeneResultStatus.tooManyRequests;
      case '501':
        return BenzeneResultStatus.notImplemented;
      case '502':
        return BenzeneResultStatus.serviceUnavailable;
      case '503':
        return BenzeneResultStatus.serviceUnavailable;
      case '504':
        return BenzeneResultStatus.timeout;
      default:
        return BenzeneResultStatus.unexpectedError;
    }
  },

  /**
   * Normalizes a response's status code to a Benzene result status. A raw Benzene status passes
   * through verbatim; a numeric HTTP status code is mapped via {@link mapBenzeneResultStatus}.
   * Returns `undefined` for anything unrecognized. Port of C# `string? NormalizeStatus(string?)`.
   */
  normalizeStatus(statusCode: string | undefined): string | undefined {
    if (!statusCode) {
      return undefined;
    }

    if (BenzeneResultStatus.isKnown(statusCode)) {
      return statusCode;
    }

    switch (statusCode) {
      case '200':
      case '201':
      case '202':
      case '204':
      case '400':
      case '401':
      case '403':
      case '404':
      case '408':
      case '409':
      case '422':
      case '429':
      case '500':
      case '501':
      case '502':
      case '503':
      case '504':
        return BenzeneResultHttpMapper.mapBenzeneResultStatus(statusCode);
      default:
        return undefined;
    }
  },

  /** Whether a (normalized) Benzene result status is a success status. Port of C# `bool IsSuccessStatus(string)`. */
  isSuccessStatus(status: string): boolean {
    return BenzeneResultStatus.isSuccess(status);
  },
} as const;

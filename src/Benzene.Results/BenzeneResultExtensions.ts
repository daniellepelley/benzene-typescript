import { IBenzeneResultOf, VoidResult } from '@benzenejs/abstractions';
import { BenzeneResult } from './BenzeneResult';
import { BenzeneResultStatus } from './BenzeneResultStatus';

/**
 * Free-function ports of the `Benzene.Results.BenzeneResultExtensions` C# extension methods.
 *
 * Only the HTTP-status reverse mapping (`Convert(this HttpStatusCode)`) is ported here so far — the
 * client-side mapping of an HTTP response code back to a Benzene result status
 * (`wire-contracts.md` §4.1, the "reverse" table). The `As`/`AsTask` result-shape helpers are ported
 * elsewhere as they are needed.
 *
 * TS bend: .NET keys the switch on the `System.Net.HttpStatusCode` enum; TypeScript has no such enum,
 * so the port takes the numeric status code directly (`convertHttpStatusCode(204)`), which is how the
 * conformance runner and HTTP clients already carry it. The mapping is byte-for-byte the same table.
 */
export function convertHttpStatusCode(httpStatusCode: number): IBenzeneResultOf<VoidResult> {
  switch (httpStatusCode) {
    case 202:
      return BenzeneResult.accepted();
    case 200:
      return BenzeneResult.ok();
    case 201:
      return BenzeneResult.created();
    case 204:
      return BenzeneResult.deleted();
    case 404:
      return BenzeneResult.notFound();
    case 400:
      return BenzeneResult.badRequest();
    case 409:
      return BenzeneResult.setErrors(BenzeneResultStatus.conflict);
    case 403:
      return BenzeneResult.forbidden();
    case 401:
      return BenzeneResult.unauthorized();
    case 422:
      return BenzeneResult.validationError();
    case 429:
      return BenzeneResult.tooManyRequests();
    case 408:
      return BenzeneResult.setErrors(BenzeneResultStatus.timeout);
    case 504:
      return BenzeneResult.setErrors(BenzeneResultStatus.timeout);
    case 501:
      return BenzeneResult.setErrors(BenzeneResultStatus.notImplemented);
    case 502:
      return BenzeneResult.serviceUnavailable();
    case 503:
      return BenzeneResult.serviceUnavailable();
    default:
      return BenzeneResult.unexpectedError();
  }
}

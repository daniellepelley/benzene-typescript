import { IBenzeneResultOf, ISerializer } from '@benzene/abstractions';
import { BenzeneResult } from '@benzene/results';
import { BenzeneMessageClientResponse } from '../BenzeneMessageClientResponse';
import { BenzeneResultHttpMapper } from './BenzeneResultHttpMapper';

/**
 * Port of the client-side HTTP-status-code -> `IBenzeneResult<T>` conversion used by
 * `HttpContextConverter.mapResponseAsync`.
 *
 * In the .NET source the converter calls `response.StatusCode.Convert(response)` — the
 * `Benzene.Results.BenzeneResultExtensions.Convert<T>(this HttpStatusCode, T payload)` extension.
 * That extension attaches the deserialized payload on a success status and returns a payload-less
 * failure result otherwise. This port folds that behaviour together with the code -> status table
 * ported in {@link BenzeneResultHttpMapper} (`Benzene.Clients.Common`) into a single free function,
 * `convertStatusCode`, matching this brief's requested surface. The success/failure/unmapped code
 * partition matches `BenzeneResultHttpMapper.map<T>`; the only addition is that a success result
 * carries the deserialized payload (as the `Convert<T>(payload)` runtime path does), so an outbound
 * send round-trips its response body.
 *
 * The `BenzeneMessageClientResponse` overload — reading the raw envelope and deserializing its body into
 * `TResponse` — is {@link asBenzeneResult} below.
 */
export function convertStatusCode<T>(statusCode: number, payload: T): IBenzeneResultOf<T> {
  const code = String(statusCode);
  const status = BenzeneResultHttpMapper.mapBenzeneResultStatus(code);

  switch (code) {
    case '200':
    case '201':
    case '202':
    case '204':
      // Success: carry the deserialized payload (mirrors BenzeneResultExtensions.Convert<T>(payload)).
      return BenzeneResult.set<T>(status, payload, true);
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
      // Failure: no payload (the C# failure factories return `X<T>()` with no value).
      return BenzeneResult.set<T>(status, undefined, false);
    default:
      return BenzeneResult.unexpectedError<T>(`Status code ${statusCode} not mapped`);
  }
}

/**
 * Deserializes a raw {@link BenzeneMessageClientResponse} envelope into an `IBenzeneResultOf<TResponse>`:
 * on a success status the body is deserialized into `TResponse` (structurally — `JSON.parse` + a cast, the
 * same mechanism the HTTP client uses; there is no runtime type to validate against, so a body that doesn't
 * match `TResponse` yields a mis-shaped object rather than an error). A failure status yields a payload-less
 * failure result. Port of the deferred `BenzeneResultExtensions.AsBenzeneResult<TResponse>` overload.
 *
 * The envelope's `statusCode` may be a Benzene result status (`"ok"`, `"not-found"`) or a numeric HTTP code;
 * both are normalized via {@link BenzeneResultHttpMapper.normalizeStatus}.
 */
export function asBenzeneResult<TResponse>(
  response: BenzeneMessageClientResponse,
  serializer: ISerializer,
): IBenzeneResultOf<TResponse> {
  const status = BenzeneResultHttpMapper.normalizeStatus(response.statusCode);
  if (status === undefined) {
    return BenzeneResult.unexpectedError<TResponse>(`Status code ${response.statusCode} not mapped`);
  }

  if (BenzeneResultHttpMapper.isSuccessStatus(status)) {
    const payload = response.body === '' ? undefined : serializer.deserialize<TResponse>(response.body);
    return BenzeneResult.set<TResponse>(status, payload as TResponse, true);
  }

  // Failure: payload-less, matching convertStatusCode (the error-payload body is not surfaced in this cut).
  return BenzeneResult.set<TResponse>(status, undefined, false);
}

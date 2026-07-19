import { IBenzeneResultOf } from '@benzene/abstractions';
import { BenzeneResult } from '@benzene/results';
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
 * The .NET `ClientResultExtensions` (`BenzeneResultExtensions.AsBenzeneResult`) additionally reads a
 * `BenzeneMessageClientResponse` (part of the deferred client-wrapper suite) and its error-payload
 * body; that overload is deferred with the rest of that suite.
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

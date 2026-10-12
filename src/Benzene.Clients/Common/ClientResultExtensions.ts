import { BenzeneError, IBenzeneResultOf, ISerializer } from '@benzenejs/abstractions';
import { BenzeneResult, BenzeneResultStatus, ProblemDetails } from '@benzenejs/results';
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
 *
 * Success/failure classification is the envelope's own `isSuccessful` — **the** signal (wire-contracts
 * §1.2). An envelope without it is malformed and is treated as unsuccessful; the status text is never
 * re-classified (spec-0.2.0 removed the older-sender fallback).
 *
 * A failure body is read as the RFC 9457 problem document it is (wire-contracts §1.3, whatever its inner
 * content type): the result's `errors` are rebuilt from it with `field` and `code` intact, in order, the
 * received document is attached (core-concepts §12 "Error fidelity"), and the result's status is the
 * document's `benzeneStatus` when it carries one (wire-contracts §4.1) - see {@link failedResultFromProblem}.
 * So a failure whose envelope `statusCode` this reader cannot map is still read from its document's
 * `benzeneStatus`; only a failure with neither yields `unexpected-error`.
 */
export function asBenzeneResult<TResponse>(
  response: BenzeneMessageClientResponse,
  serializer: ISerializer,
): IBenzeneResultOf<TResponse> {
  const status = BenzeneResultHttpMapper.normalizeStatus(response.statusCode);
  const isSuccessful = response.isSuccessful === true;

  if (isSuccessful) {
    if (status === undefined) {
      return BenzeneResult.unexpectedError<TResponse>(`Status code ${response.statusCode} not mapped`);
    }
    const payload = response.body === '' ? undefined : serializer.deserialize<TResponse>(response.body);
    return BenzeneResult.set<TResponse>(status, payload as TResponse, true);
  }

  const problem = readProblemDocument(response.body, serializer);
  if (status === undefined && benzeneStatusOf(problem) === undefined) {
    return BenzeneResult.unexpectedError<TResponse>(`Status code ${response.statusCode} not mapped`);
  }
  return failedResultFromProblem<TResponse>(status ?? BenzeneResultStatus.unexpectedError, problem);
}

/**
 * Reads a failure body as a problem document (wire-contracts §1.3), or `undefined` when it is empty or is
 * not a JSON object - a carrier failure, an HTML error page - so a malformed body costs the errors, never
 * the result. Unknown members are kept on the returned object (RFC 9457 §3.2: a reader ignores, not
 * strips, what it does not recognize), so an attached document is the one that was received.
 */
export function readProblemDocument(body: string | undefined | null, serializer: ISerializer): ProblemDetails | undefined {
  if (body === undefined || body === null || body.trim() === '') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = serializer.deserialize<unknown>(body);
  } catch {
    return undefined;
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as ProblemDetails) : undefined;
}

/**
 * The failed result for a received problem document. Its status is the document's `benzeneStatus` when
 * that is a non-empty string (wire-contracts §4.1, spec 1.1: a client that reads a problem document SHOULD
 * take the status from it, so an application-defined status survives the hop); otherwise `status`, the one
 * the caller derived from the transport (the reverse HTTP table, or the envelope's `statusCode`).
 *
 * core-concepts §12 "Error fidelity": the result's `errors` are rebuilt from the document's `errors` with `field` and `code` intact and in order
 * (authoritative when present, even empty); a document with no `errors` member yields its `detail` as one
 * opaque message (never split on commas), and no `detail` yields no errors (wire-contracts §1.3, "Without
 * `errors`"). The document is attached to the result (`BenzeneResult.receivedProblem`), so
 * `ProblemTypes.from(result)` returns it verbatim. With no document the result simply carries no errors.
 * Port of the C# `ClientResultExtensions.FailedResultFromProblem`.
 */
export function failedResultFromProblem<T>(status: string, problem: ProblemDetails | undefined): IBenzeneResultOf<T> {
  if (problem === undefined) {
    return BenzeneResult.set<T>(status, undefined, false);
  }
  return BenzeneResult.receivedProblem<T>(benzeneStatusOf(problem) ?? status, errorsFromProblem(problem), problem);
}

/** The document's `benzeneStatus`, when it is a non-empty string. */
function benzeneStatusOf(problem: ProblemDetails | undefined): string | undefined {
  const value: unknown = (problem as { benzeneStatus?: unknown } | undefined)?.benzeneStatus;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function errorsFromProblem(problem: ProblemDetails): BenzeneError[] {
  const errors: unknown = (problem as { errors?: unknown }).errors;
  if (Array.isArray(errors)) {
    return errors.flatMap((item): BenzeneError[] => {
      if (typeof item !== 'object' || item === null || typeof (item as { message?: unknown }).message !== 'string') {
        return [];
      }
      const { message, field, code } = item as { message: string; field?: unknown; code?: unknown };
      const error: BenzeneError = { message };
      if (typeof field === 'string') {
        error.field = field;
      }
      if (typeof code === 'string') {
        error.code = code;
      }
      return [error];
    });
  }
  const detail: unknown = (problem as { detail?: unknown }).detail;
  return typeof detail === 'string' && detail !== '' ? [{ message: detail }] : [];
}

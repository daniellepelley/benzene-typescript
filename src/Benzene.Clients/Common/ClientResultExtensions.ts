import { BenzeneError, IBenzeneResultOf, ISerializer } from '@benzenejs/abstractions';
import { BenzeneResult, ProblemDetails } from '@benzenejs/results';
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
 * match `TResponse` yields a mis-shaped object rather than an error). Port of
 * `BenzeneResultExtensions.AsBenzeneResult<TResponse>`.
 *
 * A failure body is read as an RFC 9457 problem document ({@link ProblemDetails}, wire-contracts.md §1.3),
 * as .NET's `AsBenzeneResult` does: when its `errors` member is present and non-empty, the result's
 * structured errors are populated from it directly — field/code and all, and in order. When `errors` is
 * absent (an older producer still emitting only `{ status, detail }`), a single message-only error is
 * built from the document's `detail`. Either way the received document is attached to the result (the
 * same `problem` attachment `BenzeneResult.problem` uses, which `ProblemTypes.from` returns verbatim),
 * so a reader sees exactly what was received, not a synthesized document. An empty or non-JSON failure
 * body degrades to the historical payload-less, error-less failure rather than throwing. The result's
 * status stays whatever the envelope/HTTP classification already decided — never re-derived from the
 * received document's `benzeneStatus`, which could disagree with it for a still-transitioning producer.
 *
 * The envelope's `statusCode` may be a Benzene result status (`"ok"`, `"not-found"`) or a numeric HTTP code;
 * both are normalized via {@link BenzeneResultHttpMapper.normalizeStatus}.
 *
 * Success/failure classification prefers the envelope's own `isSuccessful` (the wire's authoritative
 * signal, wire-contracts.md §1.2) when the sender wrote it. `undefined` means the sender is an older
 * service, or a language port that hasn't picked up the field yet, so classification falls back to
 * {@link BenzeneResultHttpMapper.isSuccessStatus} — which only recognizes the framework's own known
 * statuses, so a custom status from such a sender still classifies as failure (the historical
 * behavior, since there is no other signal to trust it with).
 */
export function asBenzeneResult<TResponse>(
  response: BenzeneMessageClientResponse,
  serializer: ISerializer,
): IBenzeneResultOf<TResponse> {
  const status = BenzeneResultHttpMapper.normalizeStatus(response.statusCode);
  if (status === undefined) {
    return BenzeneResult.unexpectedError<TResponse>(`Status code ${response.statusCode} not mapped`);
  }

  const isSuccessful = response.isSuccessful ?? BenzeneResultHttpMapper.isSuccessStatus(status);

  if (isSuccessful) {
    const payload = response.body === '' ? undefined : serializer.deserialize<TResponse>(response.body);
    return BenzeneResult.set<TResponse>(status, payload as TResponse, true);
  }

  return failedResultFromProblem<TResponse>(status, tryDeserializeProblem(response.body, serializer));
}

/**
 * Deserializes a failure body into a {@link ProblemDetails}, or `undefined` when there is nothing to
 * read — an empty body, or one that isn't valid JSON (the .NET port's "didn't deserialize to anything"
 * case, kept as a degrade-not-throw so a non-Benzene error page never breaks result mapping).
 */
function tryDeserializeProblem(body: string, serializer: ISerializer): ProblemDetails | undefined {
  if (body === '') {
    return undefined;
  }

  try {
    const problem = serializer.deserialize<ProblemDetails>(body);
    // A JSON scalar/array body isn't a problem document; treat it as absent rather than mis-reading it.
    return typeof problem === 'object' && problem !== null && !Array.isArray(problem)
      ? problem
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the failed `status` result for a deserialized failure body, per the rules in
 * {@link asBenzeneResult}'s doc. Port of .NET's `FailedResultFromProblem<T>`: `problem.errors` wins when
 * present; else a single message-only error from `problem.detail`; else no errors. The received document
 * is attached under the result's `problem` slot (the internal representation `BenzeneResult.problem`
 * establishes and `ProblemTypes.from` reads) — .NET reaches this through the internal
 * `BenzeneResult.AttachReceivedProblem`; the port populates the same shape locally rather than widening
 * the `@benzenejs/results` factory surface from a clients change. The `errors` array is populated
 * post-construction (it is the result's own runtime-mutable array) for the same reason: no public
 * factory takes status + errors + an explicit `isSuccessful`, and the explicit `false` must win even for
 * a sender that pairs `isSuccessful: false` with a success-classified status.
 */
function failedResultFromProblem<TResponse>(
  status: string,
  problem: ProblemDetails | undefined,
): IBenzeneResultOf<TResponse> {
  const result = BenzeneResult.set<TResponse>(status, undefined, false);
  if (problem === undefined) {
    return result;
  }

  const errors: BenzeneError[] =
    problem.errors !== undefined && problem.errors.length > 0
      ? problem.errors
      : problem.detail !== undefined && problem.detail !== ''
        ? [{ message: problem.detail }]
        : [];

  result.errors.push(...errors);
  (result as { problem?: ProblemDetails }).problem = problem;
  return result;
}

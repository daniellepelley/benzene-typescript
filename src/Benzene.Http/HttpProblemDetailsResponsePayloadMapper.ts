import { ISerializer } from '@benzenejs/abstractions';
import { IMessageHandlerResult, IResponsePayloadMapper } from '@benzenejs/abstractions-message-handlers';
import { ProblemTypes } from '@benzenejs/results';
import { IHttpStatusCodeMapper } from './IHttpStatusCodeMapper';

/**
 * Decorates a transport's `IResponsePayloadMapper<TContext>` so a failed result's problem document
 * carries the numeric RFC 9457 `status` member — HTTP-facing transports only
 * (`docs/specification/wire-contracts.md` §1.3, §4.1).
 * Port of Benzene.Http.HttpProblemDetailsResponsePayloadMapper&lt;TContext&gt;.
 *
 * `ProblemDetails.status` is filled in from the **same** `IHttpStatusCodeMapper` instance
 * `HttpStatusCodeResponseHandler<TContext>` uses to set the actual HTTP response status line, so the
 * body's `status` member and the real response code are derived from one mapping and can never
 * disagree. That is the whole point of the decorator: the transport-neutral factory
 * (`ProblemTypes.from`) deliberately never sets `status`, because an envelope over a queue has no
 * HTTP response to agree with.
 *
 * Success responses, and results with no resolved `messageHandlerDefinition`, delegate straight
 * through to {@link inner} unchanged. Only the failure branch is re-implemented here (building the
 * same `ProblemTypes.from` document, then adding `status`) rather than post-processing the inner
 * mapper's already-serialized output, so this works uniformly across every negotiated serializer
 * without a deserialize/mutate/reserialize round trip.
 *
 * Deviations: C# `int.Parse` becomes `Number.parseInt(..., 10)`. A handler-authored document (from
 * `BenzeneResult.problem(...)`) is returned by `ProblemTypes.from` verbatim and has `status` set on
 * it in place — the same mutation-of-the-authored-instance the C# response mappers make, which is
 * what keeps an application-owned `type` from being overwritten on the way out.
 */
export class HttpProblemDetailsResponsePayloadMapper<TContext> implements IResponsePayloadMapper<TContext> {
  constructor(
    /** The transport-neutral mapper every non-failure case delegates to. */
    public readonly inner: IResponsePayloadMapper<TContext>,
    /** The same mapper the transport uses to set the HTTP response status line. */
    private readonly httpStatusCodeMapper: IHttpStatusCodeMapper,
  ) {}

  map(
    context: TContext,
    messageHandlerResult: IMessageHandlerResult,
    serializer: ISerializer,
  ): string | undefined {
    if (
      messageHandlerResult.messageHandlerDefinition === undefined ||
      messageHandlerResult.benzeneResult.isSuccessful
    ) {
      return this.inner.map(context, messageHandlerResult, serializer);
    }

    const result = messageHandlerResult.benzeneResult;
    const problem = ProblemTypes.from(result);
    problem.status = Number.parseInt(
      this.httpStatusCodeMapper.map(result.status, result.isSuccessful),
      10,
    );

    return serializer.serialize(problem);
  }
}

import { Constructor, IBenzeneResultOf } from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';

/**
 * The per-invocation context flowing through the handler middleware pipeline for a single message
 * handler call: it carries the already-mapped, strongly-typed request in and the handler's result
 * out, so handler middleware (validation, logging, filters, etc.) can inspect or replace either
 * side without knowing about the underlying transport.
 *
 * Port of Benzene.Abstractions.MessageHandlers.IBenzeneMessageContext
 * (the file's `IMessageHandlerContext<TRequest, TResponse>` interface — the file name mirrors the
 * C# source name even though the type inside is `IMessageHandlerContext`, matching the C# layout).
 */
export interface IMessageHandlerContext<TRequest, TResponse> {
  /** The topic (id + version) the incoming message was routed on. */
  readonly topic: ITopic;

  /**
   * The concrete handler type resolved for this invocation, or `undefined` if not yet resolved.
   * Port of C# `Type? HandlerType` — a runtime constructor stands in for `System.Type`.
   */
  readonly handlerType: Constructor<unknown> | undefined;

  /** The strongly-typed request, already mapped from the transport payload. */
  readonly request: TRequest;

  /**
   * The result produced by the handler pipeline. Set by `MessageHandlerMiddleware` after the inner
   * handler runs; earlier middleware can also assign this to short-circuit the pipeline.
   */
  response: IBenzeneResultOf<TResponse>;
}

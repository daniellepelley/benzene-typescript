import { context as otelContext, Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { IServiceResolver, serviceIdentifierName } from '@benzene/abstractions';
import {
  ICurrentTransport,
  IHasMessageResult,
  IMessageGetter,
  IMessageHandlerDefinitionLookUp,
} from '@benzene/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { BenzeneDiagnostics } from './BenzeneDiagnostics';

// The value ICurrentTransport reports before any transport pipeline has recorded itself; the span skips
// the transport tag while it still reads this (port of TransportNames.Unresolved).
const unresolvedTransport = '<missing>';

/**
 * Wraps one middleware in a span (named after it) so `addActivityPerMiddleware`/`addDiagnostics` produce
 * a span per pipeline stage, tagged `benzene.transport`/`benzene.topic`/`benzene.version`/`benzene.handler`
 * where resolvable and `benzene.status` on the topic-bearing span.
 * Port of Benzene.Diagnostics.ActivityMiddlewareDecorator&lt;TContext&gt;.
 *
 * .NET's `ActivitySource.StartActivity` returns `null` when nothing is listening; OpenTelemetry JS
 * always returns a span, so the equivalent cheap path checks `span.isRecording()` and delegates to the
 * inner middleware directly (no tag work, no span context switch) when not recording.
 */
export class ActivityMiddlewareDecorator<TContext> implements IMiddleware<TContext> {
  private readonly inner: IMiddleware<TContext>;
  private readonly serviceResolver: IServiceResolver;

  constructor(inner: IMiddleware<TContext>, serviceResolver: IServiceResolver) {
    this.inner = inner;
    this.serviceResolver = serviceResolver;
  }

  get name(): string {
    return this.inner.name;
  }

  handleAsync(context: TContext, next: NextFunc): Promise<void> {
    const span = BenzeneDiagnostics.tracer.startSpan(this.name);
    if (!span.isRecording()) {
      // Nothing is exporting, so there is no span to record - delegate directly.
      span.end();
      return this.inner.handleAsync(context, next);
    }

    return this.handleTracedAsync(span, context, next);
  }

  private async handleTracedAsync(span: Span, context: TContext, next: NextFunc): Promise<void> {
    const taggedTopic = this.tag(span, context);
    try {
      // Run the inner middleware with this span active, so automatically-wrapped nested stages nest under it.
      await otelContext.with(trace.setSpan(otelContext.active(), span), () =>
        this.inner.handleAsync(context, next),
      );

      // Set after the inner runs so the handler's result is available - the real Benzene wire status, on
      // the topic-bearing span only.
      if (taggedTopic) {
        // The TypeScript port's `IMessageResult` carries only `isSuccessful`; the concrete result set at
        // runtime (a `BenzeneResult`) also carries `status`, read here defensively.
        const status = messageResultStatus(context);
        if (status !== undefined && status !== '') {
          span.setAttribute('benzene.status', status);
        }
      }
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (taggedTopic) {
        span.setAttribute('benzene.status', 'exception');
      }
      throw error;
    } finally {
      span.end();
    }
  }

  /** Tags the span; returns whether a real topic was resolved (so it's the topic-bearing span that also carries benzene.status). */
  private tag(span: Span, context: TContext): boolean {
    const transport = this.serviceResolver.tryGetService(ICurrentTransport);
    if (transport !== undefined && transport.name !== unresolvedTransport) {
      span.setAttribute('benzene.transport', transport.name);
    }

    const messageGetter = this.serviceResolver.tryGetService(IMessageGetter) as unknown as
      | IMessageGetter<TContext>
      | undefined;
    const topic = messageGetter?.getTopic(context);
    if (topic !== undefined && topic.id !== '') {
      span.setAttribute('benzene.topic', topic.id);
      span.setAttribute('benzene.version', topic.version);

      const handler = this.serviceResolver
        .tryGetService(IMessageHandlerDefinitionLookUp)
        ?.findHandler(topic);
      if (handler !== undefined) {
        span.setAttribute('benzene.handler', serviceIdentifierName(handler.handlerType));
      }

      return true;
    }

    return false;
  }
}

/** Duck-types the `IHasMessageResult` shape at runtime (the port's `is IHasMessageResult` guard). */
function asHasMessageResult(context: unknown): IHasMessageResult | undefined {
  return typeof context === 'object' && context !== null && 'messageResult' in context
    ? (context as IHasMessageResult)
    : undefined;
}

/** The Benzene wire status of the context's message result, if the runtime result carries one. */
function messageResultStatus(context: unknown): string | undefined {
  const messageResult = asHasMessageResult(context)?.messageResult as { status?: string } | undefined;
  return messageResult?.status;
}

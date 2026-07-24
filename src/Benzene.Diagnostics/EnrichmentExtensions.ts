import { trace } from '@opentelemetry/api';
import { ILoggerFactory, serviceIdentifierName } from '@benzene/abstractions';
import {
  ICurrentTransport,
  IMessageGetter,
  IMessageHandlerDefinitionLookUp,
} from '@benzene/abstractions-message-handlers';
import { IBenzeneInvocation, IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { BenzeneDiagnostics } from './BenzeneDiagnostics';

/**
 * Adds middleware that attaches `invocationId`, `traceId`, `spanId`, `topic`, `transport`, and `handler`
 * to the logging scope for the duration of the request, and tags the current span with
 * `benzene.invocationId`. Each key is resolved independently and simply omitted when its backing service
 * isn't registered, so it's safe to add unconditionally on every platform and transport.
 * Port of Benzene.Diagnostics.EnrichmentExtensions.UseBenzeneEnrichment.
 *
 * .NET's `Activity.Current` maps to `trace.getActiveSpan()`, and `TraceId.ToHexString()` /
 * `SpanId.ToHexString()` to the span context's already-hex `traceId` / `spanId`.
 */
export function useBenzeneEnrichment<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
): IMiddlewarePipelineBuilder<TContext> {
  return app.useFn('BenzeneEnrichment', async (context, next, resolver) => {
    const span = trace.getActiveSpan();
    const invocation = resolver.tryGetService(IBenzeneInvocation);
    const transport = resolver.tryGetService(ICurrentTransport);
    const messageGetter = resolver.tryGetService(IMessageGetter) as unknown as
      | IMessageGetter<TContext>
      | undefined;
    const topic = messageGetter?.getTopic(context);
    const handler =
      topic !== undefined && topic.id !== ''
        ? resolver.tryGetService(IMessageHandlerDefinitionLookUp)?.findHandler(topic)
        : undefined;

    const scope: Record<string, unknown> = {};
    if (invocation !== undefined) {
      scope.invocationId = invocation.invocationId;
    }

    if (span !== undefined) {
      const spanContext = span.spanContext();
      scope.traceId = spanContext.traceId;
      scope.spanId = spanContext.spanId;
      if (invocation !== undefined) {
        span.setAttribute('benzene.invocationId', invocation.invocationId);
      }
    }

    if (transport !== undefined) {
      scope.transport = transport.name;
    }

    if (topic !== undefined && topic.id !== '') {
      scope.topic = topic.id;
    }

    if (handler !== undefined) {
      scope.handler = serviceIdentifierName(handler.handlerType);
    }

    const logger = resolver.getService(ILoggerFactory).createLogger('Benzene');
    const loggerScope = logger.beginScope(scope);
    try {
      await next();
    } finally {
      loggerScope.dispose();
    }
  });
}

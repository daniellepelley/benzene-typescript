import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { OutboundContext } from '../OutboundContext';
import { W3CTraceContextMiddleware } from './W3CTraceContextMiddleware';

/**
 * Adds {@link W3CTraceContextMiddleware} to an outbound route pipeline, so every send through it carries
 * the current distributed trace on its `traceparent`/`tracestate` headers.
 * Port of Benzene.Clients.TraceContext.Extensions.UseW3CTraceContext (a C# extension method -> a free
 * function).
 *
 * Named to match the .NET source; this is the outbound-pipeline counterpart of `@benzene/diagnostics`'
 * inbound `useW3CTraceContext`. Import it from `@benzene/clients` for the outbound direction.
 */
export function useW3CTraceContext(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
): IMiddlewarePipelineBuilder<OutboundContext> {
  return app.use(() => new W3CTraceContextMiddleware());
}

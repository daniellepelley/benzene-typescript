/**
 * The composition root for the OpenTelemetry demo, hosted on the BenzeneMessage envelope. It wires the
 * same diagnostics stack as the .NET example's `Program.cs`:
 *
 *  - `addDiagnostics(container)` wraps every middleware in a span on Benzene's `"Benzene"` tracer.
 *  - the pipeline layers `useW3CTraceContext` (continue an inbound `traceparent`), `useBenzeneEnrichment`
 *    (tag the active span / logs with topic, transport, handler), and `useBenzeneMetrics` (the
 *    `benzene.messages.processed` counter + `benzene.message.duration` histogram), then the handlers.
 *
 * There is no `Benzene.OpenTelemetry`/`AddBenzeneInstrumentation` step to port: OpenTelemetry JS exports
 * spans/instruments from every API tracer/meter once an SDK is registered, so wiring an exporter is done
 * entirely in the OTel SDK (see `main.ts` / the test harness), not in Benzene.
 */
import { IBenzeneServiceContainer, ILoggerFactory, NullLoggerFactory } from '@benzene/abstractions';
import { Span, SpanKind } from '@opentelemetry/api';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import {
  addDiagnostics,
  useBenzeneEnrichment,
  useBenzeneMetrics,
  useW3CTraceContext,
} from '@benzene/diagnostics';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { ExampleDiagnostics } from './exampleDiagnostics';
import {
  CreateOrderMessageHandler,
  FailingOrderMessageHandler,
  GreetingMessageHandler,
} from './handlers';
import { IWarehouseService, WarehouseService } from './warehouseService';

/** The demo booted end-to-end: the BenzeneMessage app + a resolver factory. */
export interface OtelApp {
  readonly app: BenzeneMessageApplication;
  readonly resolverFactory: ReturnType<IBenzeneServiceContainer['createServiceResolverFactory']>;
}

/** Boots the demo the same way a deployed host would. */
export function buildOtelApp(): OtelApp {
  const container = new DefaultBenzeneServiceContainer();

  // `useBenzeneEnrichment` resolves an ILoggerFactory to open a log scope per message (the .NET example's
  // `AddLogging()`). Register the no-op factory; swap in a real one to see the enriched log scope.
  container.addSingletonInstance(ILoggerFactory, NullLoggerFactory.instance);
  container.addScoped(IWarehouseService, WarehouseService);
  addBenzene(container);
  addBenzeneMessage(container);
  addDiagnostics(container);

  const pipeline = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useW3CTraceContext(pipeline);
  useBenzeneEnrichment(pipeline);
  useBenzeneMetrics(pipeline);
  useMessageHandlers(
    pipeline,
    GreetingMessageHandler,
    CreateOrderMessageHandler,
    FailingOrderMessageHandler,
  );

  return {
    app: new BenzeneMessageApplication(pipeline.build()),
    resolverFactory: container.createServiceResolverFactory(),
  };
}

/** What `sendMessage` sends — the shape of the .NET example's `/api/send` request. */
export interface SendMessageRequest {
  topic: string;
  body?: string;
  headers?: Record<string, string>;
}

/** What `sendMessage` returns — the envelope status/body plus the id of the trace that covered the send. */
export interface SendMessageResult {
  statusCode: string;
  body: string;
  headers: Record<string, string> | undefined;
  traceId: string | undefined;
}

/**
 * Sends one message through the pipeline under a root `Send <topic>` span on the example's own tracer —
 * the analog of the .NET `/api/send` endpoint. The Benzene pipeline's spans nest under this root span, so
 * the returned `traceId` covers the whole trace.
 */
export async function sendMessage(
  { app, resolverFactory }: OtelApp,
  send: SendMessageRequest,
): Promise<SendMessageResult> {
  return ExampleDiagnostics.tracer.startActiveSpan(
    `Send ${send.topic}`,
    { kind: SpanKind.SERVER },
    async (span: Span) => {
      span.setAttribute('benzene.topic', send.topic);
      try {
        const request = new BenzeneMessageRequest();
        request.topic = send.topic;
        request.body = send.body ?? '{}';
        request.headers = send.headers ?? {};

        const response = await app.handleAsync(request, resolverFactory);
        // With no SDK registered the span is a no-op and its trace id is all-zeros; report that as none.
        const traceId = span.spanContext().traceId;
        const isRealTrace = /[1-9a-f]/.test(traceId);
        return {
          statusCode: response.statusCode,
          body: response.body,
          headers: response.headers,
          traceId: isRealTrace ? traceId : undefined,
        };
      } finally {
        span.end();
      }
    },
  );
}

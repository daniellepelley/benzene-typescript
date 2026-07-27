/**
 * The shared "make this Lambda a mesh-discoverable Cloud Service" wiring, mirroring the .NET AwsMesh
 * `Shared/MeshServiceWiring`. Each service is a single Lambda (a composite entry point) that:
 *
 *  - answers a **direct Lambda invoke** carrying the reserved `spec`/`healthcheck` topics — the surface the
 *    mesh interrogates (via `@benzene/aws-lambda-core`'s `useBenzeneMessage`). The `spec` topic is served by
 *    the **library `useSpec`** (`@benzene/schema-openapi`) — the standard, dogfooded self-description path —
 *    which builds the benzene spec document (`{ requests, events, transports, components.schemas }`) from the
 *    service's own DI-registered feeds. There is deliberately no hand-built spec: `useSpec` IS the single
 *    source of truth, so running the example proves `useSpec` emits the correct spec.
 *  - hosts its domain handlers over every transport it actually listens on (API Gateway, SQS, SNS,
 *    EventBridge) — the same handler on each, routed by the composite's event-shape predicates.
 *
 * `useSpec` reads these from the container at spec-build time; the composite gives each route its own
 * container plus the shared `configureServices` registrations, so every feed `useSpec` needs is registered
 * in `configureServices`:
 *  - request/response payload schemas ← the registered `ZodJsonSchemaSource` (`ITypeJsonSchemaSource`),
 *    which reads the Zod schemas the domain payloads registered (`services.ts`);
 *  - `httpMappings` ← `addHttpMessageHandlers` (correlates each handler's `@httpEndpoint` with its `@message`);
 *  - `events[]` (produced topics → the structural topology) ← `addResponseEventDeclarations`, the port of
 *    .NET's `AddResponseEventDeclarations`;
 *  - `transports[]` ← a declared `TransportsInfo` (the composite is multi-container, so the transports the
 *    service listens on are declared here rather than auto-aggregated across routes).
 */
import { Constructor, IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler, ITransportsInfo } from '@benzene/abstractions-message-handlers';
import { ITypeJsonSchemaSource } from '@benzene/abstractions-validation';
import { Handler } from 'aws-lambda';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  TransportInfo,
  TransportsInfo,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { addHttpMessageHandlers } from '@benzene/http';
import { addResponseEventDeclarations, ResponseEventDefinition } from '@benzene/response-events';
import { useSpec } from '@benzene/schema-openapi';
import { ZodJsonSchemaSource } from '@benzene/zod';
import { BenzeneResult } from '@benzene/results';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { addOutboundRouting } from '@benzene/clients';
import { useSqs as useSqsClient } from '@benzene/clients-aws-sqs';
import { useSns as useSnsClient } from '@benzene/clients-aws-sns';
import { useEventBridge as useEventBridgeClient } from '@benzene/clients-aws-eventbridge';
import {
  compositeAwsLambda,
  isApiGatewayEvent,
  isBenzeneMessageEvent,
  isEventBridgeEvent,
  isSnsEvent,
  isSqsEvent,
  toLambdaHandler,
} from '@benzene/aws-lambda-core';
import { useBenzeneMessage } from '@benzene/aws-lambda-core';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { useSqs } from '@benzene/aws-lambda-sqs';
import { useSns } from '@benzene/aws-lambda-sns';
import { useEventBridge } from '@benzene/aws-lambda-eventbridge';

/** A transport a service listens on. */
export type Transport = 'http' | 'sqs' | 'sns' | 'eventbridge';

/**
 * How a service's runtime outbound sends reach the wire: the AWS SDK clients to publish with, and how to
 * resolve a produced topic's transport target (queue URL / topic ARN / event-bus name). The in-memory bus
 * supplies fake clients + a nominal target; a real deployment supplies `new SQSClient({})` etc. + env-derived
 * targets. `sqs`/`sns`/`eventBridge` are typed `unknown` so the in-memory fakes fit without pulling the SDK
 * types into the shared shape; each `useX` cast happens at the call site.
 */
export interface OutboundWiring {
  readonly sqs?: unknown;
  readonly sns?: unknown;
  readonly eventBridge?: unknown;
  /** Resolves the target for a produced topic: an SQS queue URL, an SNS topic ARN, or an EventBridge bus name. */
  target(topic: string, transport: Transport): string;
}

/** The definition of one mesh service: its domain handlers, what it consumes, and what it produces. */
export interface MeshServiceDefinition {
  /** The service (and Lambda function) name, e.g. `orders-api`. */
  readonly name: string;
  /** The service's own handler registry (so importing services never cross-pollute discovery). */
  readonly registry: MessageHandlersRegistry;
  /** The domain handler classes (each `@message`-decorated against `registry`). */
  readonly domainHandlers: Constructor<unknown>[];
  /** Consumed domain topics, with the transport they arrive over — drives both the spec and the routes. */
  readonly consumes: { topic: string; transport: Transport; httpMappings?: { method: string; path: string }[] }[];
  /** Produced domain topics — declared as response events so they appear in the spec's `events` (topology). */
  readonly produces: string[];
  /** The payload type of the produced events (all events in this example carry the same `{ orderId }` shape). */
  readonly eventPayloadType?: Constructor<unknown>;
  /** Extra transports the service listens on beyond those implied by `consumes` (e.g. `http` for orders). */
  readonly extraTransports?: Transport[];
  /**
   * Runtime outbound sends: the topics this service actually publishes and over which transport. Wires
   * `addOutboundRouting` so a handler's `IBenzeneMessageSender.sendAsync(topic, …)` reaches the bus. The
   * topics should match `produces` (produces drives the structural topology; sends drive the live cascade).
   * `targetEnvVar` names the environment variable holding the transport's target on a real deploy (an SQS
   * queue URL, an SNS topic ARN, or an EventBridge bus name) — the in-memory bus ignores it; the
   * `functions/` production entry points read it via {@link OutboundWiring.target}. Mirrors .NET's
   * `OutboundSend.TargetEnvVar`.
   */
  readonly sends?: { topic: string; transport: Transport; targetEnvVar?: string }[];
}

/** The set of transports a service listens on (from its consumed topics + any extra transports). */
function serviceTransports(definition: MeshServiceDefinition): Set<Transport> {
  const transports = new Set<Transport>(definition.extraTransports ?? []);
  for (const consume of definition.consumes) {
    transports.add(consume.transport);
  }
  return transports;
}

/** The health report a service returns over the reserved `healthcheck` topic. */
function buildHealth(name: string): { isHealthy: boolean; checks: { name: string; isHealthy: boolean }[] } {
  return { isHealthy: true, checks: [{ name: `${name}-self`, isHealthy: true }] };
}

/**
 * Builds a service's Lambda `handler`: a composite entry point that answers direct-invoke `spec` (via the
 * library `useSpec`) and `healthcheck` plus its domain handlers on every transport it listens on.
 */
export function buildMeshServiceLambda(definition: MeshServiceDefinition, outbound?: OutboundWiring): Handler {
  const { name, domainHandlers, produces, eventPayloadType, sends } = definition;
  const health = buildHealth(name);
  const transports = serviceTransports(definition);

  // The reserved health handler registers into its OWN throwaway registry, never a service's domain registry
  // — so a later build never picks it up as a domain handler. `useMessageHandlers` reads each class's
  // `@message` metadata directly from the classes passed to it, so a separate registry is invisible.
  const reservedRegistry = new MessageHandlersRegistry();
  class ReservedRequest {}
  class HealthResponse {}

  @message('healthcheck', { registry: reservedRegistry, requestType: ReservedRequest, responseType: HealthResponse })
  class HealthHandler implements IMessageHandler<ReservedRequest, HealthResponse> {
    handleAsync(): Promise<IBenzeneResultOf<HealthResponse>> {
      return Promise.resolve(BenzeneResult.ok(health as unknown as HealthResponse));
    }
  }

  const entryPoint = compositeAwsLambda((c) => {
    c.configureServices((s) => {
      addBenzene(s);

      // --- the feeds `useSpec` reads to build the benzene spec document (see the file header) --------------
      // Payload schemas: derived from the Zod schemas the domain payloads registered (services.ts).
      s.addSingletonInstance(ITypeJsonSchemaSource, new ZodJsonSchemaSource());
      // httpMappings: correlate each handler's @httpEndpoint with its @message topic (idempotent — tryAdd).
      addHttpMessageHandlers(s);
      // events[]: declare the produced topics so they surface in the spec (→ the structural topology).
      if (produces.length > 0 && eventPayloadType !== undefined) {
        addResponseEventDeclarations(s, ...produces.map((topic) => new ResponseEventDefinition(topic, eventPayloadType)));
      }
      // transports[]: declared here (the composite is multi-container, so we can't auto-aggregate across
      // routes); the benzene direct-invoke surface is the interrogation channel, not a listen transport.
      s.addSingletonInstance(ITransportsInfo, new TransportsInfo([...transports].map((t) => new TransportInfo(t))));

      // --- runtime outbound routing (unchanged): a handler's send reaches the bus / a real queue/topic/bus --
      if (outbound !== undefined && sends !== undefined && sends.length > 0) {
        addOutboundRouting(s, (routing) => {
          for (const send of sends) {
            routing.route(send.topic, (p) => {
              if (send.transport === 'sqs') {
                useSqsClient(p, outbound.target(send.topic, 'sqs'), outbound.sqs as SQSClient);
              } else if (send.transport === 'sns') {
                useSnsClient(p, outbound.target(send.topic, 'sns'), outbound.sns as SNSClient);
              } else {
                useEventBridgeClient(p, name, outbound.eventBridge as EventBridgeClient, outbound.target(send.topic, 'eventbridge'));
              }
            });
          }
        });
      }
    });

    // The direct-invoke surface the mesh interrogates: the library spec handler + healthcheck + domain
    // handlers. `useSpec(bm)` owns the reserved `spec` topic (DI-dispatched); it must NOT also appear in the
    // `useMessageHandlers` list, or the two finders would collide on the topic.
    c.route(isBenzeneMessageEvent, (app) =>
      useBenzeneMessage(app, (bm) => useMessageHandlers(useSpec(bm), HealthHandler, ...domainHandlers)),
    );

    // The domain handlers over each transport the service actually listens on.
    if (transports.has('http')) {
      c.route(isApiGatewayEvent, (app) => useApiGateway(app, (api) => useMessageHandlers(api, ...domainHandlers)));
    }
    if (transports.has('sqs')) {
      c.route(isSqsEvent, (app) => useSqs(app, (sqs) => useMessageHandlers(sqs, ...domainHandlers)));
    }
    if (transports.has('sns')) {
      c.route(isSnsEvent, (app) => useSns(app, (sns) => useMessageHandlers(sns, ...domainHandlers)));
    }
    if (transports.has('eventbridge')) {
      c.route(isEventBridgeEvent, (app) => useEventBridge(app, (eb) => useMessageHandlers(eb, ...domainHandlers)));
    }
  });

  return toLambdaHandler(entryPoint);
}

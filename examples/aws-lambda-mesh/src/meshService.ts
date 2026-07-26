/**
 * The shared "make this Lambda a mesh-discoverable Cloud Service" wiring, mirroring the .NET AwsMesh
 * `Shared/MeshServiceWiring`. Each service is a single Lambda (a composite entry point) that:
 *
 *  - answers a **direct Lambda invoke** carrying the reserved `spec`/`healthcheck` topics — the surface the
 *    mesh interrogates (via `@benzene/aws-lambda-core`'s `useBenzeneMessage`), returning a self-derived spec
 *    (`requests`/`events`/`transports`) and a health report;
 *  - hosts its domain handlers over every transport it actually listens on (API Gateway, SQS, SNS,
 *    EventBridge) — the same handler on each, routed by the composite's event-shape predicates;
 *  - **declares** the topics it produces (spec `events`) so the mesh can derive the structural topology
 *    (producer of a topic → every service whose `requests` contain it), exactly as the .NET example does.
 *
 * There are no runtime SQS/SNS/EventBridge *outbound* clients here (those adapter packages aren't ported
 * yet); the structural topology is derived from the declared `events`, which is what the .NET example's
 * topology is built from too — declaring a send is what surfaces it as a producer edge.
 */
import { Constructor, IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { Handler } from 'aws-lambda';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
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
import type { MeshBus } from './bus';

/** A transport a service listens on. */
export type Transport = 'http' | 'sqs' | 'sns' | 'eventbridge';

/** One consumed-topic entry in a service's self-derived spec (`requests`). */
export interface SpecRequest {
  topic: string;
  httpMappings?: { method: string; path: string }[];
}

/** The benzene spec shape the mesh aggregator parses (`requests`/`events`/`transports`). */
export interface ServiceSpec {
  requests: SpecRequest[];
  events: { topic: string }[];
  transports: Transport[];
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
  /** Produced domain topics — declared in the spec's `events` for the structural topology. */
  readonly produces: string[];
  /** Extra transports the service listens on beyond those implied by `consumes` (e.g. `http` for orders). */
  readonly extraTransports?: Transport[];
  /**
   * Runtime outbound sends: the topics this service actually publishes and over which transport. Wires
   * `addOutboundRouting` so a handler's `IBenzeneMessageSender.sendAsync(topic, …)` reaches the bus. The
   * topics should match `produces` (produces drives the structural topology; sends drive the live cascade).
   */
  readonly sends?: { topic: string; transport: Transport }[];
  /** The in-memory bus the outbound sends publish to (delivers to the consuming services). */
  readonly bus?: MeshBus;
}

/** Builds the self-derived benzene spec object for a service definition. */
export function buildServiceSpec(definition: MeshServiceDefinition): ServiceSpec {
  const requests: SpecRequest[] = definition.consumes.map((c) => ({
    topic: c.topic,
    ...(c.httpMappings !== undefined ? { httpMappings: c.httpMappings } : {}),
  }));
  const transports = new Set<Transport>(definition.extraTransports ?? []);
  for (const c of definition.consumes) {
    transports.add(c.transport);
  }
  return {
    requests,
    events: definition.produces.map((topic) => ({ topic })),
    transports: [...transports],
  };
}

/** The health report a service returns over the reserved `healthcheck` topic. */
function buildHealth(name: string): { isHealthy: boolean; checks: { name: string; isHealthy: boolean }[] } {
  return { isHealthy: true, checks: [{ name: `${name}-self`, isHealthy: true }] };
}

/**
 * Builds a service's Lambda `handler`: a composite entry point that answers direct-invoke `spec`/`healthcheck`
 * plus its domain handlers on every transport it listens on. The reserved-topic handlers are defined here so
 * each service closes over its OWN spec/health (a fresh handler class per service, registered in the
 * service's own registry — no cross-service topic collision).
 */
export function buildMeshServiceLambda(definition: MeshServiceDefinition): Handler {
  const { name, registry, domainHandlers } = definition;
  const spec = buildServiceSpec(definition);
  const health = buildHealth(name);

  // The reserved spec/health handlers register into their OWN throwaway registry, never the service's
  // domain `registry` — otherwise `registry.getAll()` would pick them up as domain handlers on a later
  // build and the topics would collide. `useMessageHandlers` reads each class's `@message` metadata
  // directly from the classes passed to it, so a separate registry is invisible to the pipeline.
  const reservedRegistry = new MessageHandlersRegistry();

  // Empty marker request/response classes: the reserved handlers ignore the request and return a plain
  // object the renderer serializes to the invoke's response body (the raw spec/health JSON the mesh reads).
  class ReservedRequest {}
  class SpecResponse {}
  class HealthResponse {}

  @message('spec', { registry: reservedRegistry, requestType: ReservedRequest, responseType: SpecResponse })
  class SpecHandler implements IMessageHandler<ReservedRequest, SpecResponse> {
    handleAsync(): Promise<IBenzeneResultOf<SpecResponse>> {
      return Promise.resolve(BenzeneResult.ok(spec as unknown as SpecResponse));
    }
  }

  @message('healthcheck', { registry: reservedRegistry, requestType: ReservedRequest, responseType: HealthResponse })
  class HealthHandler implements IMessageHandler<ReservedRequest, HealthResponse> {
    handleAsync(): Promise<IBenzeneResultOf<HealthResponse>> {
      return Promise.resolve(BenzeneResult.ok(health as unknown as HealthResponse));
    }
  }

  const transports = new Set(spec.transports);

  const { bus, sends } = definition;

  const entryPoint = compositeAwsLambda((c) => {
    c.configureServices((s) => {
      addBenzene(s);
      // Wire the runtime outbound routes: each sent topic converts to the right transport and publishes to
      // the bus, which delivers to the consuming services. `useX(app, target, client)` — the target string
      // is nominal here (the bus routes by topic), matching how a real deployment names a queue/topic/bus.
      if (bus !== undefined && sends !== undefined && sends.length > 0) {
        addOutboundRouting(s, (routing) => {
          for (const send of sends) {
            routing.route(send.topic, (p) => {
              if (send.transport === 'sqs') {
                useSqsClient(p, `queue:${send.topic}`, bus.sqsClient as SQSClient);
              } else if (send.transport === 'sns') {
                useSnsClient(p, `arn:${send.topic}`, bus.snsClient as SNSClient);
              } else {
                useEventBridgeClient(p, name, bus.eventBridgeClient as EventBridgeClient, `bus:${send.topic}`);
              }
            });
          }
        });
      }
    });

    // The direct-invoke surface the mesh interrogates: reserved spec/health + the domain handlers.
    c.route(isBenzeneMessageEvent, (app) =>
      useBenzeneMessage(app, (bm) => useMessageHandlers(bm, SpecHandler, HealthHandler, ...domainHandlers)),
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

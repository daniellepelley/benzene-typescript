/** Port of Benzene.CloudService.CloudServiceBuilder (and ICloudServiceBuilder). */
import { randomUUID } from 'node:crypto';
import { Constructor, ServiceIdentifier, VoidResult } from '@benzenejs/abstractions';
import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { IMessageSenderDefinition } from '@benzenejs/abstractions-messages';
import { BenzeneMessageContext, MessageSenderDefinition } from '@benzenejs/core-messages';
import { IHealthCheck } from '@benzenejs/health-checks-core';
import { IMeshTraceExporter, MeshPlacement, MeshServiceInfo } from '@benzenejs/mesh-wire';
import { CloudServicePaths } from './CloudServicePaths';
import type { CloudServiceProfileReport } from './CloudServiceProfileReport';

/**
 * Configures a Benzene Cloud Service (docs/specification/cloud-service-profile.md). Every setting has a
 * profile-conformant default; overriding one is always allowed (the extension-point rule of
 * design-principles.md §4 is not suspended by the profile), and overrides that step outside the profile
 * are reflected honestly in the service's {@link CloudServiceProfileReport} rather than refused.
 */
export interface ICloudServiceBuilder {
  /** Sets the service version reported in the descriptor (participates in the contract hash). */
  withServiceVersion(serviceVersion: string): ICloudServiceBuilder;

  /** Sets the instance id reported in the descriptor, traces, and heartbeats. Defaults to a generated per-process id. */
  withInstanceId(instanceId: string): ICloudServiceBuilder;

  /**
   * Sets the placement reported in the descriptor. Per mesh.md §2, only set a region the platform actually
   * documents — never guess. When not set, placement defaults to `self-hosted`.
   */
  withPlacement(cloud: string, region?: string): ICloudServiceBuilder;

  /**
   * Sets the collector's envelope URL, enabling the outbound mesh feeds (profile R6): `mesh:register` on
   * startup, `mesh:heartbeat`, and the `mesh:traces` feed. Without a collector the service still serves its
   * descriptor on the reserved `mesh` topic, but the outbound feeds have nowhere to go and R6 is reported as
   * missing.
   */
  withCollector(collectorEnvelopeUrl: string): ICloudServiceBuilder;

  /** Adds health checks run for the reserved `healthcheck` topic and included in heartbeats (profile R3). */
  withHealthChecks(...healthChecks: IHealthCheck[]): ICloudServiceBuilder;

  /**
   * Registers the message handler types the service serves (profile R2). When given, the descriptor is
   * derived eagerly at wire-up and mesh registration starts immediately; when omitted, handlers come from
   * the container's existing registrations and the descriptor is derived on the first invocation instead.
   */
  withHandlers(...handlerTypes: Constructor<unknown>[]): ICloudServiceBuilder;

  /**
   * Declares an outbound topic this service may send (mesh.md §2.3's outbound registration) - no handler,
   * since nothing here receives. This is what populates the descriptor's `produces` field, the sole source
   * a collector reads to build this service's PROVIDER edges (mesh.md §4) - a topic never declared here is
   * never a provider edge, however much traffic actually flows. Mirrors `withHandlers` for the inbound side;
   * `requestType`/`responseType` default to "no payload" (matching `MessageSenderDefinition.create`'s
   * `VoidResult` sentinel) when the service doesn't need §2.1 schema derivation for this topic.
   */
  withProduces(
    topic: string,
    requestType?: ServiceIdentifier<unknown>,
    responseType?: ServiceIdentifier<unknown>,
    version?: string,
  ): ICloudServiceBuilder;

  /**
   * The former name of {@link withProduces}, kept so existing composition roots still compile.
   *
   * @deprecated The 2026-08 role inversion (mesh.md §4) made a service's outbound registration its
   * PRODUCER claim, so the old name says the opposite of what the method does. Use `withProduces`.
   */
  withConsumes(
    topic: string,
    requestType?: ServiceIdentifier<unknown>,
    responseType?: ServiceIdentifier<unknown>,
    version?: string,
  ): ICloudServiceBuilder;

  /**
   * Adds custom middleware to the wire-envelope pipeline, inside the profile's own middleware (trace,
   * health, descriptor) and before the message router. Custom middleware for the outer HTTP pipeline needs
   * no hook: add it to that pipeline before calling `useBenzeneCloudService`.
   */
  withMiddleware(configure: PipelineBuilderAction<BenzeneMessageContext>): ICloudServiceBuilder;

  /** Relocates the wire-envelope endpoint from {@link CloudServicePaths.invoke} (flags R7 in the profile report). */
  withInvokePath(path: string): ICloudServiceBuilder;

  /** Relocates the spec endpoint from {@link CloudServicePaths.spec} (flags R7 in the profile report). */
  withSpecPath(path: string): ICloudServiceBuilder;

  /** Relocates the health endpoint from {@link CloudServicePaths.health} (flags R7 in the profile report). */
  withHealthPath(path: string): ICloudServiceBuilder;

  /**
   * Replaces the default HTTP trace exporter (an extension point, not a profile deviation). The cloud
   * service takes ownership of the exporter's lifetime: it is registered as a singleton and disposed on
   * container shutdown (its `disposeAsync` flushes the tail trace batch), so the supplied exporter must
   * tolerate being disposed by the container.
   */
  withTraceExporter(traceExporter: IMeshTraceExporter): ICloudServiceBuilder;

  /**
   * Runs `callback` with the wiring-time {@link CloudServiceProfileReport} once it has been evaluated, for
   * services (or tests) that want to inspect the self-assessment at wire-up without resolving it back out of
   * DI — e.g. logging a startup warning when the profile isn't fully met. The same report is also registered
   * in DI and stamped on the descriptor (mesh.md §2's `profile` field); this is a convenience for the
   * wire-up call site itself.
   */
  withProfileReport(callback: (report: CloudServiceProfileReport) => void): ICloudServiceBuilder;

  /**
   * Declines the mesh feeds entirely: no reserved `mesh` topic, no trace middleware, no registration or
   * heartbeats. The service remains a working Benzene Core service and the profile report marks R6 and R8 as
   * missing — use this for a deliberate opt-out, not as a substitute for simply not configuring a collector.
   */
  withoutMesh(): ICloudServiceBuilder;
}

/**
 * The concrete configuration surface. C# `internal sealed class` → an exported class (TypeScript has no
 * `internal`; it is not re-exported from a public entry point beyond the interface). Its readable settings
 * are consumed by {@link CloudServiceProfileReport.evaluate} and the wiring extension.
 */
export class CloudServiceBuilder implements ICloudServiceBuilder {
  constructor(readonly serviceName: string) {}

  serviceVersion?: string;
  instanceId?: string;
  placement?: MeshPlacement;
  collectorEnvelopeUrl?: string;
  readonly healthChecks: IHealthCheck[] = [];
  handlerTypes?: Constructor<unknown>[];
  readonly producesDefinitions: IMessageSenderDefinition[] = [];
  envelopeMiddleware?: PipelineBuilderAction<BenzeneMessageContext>;
  invokePath: string = CloudServicePaths.invoke;
  specPath: string = CloudServicePaths.spec;
  healthPath: string = CloudServicePaths.health;
  traceExporter?: IMeshTraceExporter;
  meshEnabled = true;
  profileReportCallback?: (report: CloudServiceProfileReport) => void;

  get usesDefaultPaths(): boolean {
    return (
      this.invokePath === CloudServicePaths.invoke &&
      this.specPath === CloudServicePaths.spec &&
      this.healthPath === CloudServicePaths.health
    );
  }

  buildServiceInfo(): MeshServiceInfo {
    return new MeshServiceInfo(
      this.serviceName,
      this.serviceVersion,
      this.instanceId ?? `${this.serviceName}-${randomUUID().replace(/-/g, '').slice(0, 4)}`,
      'http',
      this.placement,
    );
  }

  withServiceVersion(serviceVersion: string): ICloudServiceBuilder {
    this.serviceVersion = serviceVersion;
    return this;
  }

  withInstanceId(instanceId: string): ICloudServiceBuilder {
    this.instanceId = instanceId;
    return this;
  }

  withPlacement(cloud: string, region?: string): ICloudServiceBuilder {
    const placement = new MeshPlacement();
    placement.cloud = cloud;
    placement.region = region;
    this.placement = placement;
    return this;
  }

  withCollector(collectorEnvelopeUrl: string): ICloudServiceBuilder {
    this.collectorEnvelopeUrl = collectorEnvelopeUrl;
    return this;
  }

  withHealthChecks(...healthChecks: IHealthCheck[]): ICloudServiceBuilder {
    this.healthChecks.push(...healthChecks);
    return this;
  }

  withHandlers(...handlerTypes: Constructor<unknown>[]): ICloudServiceBuilder {
    this.handlerTypes = this.handlerTypes === undefined ? handlerTypes : [...this.handlerTypes, ...handlerTypes];
    return this;
  }

  withProduces(
    topic: string,
    requestType: ServiceIdentifier<unknown> = VoidResult,
    responseType: ServiceIdentifier<unknown> = VoidResult,
    version = '',
  ): ICloudServiceBuilder {
    this.producesDefinitions.push(MessageSenderDefinition.create(topic, requestType, responseType, VoidResult, version));
    return this;
  }

  /** @deprecated Use {@link withProduces}. */
  withConsumes(
    topic: string,
    requestType: ServiceIdentifier<unknown> = VoidResult,
    responseType: ServiceIdentifier<unknown> = VoidResult,
    version = '',
  ): ICloudServiceBuilder {
    return this.withProduces(topic, requestType, responseType, version);
  }

  withMiddleware(configure: PipelineBuilderAction<BenzeneMessageContext>): ICloudServiceBuilder {
    // C# combines multicast delegates with `+=`; the port chains the actions in registration order.
    const previous = this.envelopeMiddleware;
    this.envelopeMiddleware =
      previous === undefined
        ? configure
        : (builder) => {
            previous(builder);
            configure(builder);
          };
    return this;
  }

  withInvokePath(path: string): ICloudServiceBuilder {
    this.invokePath = path;
    return this;
  }

  withSpecPath(path: string): ICloudServiceBuilder {
    this.specPath = path;
    return this;
  }

  withHealthPath(path: string): ICloudServiceBuilder {
    this.healthPath = path;
    return this;
  }

  withTraceExporter(traceExporter: IMeshTraceExporter): ICloudServiceBuilder {
    this.traceExporter = traceExporter;
    return this;
  }

  withoutMesh(): ICloudServiceBuilder {
    this.meshEnabled = false;
    return this;
  }

  withProfileReport(callback: (report: CloudServiceProfileReport) => void): ICloudServiceBuilder {
    const previous = this.profileReportCallback;
    this.profileReportCallback =
      previous === undefined
        ? callback
        : (report) => {
            previous(report);
            callback(report);
          };
    return this;
  }
}

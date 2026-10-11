/** Port of Benzene.CloudService.CloudServiceBuilder (and ICloudServiceBuilder). */
import { randomUUID } from 'node:crypto';
import { Constructor, ServiceIdentifier, VoidResult } from '@benzenejs/abstractions';
import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { BenzeneMessageContext } from '@benzenejs/core-messages';
import { IHealthCheck } from '@benzenejs/health-checks-core';
import { IMeshTraceExporter, MeshOutboundRegistry, MeshServiceInfo } from '@benzenejs/mesh-wire';
import { ServicePlacement } from '@benzenejs/schema-openapi';
import { CloudServicePaths } from './CloudServicePaths';
import type { CloudServiceProfileReport } from './CloudServiceProfileReport';

/**
 * Configures a Benzene Cloud Service (docs/specification/cloud-service-profile.md). Every setting has a
 * profile-conformant default; overriding one is always allowed (the extension-point rule of
 * design-principles.md §4 is not suspended by the profile), and overrides that step outside the profile
 * are reflected honestly in the service's {@link CloudServiceProfileReport} rather than refused.
 */
export interface ICloudServiceBuilder {
  /**
   * Sets the release this is: the Contract Document's `serviceVersion` (with `versionScheme` - `integer`,
   * `semver` or `lexicographic` - when the version is orderable, service-versions.md §2), and the
   * `serviceVersion` on heartbeats. Outside both hashes.
   */
  withServiceVersion(serviceVersion: string, versionScheme?: string): ICloudServiceBuilder;

  /** Sets the instance id reported on traces and heartbeats. Defaults to a generated per-process id. */
  withInstanceId(instanceId: string): ICloudServiceBuilder;

  /**
   * Sets the Contract Document's `placement` (contract-document.md §1). Only set a region the platform actually
   * documents — never guess. When not set, placement defaults to `self-hosted`.
   */
  withPlacement(cloud: string, region?: string): ICloudServiceBuilder;

  /**
   * Sets the collector's envelope URL, enabling the outbound mesh feeds (profile R6): `benzene:mesh:register` on
   * startup (its body the Contract Document `benzene:spec` serves), `benzene:mesh:heartbeat`, and the
   * `benzene:mesh:traces` feed. Without a collector the service still answers `benzene:spec`, but the outbound
   * feeds have nowhere to go and R6 is reported as missing.
   */
  withCollector(collectorEnvelopeUrl: string): ICloudServiceBuilder;

  /** Adds health checks run for the reserved `benzene:healthcheck` topic and included in heartbeats (profile R3). */
  withHealthChecks(...healthChecks: IHealthCheck[]): ICloudServiceBuilder;

  /**
   * Registers the message handler types the service serves (profile R2), on both the HTTP and the envelope
   * pipelines; when omitted, handlers come from the container's existing registrations. Either way the
   * Contract Document - the `requests` it lists, and the registration - is derived from the host container.
   */
  withHandlers(...handlerTypes: Constructor<unknown>[]): ICloudServiceBuilder;

  /**
   * Declares what this service puts on the wire (contract-document.md §3.3): the events it publishes and the
   * sends it makes to topics other parties define, as a {@link MeshOutboundRegistry}. The declarations feed the
   * Contract Document's `events[]`/`sends[]`, which make this service a provider in the mesh graph (mesh.md §4)
   * — a topic never declared is never a provider edge, however much traffic flows. May be called more than
   * once; the declarations accumulate (a topic declared both as an event and a send throws). Calling it, even
   * with an empty registry, asserts the declarations are complete; without it the document names `events` and
   * `sends` in `degraded` (unknown, not "none").
   */
  withOutbound(outbound: MeshOutboundRegistry): ICloudServiceBuilder;

  /**
   * Declares one send: a message to `topic`, whose contract another party defines.
   *
   * @deprecated Use {@link withOutbound} with `{ kind: 'send', ... }` — or `{ kind: 'event', ... }` for a topic
   * this service publishes and defines. Kept so existing composition roots compile; it always declares a
   * send, and `responseType` is the reply's type (omitted: one-way).
   */
  withProduces(
    topic: string,
    requestType?: ServiceIdentifier<unknown>,
    responseType?: ServiceIdentifier<unknown>,
    version?: string,
  ): ICloudServiceBuilder;

  /**
   * The former name of {@link withProduces}.
   *
   * @deprecated Use {@link withOutbound}.
   */
  withConsumes(
    topic: string,
    requestType?: ServiceIdentifier<unknown>,
    responseType?: ServiceIdentifier<unknown>,
    version?: string,
  ): ICloudServiceBuilder;

  /**
   * Adds custom middleware to the wire-envelope pipeline, inside the profile's own middleware (trace,
   * health) and before the message router. Custom middleware for the outer HTTP pipeline needs
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
   * in DI and stamped on the Contract Document (contract-document.md §1's `profile` field); this is a
   * convenience for the wire-up call site itself.
   */
  withProfileReport(callback: (report: CloudServiceProfileReport) => void): ICloudServiceBuilder;

  /**
   * Declines the mesh feeds entirely: no trace middleware, no registration or heartbeats (`benzene:spec` is still
   * served - it is the R5 document). The service remains a working Benzene Core service and the profile report
   * marks R6 and R8 as missing — use this for a deliberate opt-out, not as a substitute for simply not
   * configuring a collector.
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
  versionScheme?: string;
  instanceId?: string;
  placement?: ServicePlacement;
  collectorEnvelopeUrl?: string;
  readonly healthChecks: IHealthCheck[] = [];
  handlerTypes?: Constructor<unknown>[];
  /** The outbound declarations (`withOutbound`), feeding the Contract Document's events/sends. */
  readonly outbound = new MeshOutboundRegistry();
  /** True once `withOutbound`/`withProduces` was called: the declarations are then complete, even if empty. */
  outboundDeclared = false;
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

  /** The identity stamped on traces and heartbeats. */
  buildServiceInfo(): MeshServiceInfo {
    return new MeshServiceInfo(
      this.serviceName,
      this.serviceVersion,
      this.instanceId ?? `${this.serviceName}-${randomUUID().replace(/-/g, '').slice(0, 4)}`,
    );
  }

  /** The Contract Document's `placement`: the configured one, else `self-hosted`. */
  buildPlacement(): ServicePlacement {
    return this.placement ?? { cloud: 'self-hosted' };
  }

  withServiceVersion(serviceVersion: string, versionScheme?: string): ICloudServiceBuilder {
    this.serviceVersion = serviceVersion;
    this.versionScheme = versionScheme;
    return this;
  }

  withInstanceId(instanceId: string): ICloudServiceBuilder {
    this.instanceId = instanceId;
    return this;
  }

  withPlacement(cloud: string, region?: string): ICloudServiceBuilder {
    this.placement = region === undefined || region === '' ? { cloud } : { cloud, region };
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

  withOutbound(outbound: MeshOutboundRegistry): ICloudServiceBuilder {
    this.outboundDeclared = true;
    for (const declaration of outbound.getAllDeclarations()) {
      this.outbound.register(declaration);
    }
    return this;
  }

  /** @deprecated Use {@link withOutbound}. */
  withProduces(
    topic: string,
    requestType: ServiceIdentifier<unknown> = VoidResult,
    responseType: ServiceIdentifier<unknown> = VoidResult,
    version = '',
  ): ICloudServiceBuilder {
    this.outboundDeclared = true;
    this.outbound.register({
      kind: 'send',
      topic,
      version,
      request: requestType,
      response: responseType === VoidResult ? undefined : responseType,
    });
    return this;
  }

  /** @deprecated Use {@link withOutbound}. */
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

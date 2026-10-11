/** Port of Benzene.CloudService.Extensions (the useBenzeneCloudService entry point). */
import { BenzeneTopic, IStartUpCheck, IServiceResolver } from '@benzenejs/abstractions';
import { IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import {
  MessageHandlerDefinition,
  setApplicationInfo,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { IMeshOutboundDefinitionLookUp } from '@benzenejs/abstractions-messages';
import { BenzeneMessageContext, RawStringMessage } from '@benzenejs/core-messages';
import { Constants as HealthCheckConstants, useHealthCheck } from '@benzenejs/health-checks';
import {
  BenzeneMessageHttpOptions,
  HttpEndpointDefinition,
  IHttpContext,
  IHttpEndpointDefinition,
  useBenzeneMessage,
} from '@benzenejs/http';
import {
  BenzeneMessageMeshStatusReader,
  HttpMeshTraceExporter,
  IMeshTraceExporter,
  useMeshTrace,
} from '@benzenejs/mesh-wire';
import {
  Constants as SchemaConstants,
  setServiceDeploymentInfo,
  SpecRequest,
  useSpec,
} from '@benzenejs/schema-openapi';
import { CloudServiceBuilder, ICloudServiceBuilder } from './CloudServiceBuilder';
import { CloudServiceContractDocumentSource, CloudServiceSpecMessageHandler } from './CloudServiceContractDocumentSource';
import { CloudServiceProfileReport } from './CloudServiceProfileReport';
import { MeshAnnouncer } from './MeshAnnouncer';

/**
 * The batteries-included setup for a Benzene Cloud Service (docs/specification/cloud-service-profile.md).
 * One call wires every operational surface the profile requires, at the default service standard paths, so
 * the service works with the mesh, the Spec UI, and fleet tooling out of the box:
 *
 * - the wire-envelope endpoint at `/benzene/invoke` (R4)
 * - the derived Contract Document at `/benzene/spec` and on the `benzene:spec` topic of every surface (R5)
 * - health checks on the reserved topic and at `/benzene/health` (R3)
 * - the trace feed, and registration of that same Contract Document plus heartbeats with a collector — the
 *   meshed-service claim's M1 and M2 (mesh.md §7.1), reported separately from the profile
 * - message handlers via the registry, routed on both the HTTP and envelope pipelines (R1, R2)
 *
 * This is syntactic sugar over the same pipeline builders Benzene Core setup uses — nothing here is a new
 * capability, only the profile's steers pre-wired in the right order. Anything can be overridden through
 * {@link ICloudServiceBuilder}; overrides that step outside the profile are reflected in the
 * {@link CloudServiceProfileReport} carried on the service's Contract Document (its `profile` field).
 *
 * C# extension method `UseBenzeneCloudService` → a free function taking the pipeline builder first. Add your
 * own HTTP middleware to the pipeline BEFORE this call (it runs outermost); this call ends with the message
 * router, so it is terminal.
 *
 * Divergence from C#: the wire-envelope pipeline is nested via `useBenzeneMessage`, which — under
 * TypeScript's generic erasure — gives the envelope pipeline its own DI container (see that function's
 * remarks). The mesh singletons (announcer, trace exporter, profile report) and everything the Contract
 * Document is derived from are therefore registered on the OUTER (host) container; the envelope pipeline's
 * `benzene:spec` handler runs on a scope of that host container (see {@link CloudServiceContractDocumentSource}).
 * Registration starts at host boot, from a start-up hook (`cloud-service-registration`) that attaches the host
 * container - every host runs start-up checks - or, for a host that runs none, on the first invocation.
 */
export function useBenzeneCloudService<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  serviceName: string,
  configure?: (builder: ICloudServiceBuilder) => void,
): IMiddlewarePipelineBuilder<TContext> {
  if (serviceName === undefined || serviceName.trim() === '') {
    throw new Error("A cloud service needs a logical service name (the Contract Document's required `service`).");
  }

  const builder = new CloudServiceBuilder(serviceName);
  configure?.(builder);

  const info = builder.buildServiceInfo();
  const report = CloudServiceProfileReport.evaluate(builder);
  builder.profileReportCallback?.(report);
  const documentSource = new CloudServiceContractDocumentSource();
  const healthChecks = [...builder.healthChecks];

  const announcer =
    builder.meshEnabled && builder.collectorEnvelopeUrl !== undefined
      ? new MeshAnnouncer(info, documentSource, builder.collectorEnvelopeUrl, healthChecks)
      : undefined;
  const traceExporter: IMeshTraceExporter | undefined = builder.meshEnabled
    ? (builder.traceExporter ??
      (builder.collectorEnvelopeUrl === undefined
        ? undefined
        : new HttpMeshTraceExporter((url, init) => fetch(url, init), builder.collectorEnvelopeUrl, 16, 1000)))
    : undefined;

  app.register((x) => {
    // The logical service name, release and version scheme are the application's info: the one source of the
    // Contract Document's identity (and of the log scope and the benzene.service span attribute).
    setApplicationInfo(x, serviceName, builder.serviceVersion ?? '', '', builder.versionScheme);
    // The deployment-side fields of the same document (contract-document.md §1): placement and the profile
    // self-assessment, outside both hashes.
    setServiceDeploymentInfo(x, { placement: builder.buildPlacement(), profile: report.toProfile() });
    x.addSingletonFactory(CloudServiceProfileReport, () => report);
    // The outbound declarations feed the Contract Document's events/sends (contract-document.md §3.3). Declared
    // (even empty) means complete; never declared leaves events/sends degraded (unknown).
    if (builder.outboundDeclared) {
      x.addSingletonInstance(IMeshOutboundDefinitionLookUp, builder.outbound);
    }
    x.addSingletonFactory(
      IHttpEndpointDefinition,
      () => new HttpEndpointDefinition('get', builder.specPath, SchemaConstants.DefaultSpecTopic),
    );
    x.addSingletonFactory(
      IHttpEndpointDefinition,
      () => new HttpEndpointDefinition('get', builder.healthPath, HealthCheckConstants.defaultHealthCheckTopic),
    );
    if (announcer !== undefined) {
      x.addSingletonFactory(MeshAnnouncer, () => announcer);
    }
    if (traceExporter !== undefined) {
      x.addSingletonFactory(IMeshTraceExporter, () => traceExporter);
    }
    // Attach the host container at boot and start registering, before any traffic (see the remarks above).
    x.addSingletonFactory(IStartUpCheck, () => new CloudServiceRegistrationStartUp(documentSource, announcer));
  });

  // A factory-registered singleton is only disposed by the container once something resolves it. The
  // announcer and exporter are otherwise only used via captured locals, so resolve each once, on the first
  // invocation on the outer pipeline, so container disposal stops the loop and flushes the tail.
  let meshRealized = false;
  const realizeMeshDisposables = <TCtx>(pipeline: IMiddlewarePipelineBuilder<TCtx>): void => {
    if (announcer === undefined && traceExporter === undefined) {
      return;
    }
    pipeline.useFn('RealizeMeshDisposables', (_context, next, resolver) => {
      if (!meshRealized) {
        meshRealized = true;
        if (announcer !== undefined) {
          resolver.getService(MeshAnnouncer);
        }
        if (traceExporter !== undefined) {
          resolver.getService(IMeshTraceExporter);
        }
      }
      return next();
    });
  };

  // Realize the mesh disposables, attach the host container and (when boot did not) start the announcer on the
  // OUTER pipeline, placed AHEAD of the invoke endpoint below. The endpoint short-circuits `POST {invokePath}`
  // without calling `next`, and the envelope pipeline has its own container (so it can't realize the outer
  // container's singletons or derive the document), so this is the only place invoke-only traffic passes
  // through them (C# realizes on the envelope pipeline's first middleware; the port moves it in front of the
  // short-circuit on the outer pipeline instead).
  realizeMeshDisposables(app);
  useAttachHost(app, documentSource, announcer);

  // The wire-envelope surface (R4) and, inside it, the mesh feeds (M1/M2): trace outermost so it sees every
  // invocation, then health interception and the `benzene:spec` self-description, then the app's own
  // middleware, then the router.
  const options = new BenzeneMessageHttpOptions();
  options.path = builder.invokePath;
  useBenzeneMessage(app, options, (envelope) => {
    // The envelope pipeline runs in its own container (see the function remarks); carry the app name onto it.
    envelope.register((x) => setApplicationInfo(x, serviceName, builder.serviceVersion ?? '', '', builder.versionScheme));
    if (traceExporter !== undefined) {
      useMeshTrace(envelope, info, traceExporter, new BenzeneMessageMeshStatusReader());
    }
    useHealthCheck(envelope, HealthCheckConstants.defaultHealthCheckTopic, healthChecks);
    useEnvelopeSpec(envelope, documentSource);
    builder.envelopeMiddleware?.(envelope);
    useHandlers(envelope, builder);
  });

  // The HTTP-native surfaces: spec (R5) and health (R3) at their default-standard paths (R7), and the app's
  // own HTTP-routed topics through the same registry (R2).
  useSpec(app);
  useHealthCheck(app, HealthCheckConstants.defaultHealthCheckTopic, healthChecks);
  useHandlers(app, builder);

  return app;
}

function useHandlers<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  builder: CloudServiceBuilder,
): void {
  if (builder.handlerTypes !== undefined) {
    useMessageHandlers(app, ...builder.handlerTypes);
  } else {
    useMessageHandlers(app);
  }
}

/**
 * The envelope pipeline's `benzene:spec` (Cloud Service Profile R5: `benzene:spec` wherever a reply is carried):
 * a handler run on a scope of the host container, answering exactly what `GET /benzene/spec` does.
 */
function useEnvelopeSpec(
  envelope: IMiddlewarePipelineBuilder<BenzeneMessageContext>,
  documentSource: CloudServiceContractDocumentSource,
): void {
  envelope.register((x) => {
    x.addSingletonInstance(
      IMessageHandlerDefinition,
      MessageHandlerDefinition.createInstance(
        BenzeneTopic.spec,
        '',
        SpecRequest,
        RawStringMessage,
        CloudServiceSpecMessageHandler,
      ),
    );
    x.addScopedFactory(CloudServiceSpecMessageHandler, () => new CloudServiceSpecMessageHandler(documentSource));
  });
}

/**
 * Attaches the host container to the document source and starts the announcer, on the first invocation of
 * the outer pipeline - the fallback for a host that ran no start-up checks. A no-op once attached and started.
 */
function useAttachHost<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  documentSource: CloudServiceContractDocumentSource,
  announcer: MeshAnnouncer | undefined,
): void {
  app.useFn('CloudServiceAttachHost', (_context, next, resolver) => {
    documentSource.attach(resolver);
    announcer?.ensureStarted();
    return next();
  });
}

/**
 * The boot-time hook: attaches the host container to the document source and starts registration, so a
 * collector learns the service's contract before any traffic (mesh.md §4: the graph is the declared contract).
 * It rides the start-up-check phase because that is the one boot hook every host runs; it never fails start-up
 * itself (an underivable document is the `contract-document` check's to report) and only starts the
 * best-effort, non-blocking announce loop (mesh.md §6).
 */
class CloudServiceRegistrationStartUp implements IStartUpCheck {
  readonly name = 'cloud-service-registration';

  constructor(
    private readonly documentSource: CloudServiceContractDocumentSource,
    private readonly announcer: MeshAnnouncer | undefined,
  ) {}

  check(resolver: IServiceResolver): void {
    this.documentSource.attach(resolver);
    this.announcer?.ensureStarted();
  }
}

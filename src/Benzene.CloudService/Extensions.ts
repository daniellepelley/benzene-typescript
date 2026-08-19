/** Port of Benzene.CloudService.Extensions (the useBenzeneCloudService entry point). */
import {
  IMessageGetter,
  IMessageHandlerResultSetter,
} from '@benzenejs/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import {
  MessageHandlerDefinition,
  MessageHandlerResult,
  setApplicationInfo,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { BenzeneMessageContext } from '@benzenejs/core-messages';
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
  MeshServiceInfo,
  MeshTopics,
  useMeshTrace,
} from '@benzenejs/mesh-wire';
import { BenzeneResult } from '@benzenejs/results';
import { Constants as SchemaConstants, useSpec } from '@benzenejs/schema-openapi';
import { CloudServiceBuilder, ICloudServiceBuilder } from './CloudServiceBuilder';
import { CloudServiceDescriptorSource } from './CloudServiceDescriptorSource';
import { CloudServiceProfileReport } from './CloudServiceProfileReport';
import { MeshAnnouncer } from './MeshAnnouncer';

/**
 * The batteries-included setup for a Benzene Cloud Service (docs/specification/cloud-service-profile.md).
 * One call wires every operational surface the profile requires, at the default service standard paths, so
 * the service works with the mesh, the Spec UI, and fleet tooling out of the box:
 *
 * - the wire-envelope endpoint at `/benzene/invoke` (R4)
 * - the derived spec at `/benzene/spec` (R5)
 * - health checks on the reserved topic and at `/benzene/health` (R3)
 * - the reserved `mesh` descriptor topic, trace feed, registration, and heartbeats (R6, R8)
 * - message handlers via the registry, routed on both the HTTP and envelope pipelines (R1, R2)
 *
 * This is syntactic sugar over the same pipeline builders Benzene Core setup uses — nothing here is a new
 * capability, only the profile's steers pre-wired in the right order. Anything can be overridden through
 * {@link ICloudServiceBuilder}; overrides that step outside the profile are reflected in the
 * {@link CloudServiceProfileReport} carried on the service's descriptor.
 *
 * C# extension method `UseBenzeneCloudService` → a free function taking the pipeline builder first. Add your
 * own HTTP middleware to the pipeline BEFORE this call (it runs outermost); this call ends with the message
 * router, so it is terminal.
 *
 * Divergence from C#: the wire-envelope pipeline is nested via `useBenzeneMessage`, which — under
 * TypeScript's generic erasure — gives the envelope pipeline its own DI container (see that function's
 * remarks). The mesh singletons (announcer, trace exporter, profile report) are therefore registered on the
 * OUTER (host) container and their `RealizeMeshDisposables` realization runs on the outer pipeline, whose
 * traffic (a platform health/spec probe) is the typical first request.
 */
export function useBenzeneCloudService<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  serviceName: string,
  configure?: (builder: ICloudServiceBuilder) => void,
): IMiddlewarePipelineBuilder<TContext> {
  if (serviceName === undefined || serviceName.trim() === '') {
    throw new Error("A cloud service needs a logical service name (the descriptor's required field).");
  }

  const builder = new CloudServiceBuilder(serviceName);
  configure?.(builder);

  const info = builder.buildServiceInfo();
  const report = CloudServiceProfileReport.evaluate(builder);
  builder.profileReportCallback?.(report);
  const descriptorSource = new CloudServiceDescriptorSource(info, report, builder.handlerTypes, builder.producesDefinitions);
  const healthChecks = [...builder.healthChecks];

  const announcer =
    builder.meshEnabled && builder.collectorEnvelopeUrl !== undefined
      ? new MeshAnnouncer(info, descriptorSource, builder.collectorEnvelopeUrl, healthChecks)
      : undefined;
  const traceExporter: IMeshTraceExporter | undefined = builder.meshEnabled
    ? (builder.traceExporter ??
      (builder.collectorEnvelopeUrl === undefined
        ? undefined
        : new HttpMeshTraceExporter((url, init) => fetch(url, init), builder.collectorEnvelopeUrl, 16, 1000)))
    : undefined;

  app.register((x) => {
    // Make the logical service name the application's name, from the one source of truth (mesh descriptor's
    // info.service + the log scope + the benzene.service span attribute).
    setApplicationInfo(x, serviceName, '', '');
    x.addSingletonFactory(CloudServiceProfileReport, () => report);
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

  // Eager path: handler types were given, so the descriptor exists now — register with the collector
  // immediately, before any traffic. Lazy path: the first invocation triggers registration instead.
  announcer?.ensureStarted(undefined);

  // Realize the mesh disposables and (lazy-path) start the announcer on the OUTER pipeline, placed AHEAD of
  // the invoke endpoint below. The endpoint short-circuits `POST {invokePath}` without calling `next`, and
  // the envelope pipeline has its own container (so it can't realize the outer container's singletons), so
  // this is the only place invoke-only traffic passes through the realize middleware — without it, a host
  // that only ever receives `/benzene/invoke` never resolves the announcer/trace exporter and container
  // shutdown never stops the announce loop or flushes the trace tail (C# realizes on the envelope pipeline's
  // first middleware; the port moves it in front of the short-circuit on the outer pipeline instead).
  realizeMeshDisposables(app);
  useAnnouncerStart(app, announcer, descriptorSource);

  // The wire-envelope surface (R4) and, inside it, the mesh feeds (R6/R8): trace outermost so it sees every
  // invocation, then health and descriptor interception, then the app's own middleware, then the router.
  const options = new BenzeneMessageHttpOptions();
  options.path = builder.invokePath;
  useBenzeneMessage(app, options, (envelope) => {
    // The envelope pipeline runs in its own container (see the function remarks); carry the app name onto it.
    envelope.register((x) => setApplicationInfo(x, serviceName, '', ''));
    useAnnouncerStart(envelope, announcer, descriptorSource);
    if (traceExporter !== undefined) {
      useMeshTrace(envelope, info, traceExporter, new BenzeneMessageMeshStatusReader());
    }
    useHealthCheck(envelope, HealthCheckConstants.defaultHealthCheckTopic, healthChecks);
    if (builder.meshEnabled) {
      useDescriptor(envelope, descriptorSource);
    }
    builder.envelopeMiddleware?.(envelope);
    useHandlers(envelope, builder);
  });

  // The HTTP-native surfaces: spec (R5) and health (R3) at their default-standard paths (R7), and the app's
  // own HTTP-routed topics through the same registry (R2). (`realizeMeshDisposables` / `useAnnouncerStart`
  // are wired above, ahead of the invoke endpoint, so they cover invoke-only traffic too.)
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
 * Reserved `mesh` topic interception (mesh.md §1), like `useMeshDescriptor` but against the shared
 * descriptor source so the lazy path can derive the descriptor from the invocation's registry on first use.
 * C# `TerminalFuncWrapperMiddleware` → `useFn` (the port's short-circuit idiom).
 */
function useDescriptor(
  app: IMiddlewarePipelineBuilder<BenzeneMessageContext>,
  descriptorSource: CloudServiceDescriptorSource,
): void {
  app.useFn('CloudServiceDescriptor', async (context, next, resolver) => {
    const messageGetter = resolver.getService(IMessageGetter);
    const topic = messageGetter.getTopic(context);
    if (topic?.id !== MeshTopics.descriptor) {
      await next();
      return;
    }

    const resultSetter = resolver.getService(IMessageHandlerResultSetter);
    await resultSetter.setResultAsync(
      context,
      new MessageHandlerResult(topic, MessageHandlerDefinition.empty(), BenzeneResult.ok(descriptorSource.get(resolver))),
    );
  });
}

/**
 * On the lazy path, lets the first invocation on either pipeline start registration and heartbeats. Not
 * wired at all when there is no announcer, and skipped when the announcer started eagerly.
 */
function useAnnouncerStart<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  announcer: MeshAnnouncer | undefined,
  descriptorSource: CloudServiceDescriptorSource,
): void {
  if (announcer === undefined || descriptorSource.tryGet() !== undefined) {
    return;
  }

  app.useFn('CloudServiceAnnounce', (_context, next, resolver) => {
    announcer.ensureStarted(resolver);
    return next();
  });
}

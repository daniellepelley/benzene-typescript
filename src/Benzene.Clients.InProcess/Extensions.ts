import { ISerializer, IServiceResolverFactory, ILoggerFactory, IStartUpCheck } from '@benzene/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { OutboundContext } from '@benzene/clients';
import { InProcessClientMiddleware } from './InProcessClientMiddleware';
import { InProcessContextConverter } from './InProcessContextConverter';
import { InProcessDispatcherRegistry } from './InProcessDispatcherRegistry';
import { InProcessFanOutClientMiddleware } from './InProcessFanOutClientMiddleware';
import { InProcessFanOutTarget } from './InProcessFanOutTarget';
import { InProcessMessagingBuilder } from './InProcessMessagingBuilder';
import { InProcessRouteReference } from './InProcessRouteReference';
import { InProcessRouteStartUpCheck } from './InProcessRouteStartUpCheck';
import { DuplicateInProcessFanOutTargetException } from './DuplicateInProcessFanOutTargetException';

/**
 * Records a `useInProcess(name)` reference and registers the boot-time route check (once), so a route naming
 * an unregistered pipeline fails start-up via {@link InProcessRouteStartUpCheck} instead of surfacing as an
 * `InProcessPipelineNotFoundException` at first send.
 */
function recordInProcessRoute(app: IMiddlewarePipelineBuilder<OutboundContext>, pipelineName: string): void {
  app.register((container) => {
    container.addSingletonFactory(InProcessRouteReference, () => new InProcessRouteReference(pipelineName));
    // Register the check once (guarded by its own class token) and expose it in the IStartUpCheck collection.
    if (!container.isTypeRegistered(InProcessRouteStartUpCheck)) {
      container.addSingletonFactory(InProcessRouteStartUpCheck, () => new InProcessRouteStartUpCheck());
      container.addSingletonFactory(IStartUpCheck, (resolver) => resolver.getService(InProcessRouteStartUpCheck));
    }
  });
}

/**
 * Converts an outbound route pipeline (`OutboundRoutingBuilder.route`) to dispatch straight to the
 * named in-process pipeline registered via `addInProcessMessaging(registry =>
 * registry.add(name, ...))`, without leaving the process.
 * Port of Benzene.Clients.InProcess.Extensions.UseInProcess.
 *
 * @param app The outbound pipeline builder to convert.
 * @param name The in-process pipeline's name, matching the name it was added under. Defaults to
 * `InProcessMessagingBuilder.DefaultName` - the single-pipeline `addInProcessMessaging` shape
 * (`registry.add(configure)` with no name) registers under that name.
 *
 * Boot-time validation: the referenced `name` is recorded so {@link InProcessRouteStartUpCheck} fails
 * start-up if nothing registered a pipeline under it — a typo or forgotten `addInProcessMessaging(...)` is
 * caught at INIT instead of surfacing as `InProcessPipelineNotFoundException` at first send.
 */
export function useInProcess(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  name: string = InProcessMessagingBuilder.DefaultName,
): IMiddlewarePipelineBuilder<OutboundContext> {
  recordInProcessRoute(app, name);
  return app.convert(new InProcessContextConverter(), (builder) =>
    builder.use((resolver) =>
      new InProcessClientMiddleware(
        resolver.getService(InProcessDispatcherRegistry).resolve(name),
        resolver.getService(IServiceResolverFactory),
      ),
    ),
  );
}

/**
 * Converts an outbound route pipeline to dispatch to *every* target in `targets` concurrently - the
 * in-monolith equivalent of one SNS topic fanning out to several subscribers. Each target is a
 * (pipeline, topic) pair, **not just a pipeline name**: Benzene's (topic, version) → at most one
 * handler invariant is enforced process-wide, not per in-process pipeline, so two targets reacting
 * to what is conceptually one event must each dispatch under a topic of their own - see
 * `InProcessFanOutTarget` and `DuplicateInProcessFanOutTargetException`.
 * Port of Benzene.Clients.InProcess.Extensions.UseInProcessFanOut.
 *
 * PORT DIVERGENCE from .NET: the route this terminates is Void-only in this port regardless of what
 * `TResponse` a caller requests - see `InProcessContextConverter`'s PORT DIVERGENCE note for why the
 * TypeScript port cannot deserialize into an erased `TResponse` the way .NET's
 * `OutboundResponseTypeMismatchException` mechanism does; requesting a non-`VoidResult` response is
 * therefore undetectable here, not a hard error the way it is in .NET.
 *
 * @param app The outbound pipeline builder to convert.
 * @param targets Every pipeline/topic pair to fan out to. Must be non-empty, with no two targets sharing a topic.
 * @throws Error `targets` is empty.
 * @throws DuplicateInProcessFanOutTargetException Two targets name the same topic.
 */
export function useInProcessFanOut(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  ...targets: InProcessFanOutTarget[]
): IMiddlewarePipelineBuilder<OutboundContext> {
  if (targets.length === 0) {
    throw new Error('useInProcessFanOut requires at least one target.');
  }

  const seenTopics = new Set<string>();
  for (const target of targets) {
    if (seenTopics.has(target.topic)) {
      throw new DuplicateInProcessFanOutTargetException(target.topic);
    }
    seenTopics.add(target.topic);
    recordInProcessRoute(app, target.pipelineName);
  }

  return app.use((resolver) =>
    new InProcessFanOutClientMiddleware(
      targets,
      resolver.getService(InProcessDispatcherRegistry),
      resolver.getService(IServiceResolverFactory),
      resolver.getService(ISerializer),
      resolver.tryGetService(ILoggerFactory),
    ),
  );
}

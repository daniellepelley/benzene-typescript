import { ISerializer, IServiceResolverFactory, ILoggerFactory } from '@benzene/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { OutboundContext } from '@benzene/clients';
import { InProcessClientMiddleware } from './InProcessClientMiddleware';
import { InProcessContextConverter } from './InProcessContextConverter';
import { InProcessDispatcherRegistry } from './InProcessDispatcherRegistry';
import { InProcessFanOutClientMiddleware } from './InProcessFanOutClientMiddleware';
import { InProcessFanOutTarget } from './InProcessFanOutTarget';
import { InProcessMessagingBuilder } from './InProcessMessagingBuilder';
import { DuplicateInProcessFanOutTargetException } from './DuplicateInProcessFanOutTargetException';

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
 * PORT DIVERGENCE from .NET: no boot-time validation runs here. The TypeScript port has no
 * `IStartUpCheck`-equivalent runner (see the package's top-level doc comment in `index.ts`), so a
 * `name` nothing registered surfaces as `InProcessPipelineNotFoundException` at first send, not at
 * start-up.
 */
export function useInProcess(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  name: string = InProcessMessagingBuilder.DefaultName,
): IMiddlewarePipelineBuilder<OutboundContext> {
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

/** Port of Benzene.Mesh.Wire.Extensions (the UseMeshDescriptor half of the descriptor path). */
import {
  IMessageGetter,
  IMessageHandlerResultSetter,
} from '@benzene/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { MessageHandlerDefinition, MessageHandlerResult } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { MeshServiceDescriptor } from './MeshServiceDescriptor';
import { MeshTopics } from './MeshTopics';

/**
 * Intercepts the reserved `mesh` topic (plus any `aliases`) and short-circuits with `descriptor`,
 * exactly as health-check interception works - by topic id alone, ignoring version. Not wiring this
 * in is the "descriptor endpoint withheld" deployment: every other mesh feed keeps working
 * (docs/specification/mesh.md §6). C# extension method -> free function.
 */
export function useMeshDescriptor<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  descriptor: MeshServiceDescriptor,
  ...aliases: string[]
): IMiddlewarePipelineBuilder<TContext> {
  const topics = new Set<string>(aliases);
  topics.add(MeshTopics.descriptor);

  return app.useFn('MeshDescriptor', async (context, next, resolver) => {
    const messageGetter = resolver.getService(IMessageGetter);
    const topic = messageGetter.getTopic(context);
    if (topic?.id == null || !topics.has(topic.id)) {
      await next();
      return;
    }

    const resultSetter = resolver.getService(IMessageHandlerResultSetter);
    await resultSetter.setResultAsync(
      context,
      new MessageHandlerResult(topic, MessageHandlerDefinition.empty(), BenzeneResult.ok(descriptor)),
    );
  });
}

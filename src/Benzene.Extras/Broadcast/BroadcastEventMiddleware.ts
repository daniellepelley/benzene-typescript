/** Port of Benzene.Extras.Broadcast.BroadcastEventMiddleware. */
import { IServiceResolver } from '@benzene/abstractions';
import { IMessageHandlerContext } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { BenzeneResultStatus } from '@benzene/results';
import { IEventSender } from './IEventSender';

/**
 * Handler middleware that publishes a follow-up event after a successful create/update/delete: it runs
 * the handler, then — if the routed topic ends in `create`/`update`/`delete` and the result status is
 * the matching `Created`/`Updated`/`Deleted` — sends `"<topic-id>d"` (e.g. `order:create` →
 * `order:created`) carrying the response payload via the resolved {@link IEventSender}.
 * Port of Benzene.Extras.Broadcast.BroadcastEventMiddleware&lt;TRequest, TResponse&gt;.
 *
 * C# `IServiceResolver.Resolve<IEventSender>()` → `getService(IEventSender)`.
 */
export class BroadcastEventMiddleware<TRequest, TResponse>
  implements IMiddleware<IMessageHandlerContext<TRequest, TResponse>>
{
  constructor(private readonly serviceResolver: IServiceResolver) {}

  readonly name = 'Broadcast Event';

  async handleAsync(context: IMessageHandlerContext<TRequest, TResponse>, next: NextFunc): Promise<void> {
    const eventBroadcaster = this.serviceResolver.getService(IEventSender);

    await next();

    const topicFunction = BroadcastEventMiddleware.topicFunction(context.topic);

    if (
      (topicFunction === 'create' && context.response.status === BenzeneResultStatus.created) ||
      (topicFunction === 'update' && context.response.status === BenzeneResultStatus.updated) ||
      (topicFunction === 'delete' && context.response.status === BenzeneResultStatus.deleted)
    ) {
      await eventBroadcaster.sendAsync(`${context.topic.id}d`, context.response.payload);
    }
  }

  /** Port of C# `TopicFunction` — the last `:`-delimited segment of the topic id. */
  static topicFunction(source: ITopic): string {
    const segments = source.id.split(':');
    return segments[segments.length - 1] as string;
  }
}

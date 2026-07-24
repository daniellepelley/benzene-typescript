import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { IRouteFinder } from '@benzene/http';
import { ExpressContext } from './ExpressContext';

/**
 * Maps an Express request to a Benzene topic by matching its method + path against the registered routes
 * (`IRouteFinder.find`). A `Topic` with an `undefined` id when nothing matches (routing then reports
 * not-found) - though the middleware's route pre-check means a matched route is expected here.
 * Express analog of `Benzene.AspNet.Core.AspNetMessageTopicGetter`.
 */
export class ExpressMessageTopicGetter implements IMessageTopicGetter<ExpressContext> {
  constructor(private readonly routeFinder: IRouteFinder) {}

  getTopic(context: ExpressContext): ITopic | undefined {
    const route = this.routeFinder.find(context.method, context.path);
    return new Topic(route?.topic);
  }
}

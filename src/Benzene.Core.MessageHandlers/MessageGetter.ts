import {
  IMessageGetter,
  IMessageTopicGetter,
} from '@benzene/abstractions-message-handlers';
import {
  IMessageBodyGetter,
  IMessageHeadersGetter,
  ITopic,
} from '@benzene/abstractions-messages';

/**
 * Default `IMessageGetter<TContext>` implementation that composes the individually registered
 * `IMessageTopicGetter`, `IMessageBodyGetter` and `IMessageHeadersGetter` for `TContext` into a
 * single facade, so callers that need all three don't have to depend on each mapper individually.
 * Port of Benzene.Core.MessageHandlers.MessageGetter&lt;TContext&gt;.
 */
export class MessageGetter<TContext> implements IMessageGetter<TContext> {
  constructor(
    private readonly messageTopicGetter: IMessageTopicGetter<TContext>,
    private readonly messageBodyGetter: IMessageBodyGetter<TContext>,
    private readonly messageHeadersGetter: IMessageHeadersGetter<TContext>,
  ) {}

  getBody(context: TContext): string | undefined {
    return this.messageBodyGetter.getBody(context);
  }

  getHeaders(context: TContext): Record<string, string> {
    return this.messageHeadersGetter.getHeaders(context);
  }

  getTopic(context: TContext): ITopic | undefined {
    return this.messageTopicGetter.getTopic(context);
  }
}

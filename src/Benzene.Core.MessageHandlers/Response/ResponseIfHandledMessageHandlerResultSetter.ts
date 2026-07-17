import {
  IMessageHandlerResult,
  IMessageHandlerResultSetter,
  IResponseHandlerContainer,
} from '@benzene/abstractions-message-handlers';
import { Constants } from '../Constants';

/**
 * `IMessageHandlerResultSetter<TContext>` that only writes a response if routing actually reached a
 * real topic (i.e. the topic is set and isn't the `Constants.missing` sentinel), so transports that
 * pass through unrelated/unroutable traffic don't get a response written for it.
 * Port of Benzene.Core.MessageHandlers.Response.ResponseIfHandledMessageHandlerResultSetter&lt;TContext&gt;.
 */
export class ResponseIfHandledMessageHandlerResultSetter<TContext>
  implements IMessageHandlerResultSetter<TContext>
{
  constructor(private readonly responseHandlerContainer: IResponseHandlerContainer<TContext>) {}

  async setResultAsync(context: TContext, messageHandlerResult: IMessageHandlerResult): Promise<void> {
    if (
      messageHandlerResult.topic !== undefined &&
      messageHandlerResult.topic.id !== Constants.missing.id
    ) {
      await this.responseHandlerContainer.handleAsync(context, messageHandlerResult);
    }
  }
}

import { ITopic } from '@benzene/abstractions-messages';
import {
  IMessageHandler,
  IMessageHandlerNoResponse,
  IMessageHandlerWrapper,
} from '@benzene/abstractions-message-handlers';
import { MessageHandlerNoResultWrapper } from './MessageHandlerNoResultWrapper';

/**
 * Pass-through IMessageHandlerWrapper used until a wrapper with real behavior
 * (e.g. the handler-pipeline wrapper) is registered — the default the
 * MessageHandlerFactory falls back to.
 */
export class NullMessageHandlerWrapper implements IMessageHandlerWrapper {
  wrap<TRequest, TResponse>(
    _topic: ITopic,
    messageHandler: IMessageHandler<TRequest, TResponse>,
  ): IMessageHandler<TRequest, TResponse> {
    return messageHandler;
  }

  wrapNoResponse<TRequest, TResponse>(
    _topic: ITopic,
    messageHandler: IMessageHandlerNoResponse<TRequest>,
  ): IMessageHandler<TRequest, TResponse> {
    return new MessageHandlerNoResultWrapper(messageHandler);
  }
}

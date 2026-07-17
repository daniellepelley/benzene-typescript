import { IBenzeneServiceContainer } from '@benzene/abstractions';
import {
  IHandlerMiddlewareBuilder,
  IMessageRouterBuilder,
} from '@benzene/abstractions-message-handlers';

/**
 * Default `IMessageRouterBuilder` implementation, passed to the configuration callback given to the
 * `router`-overloads of the `UseMessageHandlers` pipeline extensions, so application code can
 * register additional `IHandlerMiddlewareBuilder`s and DI registrations for message-handler
 * dispatch.
 * Port of Benzene.Core.MessageHandlers.MessageRouterBuilder.
 */
export class MessageRouterBuilder implements IMessageRouterBuilder {
  private readonly builders: IHandlerMiddlewareBuilder[];

  constructor(
    builders: readonly IHandlerMiddlewareBuilder[],
    private readonly registerCallback: (
      action: (container: IBenzeneServiceContainer) => void,
    ) => void,
  ) {
    this.builders = [...builders];
  }

  add(handlerMiddlewareBuilder: IHandlerMiddlewareBuilder): IMessageRouterBuilder {
    this.builders.push(handlerMiddlewareBuilder);
    return this;
  }

  getBuilders(): IHandlerMiddlewareBuilder[] {
    return [...this.builders];
  }

  register(action: (container: IBenzeneServiceContainer) => void): void {
    this.registerCallback(action);
  }
}

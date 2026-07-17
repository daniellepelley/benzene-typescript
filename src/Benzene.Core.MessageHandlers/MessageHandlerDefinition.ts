import { Constructor, ServiceIdentifier, VoidResult } from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';
import { IMessageHandlerDefinition } from '@benzene/abstractions-message-handlers';
import { Topic } from '@benzene/core-messages';

/**
 * Port of Benzene.Core.MessageHandlers.MessageHandlerDefinition.
 * `VoidResult` stands in for C# `typeof(Void)` as the "no type" sentinel.
 */
export class MessageHandlerDefinition implements IMessageHandlerDefinition {
  private constructor(
    readonly topic: ITopic,
    readonly requestType: ServiceIdentifier<unknown>,
    readonly responseType: ServiceIdentifier<unknown>,
    readonly handlerType: Constructor<unknown>,
  ) {}

  static createInstance(
    topic: string,
    version: string,
    requestType: ServiceIdentifier<unknown>,
    responseType: ServiceIdentifier<unknown>,
    handlerType: Constructor<unknown>,
  ): MessageHandlerDefinition;
  static createInstance(
    topic: string,
    requestType: ServiceIdentifier<unknown>,
    responseType: ServiceIdentifier<unknown>,
    handlerType?: Constructor<unknown>,
  ): MessageHandlerDefinition;
  static createInstance(
    topic: string,
    versionOrRequestType: string | ServiceIdentifier<unknown>,
    requestTypeOrResponseType: ServiceIdentifier<unknown>,
    responseTypeOrHandlerType?: ServiceIdentifier<unknown> | Constructor<unknown>,
    handlerType?: Constructor<unknown>,
  ): MessageHandlerDefinition {
    if (typeof versionOrRequestType === 'string') {
      return new MessageHandlerDefinition(
        new Topic(topic, versionOrRequestType),
        requestTypeOrResponseType,
        responseTypeOrHandlerType as ServiceIdentifier<unknown>,
        handlerType!,
      );
    }

    return new MessageHandlerDefinition(
      new Topic(topic),
      versionOrRequestType,
      requestTypeOrResponseType,
      (responseTypeOrHandlerType as Constructor<unknown> | undefined) ?? VoidResult,
    );
  }

  static empty(): MessageHandlerDefinition {
    return new MessageHandlerDefinition(new Topic('<missing>'), VoidResult, VoidResult, VoidResult);
  }
}

import { Constructor, ServiceIdentifier, VoidResult } from '@benzenejs/abstractions';
import { ITopic } from '@benzenejs/abstractions-messages';
import { IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { Topic } from '@benzenejs/core-messages';

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
    readonly isDefault: boolean = false,
  ) {}

  /**
   * A copy of this definition declared the topic's **default handler** — the one a message carrying no
   * version goes to when the topic has no unversioned handler (core-concepts §2). The decorator form is
   * `@message(topic, { version, isDefault: true })`.
   */
  asDefault(): MessageHandlerDefinition {
    return new MessageHandlerDefinition(this.topic, this.requestType, this.responseType, this.handlerType, true);
  }

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

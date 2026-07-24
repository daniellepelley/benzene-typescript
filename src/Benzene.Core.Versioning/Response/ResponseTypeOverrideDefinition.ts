/** Port of Benzene.Core.Versioning.Response.ResponseTypeOverrideDefinition. */
import { ServiceIdentifier } from '@benzene/abstractions';
import { IMessageHandlerDefinition } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';

/**
 * Wraps a handler definition, overriding only {@link responseType} with the downcast target type so the
 * inner response payload mapper serializes the response as the requested version's shape rather than the
 * handler's canonical response type. Every other member forwards to the original definition unchanged.
 */
export class ResponseTypeOverrideDefinition implements IMessageHandlerDefinition {
  constructor(
    private readonly inner: IMessageHandlerDefinition,
    readonly responseType: ServiceIdentifier<unknown>,
  ) {}

  get topic(): ITopic {
    return this.inner.topic;
  }

  get requestType(): ServiceIdentifier<unknown> {
    return this.inner.requestType;
  }

  get handlerType(): import('@benzene/abstractions').Constructor<unknown> {
    return this.inner.handlerType;
  }
}

import { Constructor, IServiceResolver, VoidResult } from '@benzene/abstractions';
import {
  IHandlerMiddlewareBuilder,
  IMessageHandler,
  IMessageHandlerContext,
} from '@benzene/abstractions-message-handlers';
import { IMiddleware } from '@benzene/abstractions-middleware';
import { getMessageMetadata } from '@benzene/core-message-handlers';
import { ValidationMiddleware } from './ValidationMiddleware';

/**
 * `IHandlerMiddlewareBuilder` that produces a `ValidationMiddleware` for each handler invocation.
 * Port of Benzene.DataAnnotations.ValidationMiddlewareBuilder.
 *
 * Deviation: C# `Create<TRequest, TResponse>` can `new ValidationMiddleware<TRequest, TResponse>()`
 * because `TRequest` is a real runtime type. TypeScript erases it, so the builder recovers the
 * declared request type from the handler's `@message` metadata and passes it to the middleware,
 * which uses it to reconstruct the request into its typed form before validating (see
 * `ValidationMiddleware`). Handlers with no usable request type still get a middleware; it simply
 * validates the request as received.
 */
export class ValidationMiddlewareBuilder implements IHandlerMiddlewareBuilder {
  create<TRequest, TResponse>(
    _serviceResolver: IServiceResolver,
    messageHandler: IMessageHandler<TRequest, TResponse>,
  ): IMiddleware<IMessageHandlerContext<TRequest, TResponse>> | undefined {
    return new ValidationMiddleware<TRequest, TResponse>(resolveRequestType(messageHandler));
  }
}

function resolveRequestType(messageHandler: object): Constructor<unknown> | undefined {
  const handlerType = (messageHandler as object).constructor as Constructor<unknown>;
  const requestType = getMessageMetadata(handlerType)?.requestType;
  return typeof requestType === 'function' && requestType !== VoidResult
    ? (requestType as Constructor<unknown>)
    : undefined;
}

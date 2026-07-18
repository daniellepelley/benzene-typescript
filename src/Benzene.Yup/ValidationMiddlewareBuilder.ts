import { Constructor, IServiceResolver, VoidResult } from '@benzene/abstractions';
import {
  IHandlerMiddlewareBuilder,
  IMessageHandler,
  IMessageHandlerContext,
} from '@benzene/abstractions-message-handlers';
import { IMiddleware } from '@benzene/abstractions-middleware';
import { IValidationStatusMapper } from '@benzene/abstractions-validation';
import { getMessageMetadata } from '@benzene/core-message-handlers';
import { ValidationMiddleware } from './ValidationMiddleware';
import { getYupSchema } from './YupSchemaRegistry';

/**
 * `IHandlerMiddlewareBuilder` that produces a `ValidationMiddleware` for each handler invocation.
 *
 * Port of Benzene.FluentValidation.ValidationMiddlewareBuilder, ADAPTED to Yup.
 *
 * C# resolves `IValidator<TRequest>` from the container inside the middleware, keyed by the runtime
 * `TRequest` type. TypeScript erases `TRequest`, so the builder recovers the declared request type
 * from the handler's `@message` metadata (`getMessageMetadata(...).requestType` — the same recovery
 * the retired data-annotations middleware used) and looks up its Yup schema in `YupSchemaRegistry`.
 * That resolved schema (which may be `undefined` when no schema is registered for the type) and the
 * `IValidationStatusMapper` are handed to the middleware.
 */
export class ValidationMiddlewareBuilder implements IHandlerMiddlewareBuilder {
  create<TRequest, TResponse>(
    serviceResolver: IServiceResolver,
    messageHandler: IMessageHandler<TRequest, TResponse>,
  ): IMiddleware<IMessageHandlerContext<TRequest, TResponse>> | undefined {
    const requestType = resolveRequestType(messageHandler);
    const schema = requestType === undefined ? undefined : getYupSchema(requestType);
    const validationStatusMapper = serviceResolver.getService(IValidationStatusMapper);
    return new ValidationMiddleware<TRequest, TResponse>(schema, validationStatusMapper);
  }
}

function resolveRequestType(messageHandler: object): Constructor<unknown> | undefined {
  const handlerType = messageHandler.constructor as Constructor<unknown>;
  const requestType = getMessageMetadata(handlerType)?.requestType;
  return typeof requestType === 'function' && requestType !== VoidResult
    ? (requestType as Constructor<unknown>)
    : undefined;
}

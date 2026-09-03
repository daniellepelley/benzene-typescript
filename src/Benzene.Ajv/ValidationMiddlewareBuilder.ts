import { Constructor, IServiceResolver, VoidResult } from '@benzenejs/abstractions';
import {
  IHandlerMiddlewareBuilder,
  IMessageHandler,
  IMessageHandlerContext,
} from '@benzenejs/abstractions-message-handlers';
import { IMiddleware } from '@benzenejs/abstractions-middleware';
import { IValidationStatusMapper } from '@benzenejs/abstractions-validation';
import { getMessageMetadata } from '@benzenejs/core-message-handlers';
import { ValidationMiddleware } from './ValidationMiddleware';
import { getJsonSchemaValidator } from './AjvSchemaRegistry';

/**
 * `IHandlerMiddlewareBuilder` that produces a `ValidationMiddleware` for each handler invocation.
 *
 * Port of Benzene.JsonSchema's per-handler wiring, ADAPTED to ajv exactly as the Zod adapter's builder.
 * C# resolves the schema from `IJsonSchemaProvider`, keyed by the topic's request `Type`. TypeScript
 * erases `TRequest`, so the builder recovers the declared request type from the handler's `@message`
 * metadata (`getMessageMetadata(...).requestType`) and looks up its compiled ajv validator in
 * `AjvSchemaRegistry`. That resolved validator (possibly `undefined` when no schema is registered for the
 * type) and the `IValidationStatusMapper` are handed to the middleware.
 *
 * VERSION-AWARENESS (the port of .NET #69's "validate the DECLARED version's schema"): .NET's schema
 * provider joins the message's version signal into its topic lookup itself; here the same guarantee
 * falls out of the architecture — the router routes on the version-joined topic (`getVersionedTopic`,
 * .NET #98), each handler version declares its own request type, and this builder resolves the schema
 * from the ROUTED handler's request type — so a message declaring a version via header validates
 * against exactly that version's registered schema. Pinned by `AjvVersionedValidationPipelineTest`.
 */
export class ValidationMiddlewareBuilder implements IHandlerMiddlewareBuilder {
  create<TRequest, TResponse>(
    serviceResolver: IServiceResolver,
    messageHandler: IMessageHandler<TRequest, TResponse>,
  ): IMiddleware<IMessageHandlerContext<TRequest, TResponse>> | undefined {
    const requestType = resolveRequestType(messageHandler);
    const validate = requestType === undefined ? undefined : getJsonSchemaValidator(requestType);
    const validationStatusMapper = serviceResolver.getService(IValidationStatusMapper);
    return new ValidationMiddleware<TRequest, TResponse>(validate, validationStatusMapper);
  }
}

function resolveRequestType(messageHandler: object): Constructor<unknown> | undefined {
  const handlerType = messageHandler.constructor as Constructor<unknown>;
  const requestType = getMessageMetadata(handlerType)?.requestType;
  return typeof requestType === 'function' && requestType !== VoidResult
    ? (requestType as Constructor<unknown>)
    : undefined;
}

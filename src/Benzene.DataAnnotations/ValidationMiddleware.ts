import { Constructor, VoidResult } from '@benzene/abstractions';
import { IMessageHandlerContext } from '@benzene/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { BenzeneResult } from '@benzene/results';
import { validateObject } from './validateObject';

/**
 * Handler middleware that validates the request via the decorator-based DataAnnotations validator
 * before the handler runs.
 * Port of Benzene.DataAnnotations.ValidationMiddleware&lt;TRequest, TResponse&gt;.
 *
 * Control flow matches C# exactly: a null/undefined request short-circuits with a
 * `ValidationError('Request is null')`; otherwise `validateObject` runs and any errors short-circuit
 * with a `ValidationError(...errors)`; a valid request calls `next`.
 *
 * Deviation: C# validates `context.Request` directly because System.Text.Json deserializes it onto a
 * typed `TRequest` instance whose attributes `Validator` reflects over. The TypeScript request mapper
 * deserializes to a plain object (`JSON.parse`), and `TRequest` is erased, so this middleware
 * reconstructs the request into its declared type (`requestType`, recovered from the handler's
 * `@message` metadata by `ValidationMiddlewareBuilder`) before validating — the same net effect as
 * .NET's typed deserialization. When the request type is unknown, the request is validated as-is.
 */
export class ValidationMiddleware<TRequest, TResponse>
  implements IMiddleware<IMessageHandlerContext<TRequest, TResponse>>
{
  readonly name = 'DataAnnotationValidation';

  constructor(private readonly requestType?: Constructor<unknown>) {}

  async handleAsync(
    context: IMessageHandlerContext<TRequest, TResponse>,
    next: NextFunc,
  ): Promise<void> {
    if (context.request === undefined || context.request === null) {
      context.response = BenzeneResult.validationError<TResponse>('Request is null');
      return;
    }

    const target = this.materialize(context.request);
    const errors = validateObject(target);
    if (errors.length > 0) {
      context.response = BenzeneResult.validationError<TResponse>(...errors);
      return;
    }

    await next();
  }

  private materialize(request: TRequest): object {
    const type = this.requestType;
    if (type === undefined || type === VoidResult || typeof type !== 'function') {
      return request as object;
    }

    const instance = new (type as new () => object)();
    Object.assign(instance, request as object);
    return instance;
  }
}

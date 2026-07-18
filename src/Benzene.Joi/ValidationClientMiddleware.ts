import { Constructor } from '@benzene/abstractions';
import { IBenzeneClientContext } from '@benzene/abstractions-messages';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { BenzeneResult } from '@benzene/results';
import { getJoiSchema } from './JoiSchemaRegistry';

/**
 * Outbound/client-side middleware that validates the message being sent against its Joi schema
 * before it leaves.
 *
 * Port of Benzene.FluentValidation.ValidationClientMiddleware&lt;TRequest, TResponse&gt;, ADAPTED to Joi.
 *
 * On the client side there is no handler to recover the request type from via `@message` metadata,
 * so — unlike C#'s `IValidator<TRequest>` DI resolution — the schema is resolved at runtime from the
 * message instance's own constructor (`message.constructor`) against `JoiSchemaRegistry`. That
 * constructor lookup is the erasure-driven client-side counterpart of C#'s `IValidator<TRequest>`
 * type-keyed resolution.
 *
 * Control flow mirrors C#: no schema registered → `next()`; message null/undefined →
 * `ValidationError('Request is null')`; schema present and `schema.validate` returns an `error` →
 * `ValidationError` with one message per Joi detail. `schema.validate` is synchronous and does NOT
 * throw. The client side uses the plain `ValidationError` status (no status mapper), matching the C#
 * client middleware.
 */
export class ValidationClientMiddleware<TRequest, TResponse>
  implements IMiddleware<IBenzeneClientContext<TRequest, TResponse>>
{
  readonly name = 'JoiValidation';

  async handleAsync(
    context: IBenzeneClientContext<TRequest, TResponse>,
    next: NextFunc,
  ): Promise<void> {
    const message = context.request.message;
    const schema =
      message === undefined || message === null
        ? undefined
        : getJoiSchema((message as object).constructor as Constructor<unknown>);

    if (schema === undefined) {
      // No schema for this message type (or no message to key one off) — nothing to validate.
      // Because the schema is keyed off the message instance, a null/undefined message resolves no
      // schema and falls through here; the explicit "Request is null" guard below mirrors the C#
      // structure for the case where a schema is somehow present without a message.
      await next();
      return;
    }

    if (message === undefined || message === null) {
      context.response = BenzeneResult.validationError<TResponse>('Request is null');
      return;
    }

    const result = schema.validate(message, { abortEarly: false });
    if (result.error !== undefined) {
      const messages = result.error.details.map((detail) => detail.message);
      context.response = BenzeneResult.validationError<TResponse>(...messages);
      return;
    }

    await next();
  }
}

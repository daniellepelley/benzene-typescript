import { Constructor } from '@benzene/abstractions';
import { IBenzeneClientContext } from '@benzene/abstractions-messages';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { BenzeneResult } from '@benzene/results';
import { ValidationError } from 'yup';
import { getYupSchema } from './YupSchemaRegistry';

/**
 * Outbound/client-side middleware that validates the message being sent against its Yup schema
 * before it leaves.
 *
 * Port of Benzene.FluentValidation.ValidationClientMiddleware&lt;TRequest, TResponse&gt;, ADAPTED to Yup.
 *
 * On the client side there is no handler to recover the request type from via `@message` metadata,
 * so — unlike C#'s `IValidator<TRequest>` DI resolution — the schema is resolved at runtime from the
 * message instance's own constructor (`message.constructor`) against `YupSchemaRegistry`. That
 * constructor lookup is the erasure-driven client-side counterpart of C#'s `IValidator<TRequest>`
 * type-keyed resolution.
 *
 * Control flow mirrors C#: no schema registered → `next()`; message null/undefined →
 * `ValidationError('Request is null')`; schema present and `schema.validate` THROWS a Yup
 * `ValidationError` → `ValidationError` with one message per Yup error. Unlike Joi/Zod, Yup validates
 * ASYNCHRONOUSLY and by throwing, hence the `try/catch`. The client side uses the plain
 * `ValidationError` status (no status mapper), matching the C# client middleware.
 */
export class ValidationClientMiddleware<TRequest, TResponse>
  implements IMiddleware<IBenzeneClientContext<TRequest, TResponse>>
{
  readonly name = 'YupValidation';

  async handleAsync(
    context: IBenzeneClientContext<TRequest, TResponse>,
    next: NextFunc,
  ): Promise<void> {
    const message = context.request.message;
    const schema =
      message === undefined || message === null
        ? undefined
        : getYupSchema((message as object).constructor as Constructor<unknown>);

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

    try {
      await schema.validate(message, { abortEarly: false });
    } catch (error) {
      if (error instanceof ValidationError) {
        context.response = BenzeneResult.validationError<TResponse>(...error.errors);
        return;
      }
      throw error;
    }

    await next();
  }
}

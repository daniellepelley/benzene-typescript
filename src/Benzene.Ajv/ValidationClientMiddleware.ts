import { Constructor } from '@benzene/abstractions';
import { IBenzeneClientContext } from '@benzene/abstractions-messages';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { BenzeneResult } from '@benzene/results';
import { getJsonSchemaValidator } from './AjvSchemaRegistry';
import { formatValidationErrors, RequestIsNull } from './JsonSchemaValidationErrors';

/**
 * Outbound/client-side middleware that validates the message being sent against its JSON Schema before it
 * leaves.
 *
 * Port of the client-side half of Benzene.JsonSchema, ADAPTED to ajv exactly as the Zod adapter's client
 * middleware. On the client side there is no handler to recover the request type from via `@message`
 * metadata, so the validator is resolved at runtime from the message instance's own constructor
 * (`message.constructor`) against `AjvSchemaRegistry` — the erasure-driven counterpart of .NET's
 * type-keyed provider resolution. Control flow: no schema registered → `next()`; message null/undefined →
 * `ValidationError('Request is null')`; schema present and `validate` fails → `ValidationError` with one
 * message per ajv error. The client side uses the plain `ValidationError` status (no status mapper),
 * matching the Zod client middleware.
 */
export class ValidationClientMiddleware<TRequest, TResponse>
  implements IMiddleware<IBenzeneClientContext<TRequest, TResponse>>
{
  readonly name = 'JsonSchemaValidation';

  async handleAsync(
    context: IBenzeneClientContext<TRequest, TResponse>,
    next: NextFunc,
  ): Promise<void> {
    const message = context.request.message;
    const validate =
      message === undefined || message === null
        ? undefined
        : getJsonSchemaValidator((message as object).constructor as Constructor<unknown>);

    if (validate === undefined) {
      // No schema for this message type (or no message to key one off) — nothing to validate.
      await next();
      return;
    }

    if (message === undefined || message === null) {
      context.response = BenzeneResult.validationError<TResponse>(RequestIsNull);
      return;
    }

    const valid = validate(message);
    if (!valid) {
      context.response = BenzeneResult.validationError<TResponse>(...formatValidationErrors(validate.errors));
      return;
    }

    await next();
  }
}

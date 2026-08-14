import { IMessageHandlerContext } from '@benzenejs/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { IValidationStatusMapper } from '@benzenejs/abstractions-validation';
import { BenzeneResult } from '@benzenejs/results';
import type { ValidateFunction } from 'ajv';
import { formatValidationErrors, RequestIsNull } from './JsonSchemaValidationErrors';

/**
 * Handler middleware that validates the request against a JSON Schema (compiled by ajv) before the
 * handler runs.
 *
 * Port of Benzene.JsonSchema.JsonSchemaMiddleware, ADAPTED to ajv and to the port's handler-level
 * validation architecture (see the package README/index note). The resolved ajv {@link ValidateFunction}
 * plays the role of `IJsonSchemaProvider.Get(...)`'s `Json.Schema.JsonSchema`, and `validate(request)`
 * plays the role of `jsonSchema.Evaluate(...)`.
 *
 * KEY DIVERGENCE (raw body → deserialized request): C#'s `JsonSchemaMiddleware` is a transport pipeline
 * middleware that evaluates the raw request *body* (and reports `MissingBody`/`MalformedBody`) before
 * deserialization. The TypeScript port has no raw-body validation seam — validation is handler-level, on
 * the already-deserialized `context.request`, routed through `IValidationStatusMapper` — so this mirrors
 * the Zod/Joi/Yup adapters instead: no schema registered → `next()`; request null/undefined →
 * `'Request is null'` with the mapped status; otherwise `validate(request)`, and on failure one message
 * per ajv error via {@link formatValidationErrors}. (`MissingBody`/`MalformedBody` have no handler-level
 * analog: a malformed body fails earlier, during deserialization.)
 */
export class ValidationMiddleware<TRequest, TResponse>
  implements IMiddleware<IMessageHandlerContext<TRequest, TResponse>>
{
  readonly name = 'JsonSchemaValidation';

  constructor(
    private readonly validate: ValidateFunction | undefined,
    private readonly validationStatusMapper: IValidationStatusMapper,
  ) {}

  async handleAsync(
    context: IMessageHandlerContext<TRequest, TResponse>,
    next: NextFunc,
  ): Promise<void> {
    if (this.validate === undefined) {
      await next();
      return;
    }

    if (context.request === undefined || context.request === null) {
      const status = this.validationStatusMapper.getStatus(context.handlerType, undefined, undefined);
      context.response = BenzeneResult.setErrors<TResponse>(status, RequestIsNull);
      return;
    }

    // ajv's `validate` records `.errors` synchronously as a side effect of the call; there is no await
    // between the call and the read, so the errors always belong to this request.
    const valid = this.validate(context.request);
    if (!valid) {
      const status = this.validationStatusMapper.getStatus(
        context.handlerType,
        undefined,
        this.validate.errors,
      );
      const messages = formatValidationErrors(this.validate.errors);
      context.response = BenzeneResult.setErrors<TResponse>(status, ...messages);
      return;
    }

    await next();
  }
}

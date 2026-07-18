import { IMessageHandlerContext } from '@benzene/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { IValidationStatusMapper } from '@benzene/abstractions-validation';
import { BenzeneResult } from '@benzene/results';
import { ValidationError, type Schema } from 'yup';

/**
 * Handler middleware that validates the request against a Yup schema before the handler runs.
 *
 * Port of Benzene.FluentValidation.ValidationMiddleware&lt;TRequest, TResponse&gt;, ADAPTED to Yup:
 * the resolved Yup schema plays the role of FluentValidation's `IValidator<TRequest>`, and
 * `schema.validate` plays the role of `validator.ValidateAsync`.
 *
 * Control flow mirrors the C# original exactly:
 * - No schema registered for this request type (`schema === undefined`) → `next()` (the C#
 *   `validator != null` guard).
 * - Schema present but request null/undefined → short-circuit with the mapped status and
 *   `'Request is null'`, matching C# `context.Request == default`.
 * - Otherwise `await schema.validate(..., { abortEarly: false })`; on failure short-circuit with the
 *   mapped status and one message per Yup error, matching C#'s
 *   `validationResult.Errors.Select(x => x.ErrorMessage)`.
 * - On success → `next()`.
 *
 * NOTE: unlike Joi (synchronous, returns `{ error }`) and Zod (synchronous, returns a result
 * object), Yup validates ASYNCHRONOUSLY and reports failure by THROWING a `ValidationError`; the
 * aggregate messages live in `ValidationError.errors` (a `string[]`). Hence the `try/catch` here.
 *
 * The failure status is routed through `IValidationStatusMapper` exactly as in FluentValidation.
 */
export class ValidationMiddleware<TRequest, TResponse>
  implements IMiddleware<IMessageHandlerContext<TRequest, TResponse>>
{
  readonly name = 'YupValidation';

  constructor(
    private readonly schema: Schema | undefined,
    private readonly validationStatusMapper: IValidationStatusMapper,
  ) {}

  async handleAsync(
    context: IMessageHandlerContext<TRequest, TResponse>,
    next: NextFunc,
  ): Promise<void> {
    if (this.schema === undefined) {
      await next();
      return;
    }

    if (context.request === undefined || context.request === null) {
      const status = this.validationStatusMapper.getStatus(context.handlerType, undefined, undefined);
      context.response = BenzeneResult.setErrors<TResponse>(status, 'Request is null');
      return;
    }

    try {
      await this.schema.validate(context.request, { abortEarly: false });
    } catch (error) {
      if (error instanceof ValidationError) {
        const status = this.validationStatusMapper.getStatus(context.handlerType, undefined, error);
        context.response = BenzeneResult.setErrors<TResponse>(status, ...error.errors);
        return;
      }
      throw error;
    }

    await next();
  }
}

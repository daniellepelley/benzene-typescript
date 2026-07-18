import { IMessageHandlerContext } from '@benzene/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { IValidationStatusMapper } from '@benzene/abstractions-validation';
import { BenzeneResult } from '@benzene/results';
import type { ZodType } from 'zod';

/**
 * Handler middleware that validates the request against a Zod schema before the handler runs.
 *
 * Port of Benzene.FluentValidation.ValidationMiddleware&lt;TRequest, TResponse&gt;, ADAPTED to Zod:
 * the resolved Zod schema plays the role of FluentValidation's `IValidator<TRequest>`, and
 * `schema.safeParse` plays the role of `validator.ValidateAsync`.
 *
 * Control flow mirrors the C# original exactly:
 * - No schema registered for this request type (`schema === undefined`) → `next()` (the C#
 *   `validator != null` guard).
 * - Schema present but request null/undefined → short-circuit with the mapped status and
 *   `'Request is null'`, matching C# `context.Request == default`.
 * - Otherwise `safeParse`; on failure short-circuit with the mapped status and one message per Zod
 *   issue, matching C#'s `validationResult.Errors.Select(x => x.ErrorMessage)`.
 * - On success → `next()`.
 *
 * The failure status is routed through `IValidationStatusMapper` exactly as in FluentValidation.
 */
export class ValidationMiddleware<TRequest, TResponse>
  implements IMiddleware<IMessageHandlerContext<TRequest, TResponse>>
{
  readonly name = 'ZodValidation';

  constructor(
    private readonly schema: ZodType | undefined,
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

    const result = this.schema.safeParse(context.request);
    if (!result.success) {
      const status = this.validationStatusMapper.getStatus(context.handlerType, undefined, result.error);
      const messages = result.error.issues.map((issue) => issue.message);
      context.response = BenzeneResult.setErrors<TResponse>(status, ...messages);
      return;
    }

    await next();
  }
}

import { Constructor } from '@benzene/abstractions';
import { BenzeneResultStatus } from '@benzene/results';
import { IValidationStatusMapper } from './IValidationStatusMapper';
import { getValidationStatus } from './ValidationStatusAttribute';

/**
 * Default `IValidationStatusMapper`: resolves the validation status from the handler's
 * `@validationStatus` decorator when present, otherwise falls back to
 * `BenzeneResultStatus.validationError`.
 *
 * Port of Benzene.FluentValidation.DefaultValidationStatusMapper.
 *
 * Deliberate divergence from the C# source:
 * - C# keeps this class inside the `Benzene.FluentValidation` project. Here it is hoisted into
 *   `@benzene/abstractions-validation` so every schema adapter (`@benzene/zod`, and future
 *   `@benzene/joi` / `@benzene/yup`) shares one implementation instead of each re-declaring it.
 * - C# also inspects per-error `CustomState` for a `BenzeneValidationState.Status` override before
 *   consulting the handler attribute. That override is a FluentValidation-specific feature
 *   (per-rule custom state) with no schema-library-neutral equivalent, so it is omitted; only the
 *   handler-level `@validationStatus` branch and the default branch are ported.
 */
export class DefaultValidationStatusMapper implements IValidationStatusMapper {
  getStatus(
    handlerType: Constructor<unknown> | undefined,
    _requestType: Constructor<unknown> | undefined,
    _result: unknown,
  ): string {
    if (handlerType !== undefined) {
      const status = getValidationStatus(handlerType);
      if (status !== undefined) {
        return status;
      }
    }

    return BenzeneResultStatus.validationError;
  }
}

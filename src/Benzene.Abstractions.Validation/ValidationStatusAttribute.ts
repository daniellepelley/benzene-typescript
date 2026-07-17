import { Constructor } from '@benzene/abstractions';

/**
 * Port of Benzene.Abstractions.Validation.ValidationStatusAttribute.
 *
 * The C# `[ValidationStatus("status")]` attribute (usable on a class or a method) becomes the
 * `@validationStatus('status')` decorator. As with the `@message` decorator, .NET reads the
 * attribute by reflection; JavaScript erases it, so the decorator records the status itself into a
 * module-level WeakMap keyed by the decorated class, read back via `getValidationStatus`.
 *
 * The decorator also works as a plain function for environments without decorator syntax:
 * `validationStatus('status')(MyType)`.
 *
 * Deviation: C# `AttributeTargets.Class | AttributeTargets.Method` — the class-level form is ported
 * here (the status-per-class case Benzene actually reads); a method-level form is deferred until a
 * consumer needs it, since TC39 method decorators would require a separate keying strategy.
 */
const metadataStore = new WeakMap<Constructor<unknown>, string>();

export function validationStatus(
  status: string,
): <T extends Constructor<unknown>>(target: T, context?: ClassDecoratorContext) => T {
  return (target) => {
    metadataStore.set(target, status);
    return target;
  };
}

/** Reads the status recorded by the `validationStatus` decorator, if any. */
export function getValidationStatus(type: Constructor<unknown>): string | undefined {
  return metadataStore.get(type);
}

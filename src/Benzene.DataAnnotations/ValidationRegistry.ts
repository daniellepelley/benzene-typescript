/**
 * TypeScript-only file replacing part of System.ComponentModel.DataAnnotations.
 *
 * .NET discovers validation rules by reflecting over the `[Required]`/`[MaxLength]`/... attributes
 * declared on a request type. JavaScript has neither those attributes nor property reflection, so
 * the property decorators in `Decorators.ts` record their rule here instead — a per-class registry
 * (a WeakMap keyed by the class constructor), mirroring the metadata-store pattern of the `@message`
 * decorator (`MessageAttribute` + `MessageHandlersRegistry`).
 */

/** A single validation constraint attached to a property, the analogue of one .NET ValidationAttribute. */
export interface ValidationRule {
  /** The constraint kind (mirrors `ValidationConstants`), for diagnostics. */
  readonly name: string;

  /** Mirrors `ValidationAttribute.IsValid(value)`: true when the value satisfies the constraint. */
  isValid(value: unknown): boolean;

  /**
   * The error string reported when the value fails, given the display name of the property.
   * Mirrors `ValidationAttribute.FormatErrorMessage(name)`.
   */
  errorMessage(displayName: string): string;
}

const store = new WeakMap<object, Map<string, ValidationRule[]>>();

/** Records a rule for a property of the given class (idempotent for a repeated rule instance). */
export function addValidationRule(type: object, propertyName: string, rule: ValidationRule): void {
  let properties = store.get(type);
  if (properties === undefined) {
    properties = new Map<string, ValidationRule[]>();
    store.set(type, properties);
  }

  let rules = properties.get(propertyName);
  if (rules === undefined) {
    rules = [];
    properties.set(propertyName, rules);
  }

  if (!rules.includes(rule)) {
    rules.push(rule);
  }
}

/** Returns the rules recorded for a class, keyed by property name (empty map when none). */
export function getValidationRules(type: object): Map<string, ValidationRule[]> {
  return store.get(type) ?? new Map<string, ValidationRule[]>();
}

import { getValidationRules } from './ValidationRegistry';

/**
 * TypeScript-only file replacing System.ComponentModel.DataAnnotations.Validator.
 *
 * Mirrors `Validator.TryValidateObject(obj, ctx, results, validateAllProperties: true)`: it looks up
 * every rule recorded (by the property decorators in `Decorators.ts`) for the object's runtime class
 * — the analogue of .NET reflecting over `obj.GetType()`'s attributes — evaluates each against the
 * corresponding property value, and returns one error string per failing rule (an empty array means
 * valid).
 *
 * Because rules are keyed by class, `obj` must be an instance of the decorated class (not a plain
 * object): `ValidationMiddleware` reconstructs the request into its declared type before calling
 * this, exactly as .NET deserializes onto the typed request instance it then validates.
 */
export function validateObject(obj: object): string[] {
  const errors: string[] = [];
  const rules = getValidationRules(obj.constructor as object);

  for (const [propertyName, propertyRules] of rules) {
    const value = (obj as Record<string, unknown>)[propertyName];
    for (const rule of propertyRules) {
      if (!rule.isValid(value)) {
        errors.push(rule.errorMessage(displayName(propertyName)));
      }
    }
  }

  return errors;
}

function displayName(propertyName: string): string {
  return propertyName.length === 0
    ? propertyName
    : propertyName.charAt(0).toUpperCase() + propertyName.slice(1);
}

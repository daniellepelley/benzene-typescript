import { addValidationRule, ValidationRule } from './ValidationRegistry';

/**
 * TypeScript-only file replacing the attribute types of System.ComponentModel.DataAnnotations.
 *
 * .NET annotates request properties with attributes (`[Required]`, `[MaxLength(10)]`, ...) that the
 * `Validator` discovers by reflection. TypeScript has no such reflection, so these property
 * decorators record an equivalent {@link ValidationRule} into the per-class `ValidationRegistry`,
 * following the metadata-store pattern of the `@message` decorator.
 *
 * Each decorator works two ways, like `@message`:
 * - as a TC39 field decorator — `@required name: string`, `@maxLength(10) name: string`. Because a
 *   TC39 field decorator has no synchronous reference to its class, the rule is recorded from an
 *   `addInitializer` callback (`this.constructor` on first construction); the middleware constructs
 *   the request type to guarantee this runs (see `ValidationMiddleware`).
 * - as a plain function for non-decorator environments — `required(MyType.prototype, 'name')` or
 *   `maxLength(10)(MyType, 'name')`, which records the rule eagerly.
 */

/** A property decorator that is also callable as a plain `(target, propertyKey)` function. */
export type RuleDecorator = ((value: undefined, context: ClassFieldDecoratorContext) => void) &
  ((target: object, propertyKey: string | symbol) => void);

function isFieldContext(value: unknown): value is ClassFieldDecoratorContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as { addInitializer?: unknown }).addInitializer === 'function'
  );
}

function makeFieldDecorator(rule: ValidationRule): RuleDecorator {
  function decorate(a: unknown, b: unknown): void {
    if (isFieldContext(b)) {
      const name = String(b.name);
      b.addInitializer(function (this: unknown) {
        addValidationRule((this as object).constructor as object, name, rule);
      });
      return;
    }

    // Plain-function / legacy form: `rule(TargetClass.prototype, 'name')` or `rule(TargetClass, 'name')`.
    const type =
      typeof a === 'function' ? (a as object) : ((a as { constructor: object }).constructor ?? (a as object));
    addValidationRule(type, String(b), rule);
  }

  return decorate as RuleDecorator;
}

function displayName(propertyName: string): string {
  // .NET reports the (PascalCase) member name; ported members are camelCase, so the first letter is
  // upper-cased to reproduce the same visible strings as the .NET default messages.
  return propertyName.length === 0
    ? propertyName
    : propertyName.charAt(0).toUpperCase() + propertyName.slice(1);
}

function lengthOf(value: unknown): number | undefined {
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length;
  }
  return undefined;
}

// ---- Rule factories (mirror the individual DataAnnotations attributes) ----------------------------

function requiredRule(): ValidationRule {
  return {
    name: 'Required',
    isValid(value) {
      if (value === undefined || value === null) {
        return false;
      }
      // Mirrors RequiredAttribute with AllowEmptyStrings = false (the default): trims strings.
      return typeof value === 'string' ? value.trim().length !== 0 : true;
    },
    errorMessage(name) {
      return `The ${name} field is required.`;
    },
  };
}

function maxLengthRule(max: number): ValidationRule {
  return {
    name: 'MaxLength',
    isValid(value) {
      if (value === undefined || value === null) {
        return true;
      }
      const length = lengthOf(value);
      return length === undefined ? true : length <= max;
    },
    errorMessage(name) {
      return `The field ${name} must be a string or array type with a maximum length of '${max}'.`;
    },
  };
}

function minLengthRule(min: number): ValidationRule {
  return {
    name: 'MinLength',
    isValid(value) {
      if (value === undefined || value === null) {
        return true;
      }
      const length = lengthOf(value);
      return length === undefined ? true : length >= min;
    },
    errorMessage(name) {
      return `The field ${name} must be a string or array type with a minimum length of '${min}'.`;
    },
  };
}

function stringLengthRule(max: number, min = 0): ValidationRule {
  return {
    name: 'StringLength',
    isValid(value) {
      if (value === undefined || value === null) {
        return true;
      }
      const text = typeof value === 'string' ? value : String(value);
      return text.length <= max && text.length >= min;
    },
    errorMessage(name) {
      return min > 0
        ? `The field ${name} must be a string with a minimum length of ${min} and a maximum length of ${max}.`
        : `The field ${name} must be a string with a maximum length of ${max}.`;
    },
  };
}

function rangeRule(min: number, max: number): ValidationRule {
  return {
    name: 'Range',
    isValid(value) {
      if (value === undefined || value === null || value === '') {
        return true;
      }
      const numeric = typeof value === 'number' ? value : Number(value);
      return !Number.isNaN(numeric) && numeric >= min && numeric <= max;
    },
    errorMessage(name) {
      return `The field ${name} must be between ${min} and ${max}.`;
    },
  };
}

function regularExpressionRule(pattern: string): ValidationRule {
  return {
    name: 'Regex',
    isValid(value) {
      if (value === undefined || value === null) {
        return true;
      }
      const text = typeof value === 'string' ? value : String(value);
      if (text === '') {
        return true;
      }
      // Mirrors RegularExpressionAttribute: the pattern must match the entire string.
      const match = new RegExp(pattern).exec(text);
      return match !== null && match.index === 0 && match[0].length === text.length;
    },
    errorMessage(name) {
      return `The field ${name} must match the regular expression '${pattern}'.`;
    },
  };
}

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function emailAddressRule(): ValidationRule {
  return {
    name: 'Email',
    isValid(value) {
      if (value === undefined || value === null) {
        return true;
      }
      return typeof value === 'string' && emailPattern.test(value);
    },
    errorMessage(name) {
      return `The ${name} field is not a valid e-mail address.`;
    },
  };
}

// ---- Public decorators ---------------------------------------------------------------------------

/** Port of `[Required]`. */
export const required: RuleDecorator = makeFieldDecorator(requiredRule());

/** Port of `[EmailAddress]`. */
export const emailAddress: RuleDecorator = makeFieldDecorator(emailAddressRule());

/** Port of `[MaxLength(max)]`. */
export function maxLength(max: number): RuleDecorator {
  return makeFieldDecorator(maxLengthRule(max));
}

/** Port of `[MinLength(min)]`. */
export function minLength(min: number): RuleDecorator {
  return makeFieldDecorator(minLengthRule(min));
}

/** Port of `[StringLength(max, MinimumLength = min)]`. */
export function stringLength(max: number, min?: number): RuleDecorator {
  return makeFieldDecorator(stringLengthRule(max, min));
}

/** Port of `[Range(min, max)]`. */
export function range(min: number, max: number): RuleDecorator {
  return makeFieldDecorator(rangeRule(min, max));
}

/** Port of `[RegularExpression(pattern)]`. */
export function regularExpression(pattern: string): RuleDecorator {
  return makeFieldDecorator(regularExpressionRule(pattern));
}

/** Alias for {@link regularExpression}. */
export const regex = regularExpression;

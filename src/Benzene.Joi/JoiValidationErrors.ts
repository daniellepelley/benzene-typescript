import type { BenzeneError } from '@benzenejs/abstractions';
import type { ValidationError } from 'joi';

/**
 * Turns a Joi `ValidationError` into one {@link BenzeneError} per detail.
 *
 * Joi already knows, per detail, exactly the three things a problem document wants: the message, the
 * path of the value that failed, and the identifier of the rule that rejected it. This maps them
 * across unchanged - `path` rendered as a JSON Pointer becomes `field`, and Joi's `type`
 * (`any.required`, `string.max`, ...) becomes `code` - rather than keeping only `detail.message` and
 * throwing the rest away. That is what wire-contracts.md section 1.3 asks a schema-based validator
 * for, and what .NET's validation adapters have always produced.
 *
 * The path is rendered as a JSON Pointer (`/items/0/sku`) so every schema-based adapter in this port
 * names a field the same way.
 */
export function joiValidationErrors(error: ValidationError): BenzeneError[] {
  const seen = new Set<string>();
  const formatted: BenzeneError[] = [];

  for (const detail of error.details) {
    const field = toJsonPointer(detail.path ?? []);
    const benzeneError: BenzeneError = {
      message: detail.message,
      ...(field === undefined ? {} : { field }),
      ...(detail.type === undefined || detail.type === '' ? {} : { code: detail.type }),
    };
    const key = `${benzeneError.field ?? ''} ${benzeneError.code ?? ''} ${benzeneError.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    formatted.push(benzeneError);
  }

  return formatted.length > 0 ? formatted : [{ message: 'Request does not match the schema' }];
}

/**
 * A validator's path segments as a JSON Pointer, or `undefined` for a root-level failure (which
 * carries no field at all rather than an empty one).
 *
 * Per RFC 6901 a `~` in a segment escapes to `~0` and a `/` to `~1`; without that a property name
 * containing a slash would silently read as two path segments.
 */
export function toJsonPointer(path: readonly PropertyKey[]): string | undefined {
  if (path.length === 0) {
    return undefined;
  }
  return path.map((segment) => `/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

import type { BenzeneError } from '@benzenejs/abstractions';
import type { ZodError } from 'zod';

/**
 * Turns a zod `ZodError` into one {@link BenzeneError} per issue.
 *
 * zod already knows, per issue, exactly the three things a problem document wants: the message, the
 * path of the value that failed, and the identifier of the rule that rejected it. This maps them
 * across unchanged - `path` rendered as a JSON Pointer becomes `field`, and zod's `code`
 * (`invalid_type`, `too_small`, ...) becomes `code` - rather than keeping only `issue.message` and
 * throwing the rest away. That is what wire-contracts.md section 1.3 asks a schema-based validator
 * for, and what .NET's validation adapters have always produced.
 *
 * The path is rendered as a JSON Pointer (`/items/0/sku`) so every schema-based adapter in this port
 * names a field the same way, and the same way the wire contract's own example does.
 */
export function zodValidationErrors(error: ZodError): BenzeneError[] {
  const seen = new Set<string>();
  const formatted: BenzeneError[] = [];

  for (const issue of error.issues) {
    const field = toJsonPointer(issue.path);
    const benzeneError: BenzeneError = {
      message: issue.message,
      ...(field === undefined ? {} : { field }),
      ...(issue.code === undefined ? {} : { code: String(issue.code) }),
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

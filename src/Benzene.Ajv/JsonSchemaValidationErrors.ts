/** Port of Benzene.JsonSchema.JsonSchemaValidationErrors (the ajv-error formatting half). */
import type { BenzeneError } from '@benzenejs/abstractions';
import type { ErrorObject } from 'ajv';

/** The message used when a schema is registered but the request instance is null/undefined. */
export const RequestIsNull = 'Request is null';

const Fallback = 'Request does not match the schema';

/**
 * Turns ajv's `ErrorObject[]` into one {@link BenzeneError} per failed keyword.
 *
 * Unlike the other validation integrations, the JSON Pointer of the failing value is already in wire
 * form here, so it travels as `field` rather than being prefixed into the message text (a root-level
 * failure carries no `field`); the failed keyword - `required`, `maxLength`, `type` - travels as
 * `code`. That is exactly what wire-contracts.md section 1.3 asks a schema-based validator for, and
 * it is what .NET's `JsonSchemaValidationErrors.Format(EvaluationResults)` has always produced. This
 * function ported the shape that predated structured errors and glued the pointer into the message,
 * throwing away what ajv had already worked out.
 *
 * De-duplicated and ordered, with the same generic fallback when the evaluation carries no detail.
 */
export function formatValidationErrors(errors: ErrorObject[] | null | undefined): BenzeneError[] {
  if (errors === null || errors === undefined || errors.length === 0) {
    return [{ message: Fallback }];
  }

  const seen = new Set<string>();
  const formatted: BenzeneError[] = [];
  for (const error of errors) {
    const benzeneError: BenzeneError = {
      message: error.message ?? 'is invalid',
      ...(error.instancePath === '' ? {} : { field: error.instancePath }),
      ...(error.keyword === undefined || error.keyword === '' ? {} : { code: error.keyword }),
    };
    // Distinct(), as in .NET: ajv can report the same keyword failure twice through a composed
    // schema, and a caller should see one error per real problem.
    const key = `${benzeneError.field ?? ''} ${benzeneError.code ?? ''} ${benzeneError.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    formatted.push(benzeneError);
  }

  return formatted.length > 0 ? formatted : [{ message: Fallback }];
}

/**
 * The same errors as flat `"/field: message"` strings, for a caller that wants the prose rather than
 * the structure (the shape this module returned before structured errors).
 */
export function formatValidationMessages(errors: ErrorObject[] | null | undefined): string[] {
  return formatValidationErrors(errors).map((error) =>
    error.field === undefined ? error.message : `${error.field}: ${error.message}`,
  );
}

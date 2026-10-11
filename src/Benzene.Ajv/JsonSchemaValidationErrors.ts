/** Port of Benzene.JsonSchema.JsonSchemaValidationErrors (the ajv-error formatting half). */
import type { BenzeneError } from '@benzenejs/abstractions';
import type { ErrorObject } from 'ajv';

/** The message used when a schema is registered but the request instance is null/undefined. */
export const RequestIsNull = 'Request is null';

const Fallback = 'Request does not match the schema';

/**
 * Turns ajv's `ErrorObject[]` into one {@link BenzeneError} per failed keyword.
 *
 * ajv reports the JSON Pointer of the failing value (`instancePath`), which travels as `field` — an
 * RFC 6901 pointer into the request's JSON form (wire-contracts §1.3, D8) — rather than being prefixed
 * into the message text; the failed keyword - `required`, `maxLength`, `type` - travels as `code`. For
 * a keyword that names a member, ajv's `instancePath` is the **parent** object, so the member is
 * appended: a missing required `sku` in `items[0]` is `/items/0/sku` (not `/items/0`), and an
 * unexpected property points at that property. A failure on the whole request carries no `field`. That is exactly what wire-contracts.md section 1.3 asks a schema-based validator for, and
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
      ...fieldOf(error),
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

/**
 * The JSON Pointer an ajv error addresses: `instancePath`, plus the member the keyword names when the
 * keyword is about a member of the object at `instancePath` (`required`/`dependentRequired`/`dependencies`
 * → `missingProperty`, `additionalProperties`/`unevaluatedProperties` → the offending property).
 */
function fieldOf(error: ErrorObject): { field?: string } {
  const params = (error.params ?? {}) as Record<string, unknown>;
  const member =
    typeof params.missingProperty === 'string'
      ? params.missingProperty
      : typeof params.additionalProperty === 'string'
        ? params.additionalProperty
        : typeof params.unevaluatedProperty === 'string'
          ? params.unevaluatedProperty
          : undefined;
  const pointer =
    member === undefined
      ? error.instancePath
      : `${error.instancePath}/${member.replace(/~/g, '~0').replace(/\//g, '~1')}`;
  return pointer === '' ? {} : { field: pointer };
}

/** Port of Benzene.JsonSchema.JsonSchemaValidationErrors (the ajv-error formatting half). */
import type { ErrorObject } from 'ajv';

/** The message used when a schema is registered but the request instance is null/undefined. */
export const RequestIsNull = 'Request is null';

const Fallback = 'Request does not match the schema';

/**
 * Flattens ajv's `ErrorObject[]` into one message per failed keyword, prefixed with the JSON Pointer of
 * the failing value (e.g. `"/name: must NOT have fewer than 5 characters"`; root-level failures carry no
 * prefix) — the shape the other validation adapters produce, served as the `ValidationError` result's
 * payload. Port of `JsonSchemaValidationErrors.Format(EvaluationResults)`: `instanceLocation` →
 * ajv's `instancePath` (both JSON Pointer), de-duplicated and ordered, with the same generic fallback
 * when the evaluation carries no detail.
 */
export function formatValidationErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (errors === null || errors === undefined || errors.length === 0) {
    return [Fallback];
  }
  const messages = Array.from(
    new Set(errors.map((error) => format(error.instancePath, error.message ?? 'is invalid'))),
  );
  return messages.length > 0 ? messages : [Fallback];
}

function format(instancePath: string, message: string): string {
  return instancePath === '' ? message : `${instancePath}: ${message}`;
}

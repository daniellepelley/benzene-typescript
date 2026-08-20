import type { BenzeneError } from '@benzenejs/abstractions';
import type { ValidationError } from 'yup';

/**
 * Turns a yup `ValidationError` into one {@link BenzeneError} per failed field.
 *
 * yup already knows, per failure, exactly the three things a problem document wants: the message,
 * the path of the value that failed, and the identifier of the rule that rejected it. This maps them
 * across unchanged - `path` becomes `field` and yup's `type` (`required`, `min`, `matches`, ...)
 * becomes `code` - rather than reading `error.errors`, which is the messages alone and throws the
 * rest away. That is what wire-contracts.md section 1.3 asks a validator for, and what .NET's
 * FluentValidation adapter has always produced.
 *
 * With `abortEarly: false` yup reports each failure in `inner`; a single failure (or a schema that
 * aborted early) arrives with `inner` empty and the error itself carrying the path and type, so both
 * shapes are handled.
 */
export function yupValidationErrors(error: ValidationError): BenzeneError[] {
  const failures = error.inner.length > 0 ? error.inner : [error];

  const seen = new Set<string>();
  const formatted: BenzeneError[] = [];
  for (const failure of failures) {
    const benzeneError: BenzeneError = {
      message: failure.message,
      ...(failure.path === undefined || failure.path === '' ? {} : { field: failure.path }),
      ...(failure.type === undefined || failure.type === '' ? {} : { code: failure.type }),
    };
    const key = `${benzeneError.field ?? ''} ${benzeneError.code ?? ''} ${benzeneError.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    formatted.push(benzeneError);
  }

  // A ValidationError with no message anywhere would otherwise produce nothing at all, turning a
  // rejection into an empty errors array.
  return formatted.length > 0 ? formatted : [{ message: 'Request does not match the schema' }];
}

import type { BenzeneError } from '@benzenejs/abstractions';
import type { ValidationError } from 'yup';

/**
 * Turns a yup `ValidationError` into one {@link BenzeneError} per failed field.
 *
 * yup already knows, per failure, exactly the three things a problem document wants: the message,
 * the path of the value that failed, and the identifier of the rule that rejected it. This maps them
 * across - `path` becomes `field` and yup's `type` (`required`, `min`, `matches`, ...) becomes `code` -
 * rather than reading `error.errors`, which is the messages alone and throws the rest away.
 *
 * `field` is an RFC 6901 **JSON Pointer** into the request's JSON form (wire-contracts §1.3, D8):
 * yup reports a host-language property path (`items[0].sku`, `meta["a.b"]`), which is converted
 * (`/items/0/sku`, `/meta/a.b`) so every validation adapter in this port names a field the same way. A
 * failure with no path (a rule on the whole request) carries no `field`.
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
      ...(fieldOf(failure.path)),
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

function fieldOf(path: string | undefined): { field?: string } {
  const field = yupPathToJsonPointer(path);
  return field === undefined ? {} : { field };
}

/**
 * Converts a yup error path to an RFC 6901 JSON Pointer, or `undefined` for a root-level failure.
 *
 * yup joins object keys with `.` and writes an array index — or a key containing `.` or made only of
 * digits — in brackets: `items[0].sku`, `meta["a.b"]`. Each segment is escaped per RFC 6901 (`~` to `~0`,
 * `/` to `~1`).
 */
export function yupPathToJsonPointer(path: string | undefined): string | undefined {
  if (path === undefined || path === '') {
    return undefined;
  }

  const segments: string[] = [];
  let i = 0;
  while (i < path.length) {
    const char = path[i];
    if (char === '.') {
      i += 1;
      continue;
    }
    if (char === '[') {
      const quote = path[i + 1];
      if (quote === '"' || quote === "'") {
        const end = path.indexOf(`${quote}]`, i + 2);
        const stop = end === -1 ? path.length : end;
        segments.push(path.substring(i + 2, stop));
        i = end === -1 ? path.length : end + 2;
      } else {
        const end = path.indexOf(']', i + 1);
        const stop = end === -1 ? path.length : end;
        segments.push(path.substring(i + 1, stop));
        i = end === -1 ? path.length : end + 1;
      }
      continue;
    }
    let end = i;
    while (end < path.length && path[end] !== '.' && path[end] !== '[') {
      end += 1;
    }
    segments.push(path.substring(i, end));
    i = end;
  }

  return segments.length === 0
    ? undefined
    : segments.map((segment) => `/${segment.replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

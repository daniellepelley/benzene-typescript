/** Port of Benzene.Diagnostics.Correlation.CorrelationId. */
import { randomUUID } from 'node:crypto';
import { ICorrelationId } from '@benzene/abstractions';

/**
 * Tracks the correlation id for the current invocation, self-generating one on construction
 * that application middleware may later override.
 * Port of Benzene.Diagnostics.Correlation.CorrelationId.
 *
 * Deviation: C# seeds the default value with `Guid.NewGuid().ToString()`. Node has no `Guid`
 * type; the ecosystem equivalent is `crypto.randomUUID()` (from the built-in `node:crypto`),
 * which produces an RFC 4122 v4 UUID in the same canonical `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
 * string form — a non-empty, unique id, exactly as `Guid.NewGuid().ToString()` yields.
 */
export class CorrelationId implements ICorrelationId {
  private correlationId: string = randomUUID();

  /**
   * Overrides the self-generated id, but only when given a non-empty value — a `null`/empty
   * argument leaves the existing id untouched. Port of C# `Set`, whose guard is
   * `!string.IsNullOrEmpty(correlationId)` (C# `null` maps to `undefined`).
   */
  set(correlationId: string): void {
    if (correlationId !== undefined && correlationId !== null && correlationId !== '') {
      this.correlationId = correlationId;
    }
  }

  get(): string {
    return this.correlationId;
  }
}

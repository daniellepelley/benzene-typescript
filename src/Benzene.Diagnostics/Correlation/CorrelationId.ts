/** Port of Benzene.Diagnostics.Correlation.CorrelationId. */
import { randomUUID } from 'node:crypto';
import { ICorrelationId } from '@benzenejs/abstractions';

/**
 * C# `char.IsControl`: the C0 controls (U+0000–U+001F), DEL (U+007F), and the C1 controls
 * (U+0080–U+009F). Notably includes `\r`/`\n`, which could otherwise forge extra log lines or inject
 * extra request/response headers via CR/LF once the id round-trips into a log scope or outbound header.
 */
const controlCharacter = /[\u0000-\u001f\u007f-\u009f]/;

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
  /**
   * Maximum accepted length for a caller-supplied correlation id. Longer values are rejected (the
   * self-generated id is kept) rather than truncated, since silently truncating could make two
   * distinct caller-supplied ids collide. Port of C# `CorrelationId.MaxLength`.
   */
  static readonly maxLength = 128;

  private correlationId: string = randomUUID();

  /**
   * Overrides the correlation id with a caller-supplied value, subject to a boundary check (the .NET
   * #64 untrusted-input rule): this is the point where an inbound, caller-controlled header value is
   * accepted into a process-wide sink (log scopes, and outbound headers on this service's own
   * downstream calls). A value is rejected — the current (self-generated, by default) id is left in
   * place — when it is `undefined`/`null`/empty, longer than {@link maxLength}, or contains any
   * control character (including `\r`/`\n`, which could otherwise forge extra log lines or inject
   * extra request/response headers via CR/LF). `ICorrelationId`'s "always has a value" contract holds
   * either way — a rejected value simply never displaces the existing one.
   */
  set(correlationId: string): void {
    if (
      correlationId === undefined ||
      correlationId === null ||
      correlationId === '' ||
      correlationId.length > CorrelationId.maxLength ||
      controlCharacter.test(correlationId)
    ) {
      return;
    }

    this.correlationId = correlationId;
  }

  get(): string {
    return this.correlationId;
  }
}

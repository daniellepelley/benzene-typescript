/**
 * Thrown when a duplicate message arrives while the first copy is still in progress and
 * {@link IdempotencyOptions.inProgressBehavior} is {@link InProgressBehavior.Throw}. The transport
 * should not acknowledge the message, so it is redelivered later.
 * Port of Benzene.Idempotency.IdempotencyConflictException.
 */
export class IdempotencyConflictException extends Error {
  /** The idempotency key that is already being processed. */
  readonly key: string;

  constructor(key: string) {
    super(`A message with idempotency key '${key}' is already being processed.`);
    this.name = 'IdempotencyConflictException';
    this.key = key;
    // Restore the prototype chain for `instanceof` under transpiled ES5-style extends.
    Object.setPrototypeOf(this, IdempotencyConflictException.prototype);
  }
}

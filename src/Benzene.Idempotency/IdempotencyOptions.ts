import { IdempotencyDefaults } from './IdempotencyDefaults';
import { InProgressBehavior } from './InProgressBehavior';

/**
 * Configuration for the idempotency middleware and the default key strategy.
 * Port of Benzene.Idempotency.IdempotencyOptions.
 */
export class IdempotencyOptions {
  /**
   * The message header carrying a caller-supplied idempotency key. Defaults to `idempotency-key`. When
   * a message carries this header, its value is used as the key.
   */
  headerName: string = IdempotencyDefaults.headerName;

  /**
   * When a message has no idempotency-key header, whether to derive a key by hashing the message topic
   * and body. Defaults to `true`. Set to `false` to only de-duplicate messages that carry an explicit
   * key and let everything else through untracked.
   */
  hashBodyWhenNoHeader = true;

  /**
   * An optional prefix applied to every key, for namespacing when several services share one store.
   * Defaults to an empty string.
   */
  keyPrefix = '';

  /**
   * How a duplicate that arrives while the first copy is still in progress is handled. Defaults to
   * {@link InProgressBehavior.Skip}.
   */
  inProgressBehavior: InProgressBehavior = InProgressBehavior.Skip;
}

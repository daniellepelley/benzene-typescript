import { IdempotencyStatus } from './IdempotencyStatus';

/**
 * The persisted record for one idempotency key: whether it is still in progress or completed, and
 * (once completed) whether the first processing attempt succeeded.
 * Port of Benzene.Idempotency.IdempotencyRecord.
 */
export class IdempotencyRecord {
  /** The idempotency key this record is for. */
  readonly key: string;

  /** The record's lifecycle state. */
  readonly status: IdempotencyStatus;

  /**
   * Whether the first processing attempt succeeded. Only meaningful when {@link status} is
   * {@link IdempotencyStatus.Completed}.
   */
  readonly wasSuccessful: boolean;

  constructor(key: string, status: IdempotencyStatus, wasSuccessful = false) {
    this.key = key;
    this.status = status;
    this.wasSuccessful = wasSuccessful;
  }
}

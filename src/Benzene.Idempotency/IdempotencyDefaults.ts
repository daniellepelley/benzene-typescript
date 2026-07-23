/** Shared default values for idempotency handling. Port of Benzene.Idempotency.IdempotencyDefaults. */
export const IdempotencyDefaults = {
  /** The default header name a caller-supplied idempotency key is read from. */
  headerName: 'idempotency-key',
} as const;

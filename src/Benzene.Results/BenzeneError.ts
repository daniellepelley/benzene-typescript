/**
 * One structured error inside a problem document's `errors` member (wire-contracts.md §1.3).
 * Port of Benzene.Results.BenzeneError.
 *
 * `errors`, when present, is **authoritative and ordered** — it supersedes the withdrawn "recover
 * the errors from `detail`" rule, which was never implementable (splitting human prose on `", "`
 * is unsafe: messages contain commas).
 */
export interface BenzeneError {
  /** Required. The human-readable error message. */
  message: string;

  /**
   * Optional. The producer's property path — a JSON Pointer for schema-based validators, the host
   * language's property path for others. Document which per integration.
   */
  field?: string;

  /**
   * Optional. A machine-readable, producer-owned rule identifier, emitted verbatim — the framework
   * never normalizes or rewords it.
   */
  code?: string;
}

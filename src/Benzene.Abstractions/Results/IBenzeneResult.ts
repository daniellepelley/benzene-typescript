import { BenzeneError } from './BenzeneError';

/**
 * Represents the outcome of processing a message.
 * Port of Benzene.Abstractions.Results.IBenzeneResult.
 */
export interface IBenzeneResult {
  /** Port of C# `string Status { get; }`. */
  readonly status: string;

  /** Port of C# `bool IsSuccessful { get; }`. */
  readonly isSuccessful: boolean;

  /** Port of C# `object PayloadAsObject { get; }`. */
  readonly payloadAsObject: unknown;

  /**
   * The result's errors as **structured** errors, not bare strings (wire-contracts.md §1.3's
   * `errors` member). Port of C# `IReadOnlyList<BenzeneError> Errors { get; }`.
   *
   * This was `string[]` until the RFC 9457 alignment. A string can carry a message but not the
   * `field` or `code` the problem document defines, so the port could never emit either - a
   * capability .NET had and this one silently did not. `BenzeneResult.setErrors` still accepts
   * plain strings and widens them, so a caller that only has messages writes exactly what it did
   * before.
   */
  readonly errors: BenzeneError[];
}

/** Port of Benzene.Abstractions.Results.IBenzeneResult&lt;T&gt;. */
export interface IBenzeneResultOf<T> extends IBenzeneResult {
  /** Port of C# `T Payload { get; }`. */
  readonly payload: T;
}

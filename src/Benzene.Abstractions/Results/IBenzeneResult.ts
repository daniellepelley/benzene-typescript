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

  /** Port of C# `string[] Errors { get; }`. */
  readonly errors: string[];
}

/** Port of Benzene.Abstractions.Results.IBenzeneResult&lt;T&gt;. */
export interface IBenzeneResultOf<T> extends IBenzeneResult {
  /** Port of C# `T Payload { get; }`. */
  readonly payload: T;
}

/** Port of Benzene.Core.Messages.BenzeneMessage.IBenzeneMessageResponse. */

/**
 * The outbound half of the transport-agnostic `BenzeneMessage` format: a status code, a success
 * flag, a set of string headers, and a raw string body. Every member is mutable (C# `{ get; set; }`),
 * since the response is populated as the pipeline runs.
 */
export interface IBenzeneMessageResponse {
  statusCode: string;

  /**
   * The authoritative success/failure signal (wire-contracts.md §1.2). A receiver honors this over
   * any classification it derives from {@link statusCode} text, because an application-defined status
   * is outside the framework's known vocabulary and means nothing to a receiver that doesn't share
   * the sender's status vocabulary.
   */
  isSuccessful: boolean;
  headers: Record<string, string>;
  body: string;
}

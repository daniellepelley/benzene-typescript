/** Port of Benzene.Core.Messages.BenzeneMessage.IBenzeneMessageResponse. */

/**
 * The outbound half of the transport-agnostic `BenzeneMessage` format: a status code, a set of
 * string headers, and a raw string body. Every member is mutable (C# `{ get; set; }`), since the
 * response is populated as the pipeline runs.
 */
export interface IBenzeneMessageResponse {
  statusCode: string;
  headers: Record<string, string>;
  body: string;
}

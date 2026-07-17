/** Port of Benzene.Core.Messages.BenzeneMessage.IBenzeneMessageRequest. */

/**
 * The inbound half of the transport-agnostic `BenzeneMessage` format: a topic, a set of string
 * headers, and a raw string body.
 */
export interface IBenzeneMessageRequest {
  readonly topic: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

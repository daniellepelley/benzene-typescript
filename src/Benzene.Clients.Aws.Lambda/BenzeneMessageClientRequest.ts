/** Port of Benzene.Clients.Aws.Lambda.BenzeneMessageClientRequest. */

/**
 * The envelope sent to a target Lambda function, carrying the message topic, headers, and serialized message
 * body. Serializes to the standard Benzene message envelope (`{ "topic": ..., "headers": { ... }, "body":
 * "..." }`) that the receiving side's `BenzeneMessageRequest` deserializes. `IDictionary<string,string>` ->
 * `Record<string,string>`.
 */
export class BenzeneMessageClientRequest {
  constructor(
    readonly topic: string,
    readonly headers: Record<string, string>,
    readonly body: string,
  ) {}
}

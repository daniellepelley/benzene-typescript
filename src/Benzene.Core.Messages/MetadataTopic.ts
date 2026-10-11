/**
 * The reserved-key rules every native-metadata inbound binding applies to its string->string metadata
 * channel - SQS/SNS message attributes, Pub/Sub attributes, Service Bus/Event Hub application properties,
 * RabbitMQ headers (wire-contracts.md §2, transport-metadata-cases.json):
 *
 * - the topic is read from ONE configured key (default `topic`), matched case-insensitively because header
 *   keys are case-insensitive on read - an exact-case match wins when a producer sent both spellings;
 * - that key is CONSUMED: it becomes the topic and does not reappear in the header dictionary, while every
 *   other entry (`benzene-version` included - the version getter reads it from the headers) stays a header.
 *
 * TypeScript-only file with no direct C# counterpart: .NET repeats these rules in each binding's getters;
 * the port keeps them in one place so the bindings cannot drift apart (README "Porting conventions").
 */

/** The spec's default reserved topic key (wire-contracts.md §2) - each binding's `Default...` constant. */
export const DefaultMetadataTopicKey = 'topic';

/** Whether `key` names the reserved `name` - a case-insensitive comparison (wire-contracts.md preamble). */
export function isMetadataKey(key: string, name: string): boolean {
  return key.toLowerCase() === name.toLowerCase();
}

/**
 * The value stored under `name` in a metadata dictionary, matched case-insensitively; an exact-case match
 * wins over a differently-cased one. `undefined` when the key is absent.
 */
export function findMetadataValue<T>(metadata: Readonly<Record<string, T>> | undefined | null, name: string): T | undefined {
  if (metadata === undefined || metadata === null) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(metadata, name)) {
    return metadata[name];
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (isMetadataKey(key, name)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Removes every spelling of the consumed key `name` from a header dictionary built from native metadata,
 * so the routing key does not reappear as an ordinary header (transport-metadata-cases.json
 * `headersExclude`). Mutates and returns `headers`.
 */
export function withoutMetadataKey(headers: Record<string, string>, name: string): Record<string, string> {
  for (const key of Object.keys(headers)) {
    if (isMetadataKey(key, name)) {
      delete headers[key];
    }
  }
  return headers;
}

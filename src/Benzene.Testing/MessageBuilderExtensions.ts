/** Port of Benzene.Testing.MessageBuilderExtensions + Benzene.Core.Messages.TestHelpers.MessageBuilderExtensions. */
import { IHttpBuilder, IMessageBuilder, ISerializer } from '@benzenejs/abstractions';
import { BenzeneMessageRequest } from '@benzenejs/core-messages';

/** A serializer, or just its `serialize` half. C#'s required `ISerializer` becomes optional, defaulting to JSON. */
export type MessageSerializer = Pick<ISerializer, 'serialize'>;

const jsonSerializer: MessageSerializer = { serialize: (payload) => JSON.stringify(payload) };

/**
 * Turns a message builder into a `BenzeneMessageRequest` (topic + serialized body + headers) - the
 * transport-neutral envelope to drive through a `BenzeneMessageApplication`. Port of
 * `Benzene.Core.Messages.TestHelpers.MessageBuilderExtensions.AsBenzeneMessage`; the serializer
 * defaults to JSON rather than being required.
 */
export function asBenzeneMessage<T>(
  source: IMessageBuilder<T>,
  serializer: MessageSerializer = jsonSerializer,
): BenzeneMessageRequest {
  const request = new BenzeneMessageRequest();
  request.topic = source.topic;
  request.headers = { ...source.headers };
  request.body = serializer.serialize(source.message);
  return request;
}

/**
 * Renders an HTTP builder as a raw HTTP/1.1 request string (CRLF line endings per RFC 7230). Port of
 * `Benzene.Testing.MessageBuilderExtensions.AsRawHttpRequest`.
 */
export function asRawHttpRequest<T>(
  source: IHttpBuilder<T>,
  serializer: MessageSerializer = jsonSerializer,
): string {
  const lines = [`${source.method} ${source.path} HTTP/1.1`];
  for (const [key, value] of Object.entries(source.headers)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push(''); // blank line separating headers from body
  lines.push(serializer.serialize(source.message));
  return lines.join('\r\n');
}

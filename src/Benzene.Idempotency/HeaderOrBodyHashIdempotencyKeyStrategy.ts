import { createHash } from 'node:crypto';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { IIdempotencyKeyStrategy } from './IIdempotencyKeyStrategy';
import { IdempotencyOptions } from './IdempotencyOptions';

/**
 * The default {@link IIdempotencyKeyStrategy}: prefers a caller-supplied key from the configured
 * header, and otherwise (when {@link IdempotencyOptions.hashBodyWhenNoHeader} is enabled) derives a
 * deterministic key by hashing the message topic and body, so identical redeliveries produce the same
 * key.
 * Port of Benzene.Idempotency.HeaderOrBodyHashIdempotencyKeyStrategy&lt;TContext&gt;.
 */
export class HeaderOrBodyHashIdempotencyKeyStrategy<TContext>
  implements IIdempotencyKeyStrategy<TContext>
{
  constructor(
    private readonly headersGetter: IMessageHeadersGetter<TContext>,
    private readonly bodyGetter: IMessageBodyGetter<TContext>,
    private readonly topicGetter: IMessageTopicGetter<TContext>,
    private readonly options: IdempotencyOptions,
  ) {}

  getKey(context: TContext): string | undefined {
    const headers = this.headersGetter.getHeaders(context);
    if (headers) {
      const headerKey = tryGetHeader(headers, this.options.headerName);
      if (headerKey !== undefined && headerKey.trim() !== '') {
        return this.options.keyPrefix + headerKey;
      }
    }

    if (!this.options.hashBodyWhenNoHeader) {
      return undefined;
    }

    const topic = this.topicGetter.getTopic(context);
    const id = topic?.id ?? '';
    const version = topic?.version ?? '';
    const body = this.bodyGetter.getBody(context) ?? '';

    // Length-prefix each field so distinct (id, version, body) triples can't collide through separator
    // ambiguity - e.g. id="order"/version="v2:create" and id="order:v2"/version="create" used to
    // flatten to the same "order:v2:create..." string, hashing identical and dropping one message as a
    // false duplicate. With lengths, the field boundaries are unambiguous.
    return (
      this.options.keyPrefix +
      computeHash(`${id.length}:${id}|${version.length}:${version}|${body.length}:${body}`)
    );
  }
}

/**
 * Case-insensitive header lookup (wire-contracts.md §2). Without this, a canonically-cased header (e.g.
 * "Idempotency-Key") would be missed and the caller's explicit key silently ignored in favour of
 * body-hashing.
 */
function tryGetHeader(headers: Record<string, string>, key: string): string | undefined {
  const direct = headers[key];
  if (direct !== undefined) {
    return direct;
  }

  const lowerKey = key.toLowerCase();
  for (const [headerKey, headerValue] of Object.entries(headers)) {
    if (headerKey.toLowerCase() === lowerKey) {
      return headerValue;
    }
  }

  return undefined;
}

function computeHash(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').toUpperCase();
}

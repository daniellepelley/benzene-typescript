import { IMessageGetter } from '@benzene/abstractions-message-handlers';
import { IMessageBodyBytesGetter, ITopic } from '@benzene/abstractions-messages';
import { BenzeneMessageContext, Constants, Topic } from '@benzene/core-messages';

/**
 * Default `IMessageGetter<BenzeneMessageContext>` for the transport-agnostic `BenzeneMessage`
 * format: extracts topic, body, and headers from the context's underlying `IBenzeneMessageRequest`.
 * Also implements `IMessageBodyBytesGetter<BenzeneMessageContext>` (UTF-8 encoding the string body),
 * making `BenzeneMessage` the reference transport for the byte-oriented request-mapping path.
 * Port of Benzene.Core.MessageHandlers.BenzeneMessage.BenzeneBodyMapper.
 *
 * FILE-NAME QUIRK (kept from C#): despite the file being named `BenzeneBodyMapper`, the class is
 * `BenzeneMessageGetter`, not `BenzeneBodyMapper` — it maps more than just the body (topic and
 * headers too). `addBenzeneMessage` registers it against `IMessageGetter<BenzeneMessageContext>` and
 * each of its constituent getter interfaces.
 *
 * Deviations: C# `Utils.GetValue(headers, "version")` (null when absent) becomes a plain
 * `headers?.["version"]` lookup (`undefined` when absent), which `Topic` already treats as the
 * unversioned default. C# `ReadOnlyMemory<byte>` becomes `Uint8Array`; an empty/undefined body maps
 * to an empty `Uint8Array` (the port of `ReadOnlyMemory<byte>.Empty`).
 */
export class BenzeneMessageGetter
  implements IMessageGetter<BenzeneMessageContext>, IMessageBodyBytesGetter<BenzeneMessageContext>
{
  getHeaders(context: BenzeneMessageContext): Record<string, string> {
    return context.benzeneMessageRequest.headers ?? {};
  }

  getTopic(context: BenzeneMessageContext): ITopic | undefined {
    if (context?.benzeneMessageRequest?.topic === undefined || context.benzeneMessageRequest.topic === null) {
      return new Topic(Constants.missing.id);
    }

    return new Topic(
      context.benzeneMessageRequest.topic,
      context.benzeneMessageRequest.headers?.['version'],
    );
  }

  getBody(context: BenzeneMessageContext): string | undefined {
    return context.benzeneMessageRequest.body;
  }

  getBodyBytes(context: BenzeneMessageContext): Uint8Array {
    const body = context.benzeneMessageRequest.body;
    return body === undefined || body === null || body === ''
      ? new Uint8Array()
      : new TextEncoder().encode(body);
  }
}

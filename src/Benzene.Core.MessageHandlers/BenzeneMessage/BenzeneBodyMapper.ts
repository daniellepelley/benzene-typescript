import { IServiceResolver } from '@benzenejs/abstractions';
import {
  getVersionedTopic,
  IMessageGetter,
  IMessageTopicGetter,
  IMessageVersionGetter,
} from '@benzenejs/abstractions-message-handlers';
import { IMessageBodyBytesGetter, ITopic } from '@benzenejs/abstractions-messages';
import { BenzeneMessageContext, Constants, Topic } from '@benzenejs/core-messages';

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
 * The topic's version is the message's version signal — the `benzene-version` header (or the name the
 * application configured), read through the registered `IMessageVersionGetter` and joined onto the raw
 * envelope topic exactly as every other transport's `MessageGetter` does (`getVersionedTopic`). A bare
 * `version` header is an ordinary header and selects nothing (wire-contracts §2). The version getter is
 * resolved lazily from the scope because it itself reads headers through this class — resolving it in
 * the constructor would re-enter this registration (the same reason .NET resolves it lazily).
 *
 * Deviations: C# `ReadOnlyMemory<byte>` becomes `Uint8Array`; an empty/undefined body maps to an empty
 * `Uint8Array` (the port of `ReadOnlyMemory<byte>.Empty`).
 */
export class BenzeneMessageGetter
  implements IMessageGetter<BenzeneMessageContext>, IMessageBodyBytesGetter<BenzeneMessageContext>
{
  getHeaders(context: BenzeneMessageContext): Record<string, string> {
    return context?.benzeneMessageRequest?.headers ?? {};
  }

  /**
   * @param serviceResolver The scope the `IMessageVersionGetter` is lazily resolved from. Without one (a
   * getter constructed by hand) the topic carries no version.
   */
  constructor(private readonly serviceResolver?: IServiceResolver) {}

  getTopic(context: BenzeneMessageContext): ITopic | undefined {
    return getVersionedTopic(rawTopicGetter, context, this.resolveVersionGetter());
  }

  private resolveVersionGetter(): IMessageVersionGetter<BenzeneMessageContext> | undefined {
    return this.serviceResolver?.tryGetService(IMessageVersionGetter) as
      | IMessageVersionGetter<BenzeneMessageContext>
      | undefined;
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

/** The envelope's topic id, without a version (the version comes from the version getter). */
const rawTopicGetter: IMessageTopicGetter<BenzeneMessageContext> = {
  getTopic(context: BenzeneMessageContext): ITopic {
    if (context?.benzeneMessageRequest?.topic === undefined || context.benzeneMessageRequest.topic === null) {
      return new Topic(Constants.missing.id);
    }
    return new Topic(context.benzeneMessageRequest.topic);
  },
};

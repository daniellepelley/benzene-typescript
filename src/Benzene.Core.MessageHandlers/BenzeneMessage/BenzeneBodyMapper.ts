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
 * `getTopic` joins the raw envelope topic with the message's own version signal (.NET task #98) via
 * the shared `getVersionedTopic` helper — the raw envelope topic never carries a version itself: the
 * payload schema version is resolved by the configurable, priority-ordered `IMessageVersionGetter`
 * (default `benzene-version` &gt; `version` &gt; `x-version`, see `HeaderMessageVersionGetter`).
 * Baking the raw `version` header into the raw topic directly (as this class used to) would make the
 * router treat it as a preset override and skip the version getter, defeating both the configured
 * header order and any app that narrows the list (docs/specification/versioning.md §2.1).
 *
 * The version getter is resolved LAZILY inside `getTopic` from the optional `serviceResolver` rather
 * than taken as a constructor dependency — deliberate, matching C#: this class is registered as the
 * DI implementation of both `IMessageGetter` and `IMessageHeadersGetter`, and the default
 * `HeaderMessageVersionGetter` itself depends on `IMessageHeadersGetter`, so a constructor dependency
 * would re-enter this same class's construction one level down. Optional: when no resolver is given
 * (a direct construction in a test) the topic is returned unaugmented — never throws.
 *
 * Deviations: C# `ReadOnlyMemory<byte>` becomes `Uint8Array`; an empty/undefined body maps to an
 * empty `Uint8Array` (the port of `ReadOnlyMemory<byte>.Empty`).
 */
export class BenzeneMessageGetter
  implements IMessageGetter<BenzeneMessageContext>, IMessageBodyBytesGetter<BenzeneMessageContext>
{
  constructor(private readonly serviceResolver?: IServiceResolver) {}

  // The `context?.benzeneMessageRequest?` guards below mirror getTopic's long-standing guard: with
  // the port's erased IMessageGetter token, a cross-context consumer (e.g. a diagnostics decorator
  // wrapping a handler-level pipeline) can hand this getter a context that is not a
  // BenzeneMessageContext at all — answer "nothing here" rather than throwing.
  getHeaders(context: BenzeneMessageContext): Record<string, string> {
    return context?.benzeneMessageRequest?.headers ?? {};
  }

  getTopic(context: BenzeneMessageContext): ITopic | undefined {
    return getVersionedTopic(rawTopicGetter, context, this.resolveVersionGetter());
  }

  getBody(context: BenzeneMessageContext): string | undefined {
    return context?.benzeneMessageRequest?.body;
  }

  getBodyBytes(context: BenzeneMessageContext): Uint8Array {
    const body = context?.benzeneMessageRequest?.body;
    return body === undefined || body === null || body === ''
      ? new Uint8Array()
      : new TextEncoder().encode(body);
  }

  // See the class doc comment for why this is resolved lazily here rather than injected.
  private resolveVersionGetter(): IMessageVersionGetter<BenzeneMessageContext> | undefined {
    return this.serviceResolver?.tryGetService(IMessageVersionGetter) as
      | IMessageVersionGetter<BenzeneMessageContext>
      | undefined;
  }
}

/**
 * The version-less envelope topic extraction, isolated behind `IMessageTopicGetter` so `getTopic`
 * can join it with `IMessageVersionGetter` via the shared `getVersionedTopic` helper instead of
 * re-deriving the join inline. Stateless, so one shared instance is enough (the port of C#'s private
 * `RawTopicGetter.Instance`).
 */
const rawTopicGetter: IMessageTopicGetter<BenzeneMessageContext> = {
  getTopic(context: BenzeneMessageContext): ITopic {
    if (context?.benzeneMessageRequest?.topic === undefined || context.benzeneMessageRequest.topic === null) {
      return new Topic(Constants.missing.id);
    }

    return new Topic(context.benzeneMessageRequest.topic);
  },
};

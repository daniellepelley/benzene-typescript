import {
  getVersionedTopic,
  IMessageGetter,
  IMessageTopicGetter,
  IMessageVersionGetter,
} from '@benzenejs/abstractions-message-handlers';
import {
  IMessageBodyGetter,
  IMessageHeadersGetter,
  ITopic,
} from '@benzenejs/abstractions-messages';

/**
 * Default `IMessageGetter<TContext>` implementation that composes the individually registered
 * `IMessageTopicGetter`, `IMessageBodyGetter` and `IMessageHeadersGetter` for `TContext` into a
 * single facade, so callers that need all three don't have to depend on each mapper individually.
 * Port of Benzene.Core.MessageHandlers.MessageGetter&lt;TContext&gt;.
 *
 * `getTopic` also joins in the optionally supplied `IMessageVersionGetter<TContext>` (.NET task #98)
 * via the shared {@link getVersionedTopic} helper, so whenever this facade's topic is resolvable at
 * all it is the same version-resolved `ITopic` the router routes on — the join used to happen only in
 * consumers that combined the two getters themselves, leaving everything reading this facade
 * (diagnostics, schema validation, mesh tracing) with a version-blind topic. When no version getter
 * is supplied (none registered for `TContext`, or a direct construction in a test) the topic is
 * returned unaugmented — never throws.
 *
 * PORTING NOTE: the C# constructor additionally takes a scoped `ResolvedTopicCache<TContext>` so the
 * joined topic is extracted once per message; the port has no such cache yet, so the topic is
 * extracted on every call (exactly the C# no-cache path).
 */
export class MessageGetter<TContext> implements IMessageGetter<TContext> {
  constructor(
    private readonly messageTopicGetter: IMessageTopicGetter<TContext>,
    private readonly messageBodyGetter: IMessageBodyGetter<TContext>,
    private readonly messageHeadersGetter: IMessageHeadersGetter<TContext>,
    private readonly messageVersionGetter?: IMessageVersionGetter<TContext>,
  ) {}

  getBody(context: TContext): string | undefined {
    return this.messageBodyGetter.getBody(context);
  }

  getHeaders(context: TContext): Record<string, string> {
    return this.messageHeadersGetter.getHeaders(context);
  }

  getTopic(context: TContext): ITopic | undefined {
    return getVersionedTopic(this.messageTopicGetter, context, this.messageVersionGetter);
  }
}

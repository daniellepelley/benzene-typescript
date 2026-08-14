/**
 * A composition-root seam that keys handler-version dispatch (Mechanism A) off the canonical
 * `benzene-version` metadata header — the same signal the payload-casting pipeline (Mechanism B) reads.
 *
 * WHY THIS EXISTS: the router picks a versioned handler from `topic.version` (see `MessageRouter` →
 * `MessageHandlerDefinitionLookUp`), and it reads the topic via `IMessageGetter.getTopic`. The stock
 * BenzeneMessage getter sources that version from a `version` header, whereas the spec's canonical version
 * key — and `HeaderMessageVersionGetter`'s primary name — is `benzene-version`. `IMessageVersionGetter`'s
 * own contract states its purpose is "so a router can COMBINE IT WITH THE TOPIC into the version-aware
 * dispatch key"; this decorator does exactly that, stamping the topic's version from the resolved
 * `IMessageVersionGetter` so BOTH versioning axes read the one canonical `benzene-version` header. It wraps
 * the transport's real getter and changes nothing else.
 */
import { ITopic } from '@benzenejs/abstractions-messages';
import { IMessageGetter, IMessageVersionGetter } from '@benzenejs/abstractions-message-handlers';
import { BenzeneMessageContext, Topic } from '@benzenejs/core-messages';

export class VersionAwareMessageGetter implements IMessageGetter<BenzeneMessageContext> {
  constructor(
    private readonly inner: IMessageGetter<BenzeneMessageContext>,
    private readonly versionGetter: IMessageVersionGetter<BenzeneMessageContext>,
  ) {}

  getBody(context: BenzeneMessageContext): string | undefined {
    return this.inner.getBody(context);
  }

  getHeaders(context: BenzeneMessageContext): Record<string, string> {
    return this.inner.getHeaders(context);
  }

  getTopic(context: BenzeneMessageContext): ITopic | undefined {
    const topic = this.inner.getTopic(context);
    if (topic === undefined) {
      return topic;
    }
    const version = this.versionGetter.getVersion(context);
    return new Topic(topic.id, version !== undefined && version !== '' ? version : topic.version);
  }
}

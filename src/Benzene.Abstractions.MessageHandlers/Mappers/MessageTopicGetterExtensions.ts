/** Port of Benzene.Abstractions.MessageHandlers.Mappers.MessageTopicGetterExtensions. */
import { ITopic } from '@benzenejs/abstractions-messages';
import { IMessageTopicGetter } from './IMessageTopicGetter';
import { IMessageVersionGetter } from './IMessageVersionGetter';

/**
 * Reads the topic and joins the message's own version signal onto it — the version-aware dispatch key the
 * router selects a handler with (core-concepts §2). A version already on the topic (an explicit
 * `usePresetTopic(topicId, version)`) is a deliberate override and wins; the message's version (the
 * `benzene-version` header, via `IMessageVersionGetter`) only fills the gap.
 *
 * C# extension method `GetVersionedTopic(this IMessageTopicGetter<TContext>, ...)` -> free function.
 *
 * DIVERGENCE: reading the version never throws. Generics are erased in TypeScript, so cross-cutting
 * decorators (e.g. the diagnostics activity decorator) call `getTopic` with contexts of other pipelines
 * (a handler-level context), which a transport's header getter cannot read; such a context simply
 * carries no version, as it carried no topic before the version join existed.
 */
export function getVersionedTopic<TContext>(
  messageTopicGetter: IMessageTopicGetter<TContext>,
  context: TContext,
  messageVersionGetter: IMessageVersionGetter<TContext> | undefined,
): ITopic | undefined {
  const topic = messageTopicGetter.getTopic(context);

  if (
    messageVersionGetter !== undefined &&
    topic !== undefined &&
    topic.id !== undefined &&
    topic.id !== '' &&
    (topic.version === undefined || topic.version === '')
  ) {
    const version = tryGetVersion(messageVersionGetter, context);
    if (version !== undefined && version !== '') {
      return { id: topic.id, version };
    }
  }

  return topic;
}

function tryGetVersion<TContext>(
  messageVersionGetter: IMessageVersionGetter<TContext>,
  context: TContext,
): string | undefined {
  try {
    return messageVersionGetter.getVersion(context);
  } catch {
    return undefined;
  }
}

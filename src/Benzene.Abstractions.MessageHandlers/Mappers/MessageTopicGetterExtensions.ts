/** Port of Benzene.Abstractions.MessageHandlers.Mappers.MessageTopicGetterExtensions. */
import { ITopic } from '@benzenejs/abstractions-messages';
import { IMessageTopicGetter } from './IMessageTopicGetter';
import { IMessageVersionGetter } from './IMessageVersionGetter';

/**
 * Shared version-augmentation helper for resolving the topic a request actually declares. Any
 * consumer that resolves a handler via a topic (schema validation, tracing/log diagnostics, message
 * routing itself) must combine `IMessageTopicGetter.getTopic` with the message's own version signal
 * (`IMessageVersionGetter`) before calling `IMessageHandlerDefinitionLookUp.findHandler` — otherwise,
 * for a topic with 2+ registered handler versions, the lookup falls back to `VersionSelector`'s
 * unversioned max default rather than the version the request declares
 * (docs/specification/versioning.md §2.3). This is the one implementation of that combination; every
 * consumer — present and future — should call it rather than re-deriving the same few lines.
 *
 * Port of the C# `GetVersionedTopic` extension method (extension method → free function taking the
 * getter as its first argument, per the porting conventions; .NET tasks #69/#70/#98).
 *
 * A version already on the topic (e.g. an explicit preset topic with a version) is a deliberate
 * override and wins; the message's own version signal only fills the gap when the topic getter
 * didn't supply one. When `messageVersionGetter` is `undefined` (no version getter registered for
 * this context type) the topic is returned unaugmented — never throws.
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
    const version = messageVersionGetter.getVersion(context);
    if (version !== undefined && version !== '') {
      return new VersionedTopic(topic.id, version);
    }
  }

  return topic;
}

/** The version-joined topic `getVersionedTopic` produces (the port of C#'s private `VersionedTopic`). */
class VersionedTopic implements ITopic {
  constructor(
    readonly id: string,
    readonly version: string,
  ) {}
}

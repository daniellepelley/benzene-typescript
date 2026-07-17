import { ITopic } from '@benzene/abstractions-messages';

/**
 * Carries a preset `ITopic` for the current message, set by `PresetTopicMiddleware<TContext>` (via
 * the `usePresetTopic` pipeline extension) and read back by `PresetTopicMessageTopicGetter<TContext>`.
 * Port of Benzene.Core.MessageHandlers.PresetTopicHolder.
 *
 * Registered scoped (one instance per message) — deliberately NOT carried on the transport context.
 * A context type describes the shape of a transport message; it stays free of optional, cross-cutting
 * routing overrides that only some pipelines opt into. A queue/subscription that never calls
 * `usePresetTopic` never constructs a `PresetTopicMiddleware`, so this holder's `presetTopic` stays
 * `undefined` for that message and the topic getter falls through to the transport's real getter.
 */
export class PresetTopicHolder {
  /** The preset topic for the current message, or `undefined` if none has been set. */
  presetTopic: ITopic | undefined;
}

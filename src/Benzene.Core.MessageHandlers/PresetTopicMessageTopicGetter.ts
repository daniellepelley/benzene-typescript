import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { PresetTopicHolder } from './PresetTopicHolder';

/**
 * Decorates a transport's `IMessageTopicGetter<TContext>`, preferring `PresetTopicHolder.presetTopic`
 * when it has been set for the current message (by `PresetTopicMiddleware<TContext>`, via the
 * `usePresetTopic` pipeline extension) and falling back to the transport's own topic extraction
 * otherwise.
 * Port of Benzene.Core.MessageHandlers.PresetTopicMessageTopicGetter&lt;TContext&gt;.
 */
export class PresetTopicMessageTopicGetter<TContext> implements IMessageTopicGetter<TContext> {
  constructor(
    private readonly inner: IMessageTopicGetter<TContext>,
    private readonly holder: PresetTopicHolder,
  ) {}

  getTopic(context: TContext): ITopic | undefined {
    return this.holder.presetTopic ?? this.inner.getTopic(context);
  }
}

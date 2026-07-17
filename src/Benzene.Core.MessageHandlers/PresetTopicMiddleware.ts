import { ITopic } from '@benzene/abstractions-messages';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { PresetTopicHolder } from './PresetTopicHolder';

/**
 * Sets a fixed `ITopic` on the current message's `PresetTopicHolder` before continuing the pipeline,
 * so a `PresetTopicMessageTopicGetter<TContext>` resolves it in preference to whatever the transport
 * itself would otherwise extract. Added via the `usePresetTopic` pipeline extension, before
 * `useMessageHandlers`, for one specific queue/subscription's pipeline.
 * Port of Benzene.Core.MessageHandlers.PresetTopicMiddleware&lt;TContext&gt;.
 */
export class PresetTopicMiddleware<TContext> implements IMiddleware<TContext> {
  constructor(
    private readonly holder: PresetTopicHolder,
    private readonly presetTopic: ITopic,
  ) {}

  readonly name = 'PresetTopic';

  handleAsync(_context: TContext, next: NextFunc): Promise<void> {
    this.holder.presetTopic = this.presetTopic;
    return next();
  }
}

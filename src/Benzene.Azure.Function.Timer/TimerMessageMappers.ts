/** Port of Benzene.Azure.Function.Timer.TimerMessageMappers. */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter, ITopic } from '@benzene/abstractions-messages';
import { JsonSerializer, MessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { TimerContext } from './TimerContext';

/**
 * The transport's own topic getter for timer ticks — which always returns `undefined` (C# `null`),
 * because a tick carries no message; the topic is the scheduled job's identity, declared per pipeline
 * with `usePresetTopic("nightly-cleanup")` (via the `PresetTopicMessageTopicGetter` this getter is
 * wrapped in by `addAzureTimer`).
 */
export class TimerMessageTopicGetter implements IMessageTopicGetter<TimerContext> {
  getTopic(_context: TimerContext): ITopic | undefined {
    return undefined;
  }
}

/**
 * Provides the headers for a timer tick — always empty; a tick carries no message metadata beyond the
 * schedule info in the body.
 */
export class TimerMessageHeadersGetter implements IMessageHeadersGetter<TimerContext> {
  getHeaders(_context: TimerContext): Record<string, string> {
    return {};
  }
}

/**
 * Provides the message body for a timer tick: the serialized `TimerTriggerInfo`, so a handler whose
 * request type mirrors it (or any subset of its properties) receives the schedule information, and a
 * handler with an empty request type binds cleanly too.
 */
export class TimerMessageBodyGetter implements IMessageBodyGetter<TimerContext> {
  private readonly serializer: JsonSerializer;

  /**
   * @param serializer The serializer used to write the timer info as the body.
   */
  constructor(serializer: JsonSerializer) {
    this.serializer = serializer;
  }

  getBody(context: TimerContext): string {
    return this.serializer.serialize(context.timer);
  }
}

/**
 * Records a message handler's outcome onto `TimerContext.messageResult` — recorded for
 * middleware/diagnostics; a tick has no caller to answer.
 *
 * C# `MessageHandlerResultSetterBase<TimerContext>` (an empty body: `... : Base;`) ports to a trivial
 * subclass of the already-ported `MessageMessageHandlerResultSetterBase`.
 */
export class TimerMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<TimerContext> {}

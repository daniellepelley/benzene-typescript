/** Port of Benzene.Azure.Function.Timer.TimerContext. */
import { IHasMessageResult, IMessageResult } from '@benzenejs/abstractions-message-handlers';
import { TimerTriggerInfo } from './TimerTriggerInfo';

/**
 * Provides the middleware pipeline context for a single timer tick within an Azure Functions timer
 * trigger invocation. Implements the already-ported `IHasMessageResult` so
 * `TimerMessageHandlerResultSetter` can record the handler outcome onto it.
 */
export class TimerContext implements IHasMessageResult {
  /**
   * @param timer The tick's timer information.
   */
  constructor(timer: TimerTriggerInfo) {
    this.timer = timer;
  }

  /** The tick's timer information. */
  readonly timer: TimerTriggerInfo;

  /**
   * The result of handling this tick. A timer tick has no caller to answer, so this is recorded for
   * middleware/diagnostics only. Unset (C# `null`) until a result has been recorded.
   */
  messageResult!: IMessageResult;
}

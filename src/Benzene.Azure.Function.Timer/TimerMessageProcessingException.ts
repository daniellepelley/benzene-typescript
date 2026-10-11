/** Port of Benzene.Azure.Function.Timer.TimerMessageProcessingException. */

/** Thrown by `TimerApplication` when a tick's handler reported a failure result (`raiseOnFailureStatus`). */
export class TimerMessageProcessingException extends Error {
  constructor() {
    super(
      'The timer tick was not processed successfully (a failure result, or a preset topic no handler serves); ' +
        'failing the invocation so the Functions host records it (and retries it, if a retry policy is set).',
    );
    this.name = 'TimerMessageProcessingException';
  }
}

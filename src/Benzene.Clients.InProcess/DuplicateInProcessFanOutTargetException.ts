/**
 * Thrown by `useInProcessFanOut(...)` when two targets in the same call name the same topic.
 * Port of Benzene.Clients.InProcess.DuplicateInProcessFanOutTargetException.
 *
 * Benzene's (topic, version) → at most one handler invariant is enforced process-wide, not per
 * in-process pipeline - every named pipeline `InProcessMessagingBuilder` builds shares the same
 * underlying handler registration, the same way every transport a service exposes (HTTP, a queue
 * consumer, ...) does today. Two fan-out targets reacting to what is conceptually one event must
 * therefore each dispatch under a topic of their own (e.g. `"billing:order-created"`,
 * `"shipping:order-created"`), not the literal topic the event was published under.
 */
export class DuplicateInProcessFanOutTargetException extends Error {
  /** The topic named by more than one target. */
  readonly topic: string;

  constructor(topic: string) {
    super(
      `useInProcessFanOut(...) was given more than one target for topic '${topic}'. Each fan-out ` +
        'target must dispatch under a topic of its own - reusing the same topic for two targets ' +
        'means two different pipelines would need a handler for the identical topic, which ' +
        "Benzene's topic model does not allow process-wide.",
    );
    this.name = 'DuplicateInProcessFanOutTargetException';
    this.topic = topic;
    Object.setPrototypeOf(this, DuplicateInProcessFanOutTargetException.prototype);
  }
}

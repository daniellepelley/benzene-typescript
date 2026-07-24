import { ISagaStateStore } from './ISagaStateStore';
import { SagaResult } from './SagaResult';
import { SagaRunInfo } from './SagaRunInfo';
import { SagaStateEvent, SagaStateEventKind } from './SagaStateEvent';

/**
 * An in-process {@link ISagaStateStore} that accumulates progress events in a list - for tests, local
 * development, and inspecting what a saga did. A production deployment supplies a durable store (a
 * table/document write) so a rolled-back or partially-rolled-back outcome survives a restart.
 * Port of Benzene.Saga.InMemorySagaStateStore (the C# `lock` is dropped - Node runs each method's
 * synchronous body to completion on a single thread).
 */
export class InMemorySagaStateStore implements ISagaStateStore {
  private readonly innerEvents: SagaStateEvent[] = [];

  /** A snapshot of every recorded event, in order. */
  get events(): readonly SagaStateEvent[] {
    return [...this.innerEvents];
  }

  /** The recorded events for one saga instance, in order. */
  eventsFor(sagaId: string): readonly SagaStateEvent[] {
    return this.innerEvents.filter((event) => event.sagaId === sagaId);
  }

  recordStartedAsync(run: SagaRunInfo): Promise<void> {
    return this.add(new SagaStateEvent(run.sagaId, run.attempt, SagaStateEventKind.Started));
  }

  recordStageCompletedAsync(sagaId: string, attempt: number, stageIndex: number): Promise<void> {
    return this.add(
      new SagaStateEvent(sagaId, attempt, SagaStateEventKind.StageCompleted, stageIndex),
    );
  }

  recordFinishedAsync(sagaId: string, attempt: number, result: SagaResult): Promise<void> {
    return this.add(
      new SagaStateEvent(sagaId, attempt, SagaStateEventKind.Finished, undefined, result),
    );
  }

  private add(stateEvent: SagaStateEvent): Promise<void> {
    this.innerEvents.push(stateEvent);
    return Promise.resolve();
  }
}

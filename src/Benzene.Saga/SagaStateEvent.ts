import { SagaResult } from './SagaResult';

/** The kind of progress event recorded to an {@link ISagaStateStore}. Port of Benzene.Saga.SagaStateEventKind. */
export enum SagaStateEventKind {
  /** A saga run attempt started. */
  Started = 0,

  /** A stage completed successfully within an attempt. */
  StageCompleted = 1,

  /** An attempt finished (with its {@link SagaResult}). */
  Finished = 2,
}

/**
 * One recorded saga-progress event, as accumulated by {@link InMemorySagaStateStore}. A durable store
 * adapter typically persists the same fields to a row/document instead.
 * Port of Benzene.Saga.SagaStateEvent.
 */
export class SagaStateEvent {
  /** The saga instance id. */
  readonly sagaId: string;

  /** The 1-based attempt number. */
  readonly attempt: number;

  /** The event kind. */
  readonly kind: SagaStateEventKind;

  /** The completed stage index (only for a {@link SagaStateEventKind.StageCompleted} event). */
  readonly stageIndex: number | undefined;

  /** The attempt's result (only for a {@link SagaStateEventKind.Finished} event). */
  readonly result: SagaResult | undefined;

  constructor(
    sagaId: string,
    attempt: number,
    kind: SagaStateEventKind,
    stageIndex?: number,
    result?: SagaResult,
  ) {
    this.sagaId = sagaId;
    this.attempt = attempt;
    this.kind = kind;
    this.stageIndex = stageIndex;
    this.result = result;
  }
}

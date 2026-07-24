import { ISagaStateStore } from './ISagaStateStore';
import { SagaRetryPolicy } from './SagaRetryPolicy';

/**
 * Options for a saga run: an optional durable {@link ISagaStateStore} and an optional
 * {@link SagaRetryPolicy}. With no options ({@link Saga.runAsync} with no argument), the saga runs once
 * in-process with no recording - the default, zero-overhead behavior.
 * Port of Benzene.Saga.SagaRunOptions.
 */
export class SagaRunOptions {
  /**
   * The saga instance id, stable across retry attempts and used in every store call. Left unset, a new
   * id is generated when a {@link stateStore} is present.
   */
  sagaId?: string;

  /** A human-readable saga name for grouping/reporting in the store. Defaults to `"saga"`. */
  name = 'saga';

  /** An optional store recording progress and outcome. `undefined` (the default) records nothing. */
  stateStore?: ISagaStateStore;

  /** An optional whole-saga retry policy. `undefined` (the default) runs a single attempt. */
  retryPolicy?: SagaRetryPolicy;
}

/** Port of Benzene.Azure.CosmosDb.BenzeneCosmosAllVersionsChangeFeedConfig. */

/**
 * Configures the processing behaviour of {@link BenzeneCosmosAllVersionsChangeFeedWorker}. Unlike
 * {@link BenzeneCosmosChangeFeedConfig} there is no auto-checkpoint knob: the all-versions-and-deletes
 * path is automatic-checkpoint only (it checkpoints after the handler returns successfully), so the
 * only decision Benzene owns here is what happens on a handler failure.
 *
 * PORTING NOTE: same class-with-field-defaults + optional {@link Partial} constructor shape as
 * {@link BenzeneCosmosChangeFeedConfig}.
 */
export class BenzeneCosmosAllVersionsChangeFeedConfig {
  /**
   * Whether an unhandled exception from the batch's pipeline is caught (logged and swallowed, so the
   * automatic checkpoint advances and the poison batch is *permanently skipped*). Defaults to `false`:
   * the exception propagates to the change feed processor, which does not checkpoint and redelivers
   * the same batch — the platform-native at-least-once behaviour (a reliably failing batch therefore
   * retries forever under the default, so either handle poison changes inside the pipeline or opt in
   * to skipping here). Mirrors {@link BenzeneCosmosChangeFeedConfig.catchHandlerExceptions}.
   */
  catchHandlerExceptions = false;

  constructor(overrides?: Partial<Pick<BenzeneCosmosAllVersionsChangeFeedConfig, 'catchHandlerExceptions'>>) {
    if (overrides?.catchHandlerExceptions !== undefined) {
      this.catchHandlerExceptions = overrides.catchHandlerExceptions;
    }
  }
}

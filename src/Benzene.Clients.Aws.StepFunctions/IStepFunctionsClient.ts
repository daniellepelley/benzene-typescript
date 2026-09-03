/** Port of Benzene.Clients.Aws.StepFunctions.IStepFunctionsClient. */
import { IBenzeneResultOf, ServiceToken, serviceToken } from '@benzenejs/abstractions';

/**
 * A client for starting AWS Step Functions state machine executions.
 *
 * PORTING NOTE: C#'s two `StartExecutionAsync` overloads (with/without an idempotency name) collapse to
 * one method with an optional `executionName` (TypeScript has default/optional parameters). The C#
 * `IDisposable` is dropped — the client holds no disposable resources.
 */
export interface IStepFunctionsClient {
  /**
   * Starts a new execution of the state machine with the given message serialized as its input.
   *
   * @param message The message to serialize as the execution input.
   * @param executionName Optional idempotency name (`StartExecutionCommand.name`): Step Functions treats
   *   a repeated name for the same state machine and input as idempotent, so a retry after a lost
   *   response won't start a duplicate — the repeat is reported as success. Sanitized to Step Functions'
   *   allowed name charset/length; omitted/empty lets AWS generate a UUID name.
   * @param signal Optional abort signal — aborting it aborts the in-flight SDK call instead of
   *   running the start to completion.
   * @returns An accepted result if the execution started (or was an idempotent repeat), or a
   *   service-unavailable result if starting it threw.
   */
  startExecutionAsync<TMessage, TResponse>(
    message: TMessage,
    executionName?: string,
    signal?: AbortSignal,
  ): Promise<IBenzeneResultOf<TResponse>>;
}

export const IStepFunctionsClient: ServiceToken<IStepFunctionsClient> =
  serviceToken<IStepFunctionsClient>('IStepFunctionsClient');

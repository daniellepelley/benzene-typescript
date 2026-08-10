import { IMiddlewareApplicationWithResult } from '@benzene/abstractions-middleware';
import { IBenzeneMessageRequest, IBenzeneMessageResponse } from '@benzene/core-messages';
import { InProcessPipelineNotFoundException } from './InProcessPipelineNotFoundException';

type Dispatcher = IMiddlewareApplicationWithResult<IBenzeneMessageRequest, IBenzeneMessageResponse>;

/**
 * The built, name-keyed set of in-process dispatchers `InProcessMessagingBuilder` produces - one
 * dispatcher per module registered via `addInProcessMessaging(registry => registry.add(name,
 * configure))`. Registered as a single singleton instance (the class itself is its own service
 * identifier - see `ServiceToken.ts`'s note); `useInProcess(name)` resolves the named dispatcher from
 * it at dispatch time.
 * Port of Benzene.Clients.InProcess.InProcessDispatcherRegistry.
 */
export class InProcessDispatcherRegistry {
  constructor(private readonly dispatchersByName: ReadonlyMap<string, Dispatcher>) {}

  /** Every registered pipeline name, for diagnostics (exception messages). */
  get names(): readonly string[] {
    return [...this.dispatchersByName.keys()];
  }

  /**
   * Resolves the dispatcher registered under `pipelineName`.
   * @throws InProcessPipelineNotFoundException No pipeline is registered under `pipelineName`.
   */
  resolve(pipelineName: string): Dispatcher {
    const dispatcher = this.dispatchersByName.get(pipelineName);
    if (dispatcher === undefined) {
      throw new InProcessPipelineNotFoundException(pipelineName, this.names);
    }
    return dispatcher;
  }
}

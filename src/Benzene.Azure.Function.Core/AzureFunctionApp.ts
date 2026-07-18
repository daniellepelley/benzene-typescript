/** Port of Benzene.Azure.Function.Core.AzureFunctionApp. */
import { IServiceResolverFactory } from '@benzene/abstractions';
import {
  IEntryPointMiddlewareApplication,
  IEntryPointMiddlewareApplicationWithResult,
} from '@benzene/abstractions-middleware';
import { BenzeneException } from '@benzene/core';
import {
  EntryPointMiddlewareApplication,
  EntryPointMiddlewareApplicationWithResult,
} from '@benzene/core-middleware';
import { IAzureFunctionApp } from './IAzureFunctionApp';

/**
 * The common shape of an entry point application registered with the builder. C#'s non-generic
 * `IEntryPointMiddlewareApplication` marker interface has no TypeScript counterpart (the port only has
 * the two generic variants), so this union stands in for `IEntryPointMiddlewareApplication[]`.
 */
export type AzureEntryPointApplication =
  | IEntryPointMiddlewareApplication<unknown>
  | IEntryPointMiddlewareApplicationWithResult<unknown, unknown>;

/**
 * Default implementation of `IAzureFunctionApp`. Dispatches a request to whichever of its constructed
 * entry point applications matches the request (and response, where applicable) type.
 *
 * TYPE-ERASURE ADAPTATION: C# picks the matching app with runtime generic type checks
 * (`app is EntryPointMiddlewareApplication<TRequest, TResponse>` /
 * `app is IEntryPointMiddlewareApplication<TRequest>`). TypeScript erases `TRequest`/`TResponse`, so
 * those exact checks are impossible. The realizable equivalent discriminates on the one thing that
 * survives erasure — arity, i.e. response vs fire-and-forget — via `instanceof` against the ported
 * concrete base classes `EntryPointMiddlewareApplicationWithResult` and
 * `EntryPointMiddlewareApplication` (the same two classes C# tests against). A host that registers at
 * most one response app and one fire-and-forget app — the normal case, and exactly what the transport
 * packages register — dispatches unambiguously; the message shape then guarantees the right handler
 * runs inside the pipeline. `BenzeneException` carries the SAME message as C#.
 */
export class AzureFunctionApp implements IAzureFunctionApp {
  private readonly apps: AzureEntryPointApplication[];

  /**
   * @param appBuilders The factories for each entry point application registered with the builder.
   * @param serviceResolverFactory The service resolver factory used to construct each entry point application.
   */
  constructor(
    appBuilders: ((serviceResolverFactory: IServiceResolverFactory) => AzureEntryPointApplication)[],
    serviceResolverFactory: IServiceResolverFactory,
  ) {
    this.apps = appBuilders.map((x) => x(serviceResolverFactory));
  }

  handleAsyncWithResult<TRequest, TResponse>(request: TRequest): Promise<TResponse> {
    for (const app of this.apps) {
      if (app instanceof EntryPointMiddlewareApplicationWithResult) {
        return (app as IEntryPointMiddlewareApplicationWithResult<TRequest, TResponse>).sendAsync(
          request,
        );
      }
    }

    throw new BenzeneException('Cannot handle this kind of request');
  }

  handleAsync<TRequest>(request: TRequest): Promise<void> {
    for (const app of this.apps) {
      if (app instanceof EntryPointMiddlewareApplication) {
        return (app as IEntryPointMiddlewareApplication<TRequest>).sendAsync(request);
      }
    }

    throw new BenzeneException('Cannot handle this kind of request');
  }
}

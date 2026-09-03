/** Port of Benzene.Mesh.Dispatch.Extensions (+ the guard wiring from Benzene.Mesh.Artifacts). */
import { ILoggerFactory, tryAddScopedFactory, tryAddSingletonFactory } from '@benzenejs/abstractions';
import {
  IBenzeneResponseAdapter,
  IMessageHandlerDefinition,
} from '@benzenejs/abstractions-message-handlers';
import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { MessageHandlerDefinition } from '@benzenejs/core-message-handlers';
import { RawStringMessage } from '@benzenejs/core-messages';
import { IHttpContext, IHttpRequestAdapter, IRouteFinder } from '@benzenejs/http';
import { MeshServiceRegistry } from '@benzenejs/mesh-contracts';
import { EnvironmentVariableMeshDispatchEnvironment, IMeshDispatchEnvironment } from './IMeshDispatchEnvironment';
import { HttpMeshServiceDispatcher } from './HttpMeshServiceDispatcher';
import { IMeshServiceDispatcher } from './IMeshServiceDispatcher';
import { MeshDispatchGate } from './MeshDispatchGate';
import { MeshDispatchGuardMiddleware } from './MeshDispatchGuardMiddleware';
import { MeshDispatchGuardOptions } from './MeshDispatchGuardOptions';
import { MeshDispatchIdentity } from './MeshDispatchIdentity';
import { MeshDispatchMessageHandler } from './MeshDispatchMessageHandler';
import { MeshDispatchOptions } from './MeshDispatchOptions';
import { MeshDispatchRateLimiter } from './MeshDispatchRateLimiter';
import { MeshDispatchRequest } from './MeshDispatchRequest';

import { DispatchTopic } from './DispatchTopic';

export { DispatchTopic };

/**
 * Registers the opt-in `benzene:mesh:dispatch` handler, which invokes ONE registered service's real handler with a
 * caller-supplied payload. Opt-in by construction AND gated at runtime (refused in Production unless
 * `MeshDispatchOptions.allowInProduction` is set). C# extension method -> free function taking the builder.
 *
 * Requires a `MeshServiceRegistry` registered in the same container, and at least one
 * `IMeshServiceDispatcher` for the transports in use (the HTTP dispatcher is registered here).
 *
 * The guard collaborators (`MeshDispatchGuardOptions`, `MeshDispatchRateLimiter`,
 * `MeshDispatchIdentity`, a logger) are resolved as OPTIONAL: absent registrations mean the handler
 * uses its defaults (per-target limiting still applies with the default limits; the audit record
 * says "(unattributed)"). `useMeshDispatchGuard` registers the shared instances alongside the HTTP
 * guard so both layers count and attribute against the same state.
 */
export function useMeshDispatch<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  options?: MeshDispatchOptions,
): IMiddlewarePipelineBuilder<TContext> {
  app.register((x) => {
    x.addSingletonInstance(MeshDispatchOptions, options ?? new MeshDispatchOptions());
    tryAddSingletonFactory(x, IMeshDispatchEnvironment, () => new EnvironmentVariableMeshDispatchEnvironment());
    x.addSingletonFactory(
      MeshDispatchGate,
      (r) => new MeshDispatchGate(r.getService(MeshDispatchOptions), r.getService(IMeshDispatchEnvironment)),
    );
    x.addSingletonFactory(IMeshServiceDispatcher, () => new HttpMeshServiceDispatcher());
    x.addSingletonInstance(
      IMessageHandlerDefinition,
      MessageHandlerDefinition.createInstance(
        DispatchTopic,
        '',
        MeshDispatchRequest,
        RawStringMessage,
        MeshDispatchMessageHandler,
      ),
    );
    x.addScopedFactory(
      MeshDispatchMessageHandler,
      (r) =>
        new MeshDispatchMessageHandler(
          r.getService(MeshDispatchGate),
          r.getService(MeshServiceRegistry),
          r.getServices(IMeshServiceDispatcher),
          r.tryGetService(MeshDispatchGuardOptions),
          r.tryGetService(MeshDispatchRateLimiter),
          r.tryGetService(MeshDispatchIdentity),
          r.tryGetService(ILoggerFactory)?.createLogger('MeshDispatchMessageHandler'),
        ),
    );
  });
  return app;
}

/**
 * Guards the HTTP endpoint that fronts the dispatch handler: CSRF header, fail-closed identity,
 * request-size bound, per-identity rate limit — see {@link MeshDispatchGuardMiddleware}. Port of
 * Benzene.Mesh.Artifacts' `UseMeshDispatchGuard` (kept in this package — the port has no
 * Mesh.Artifacts; see the middleware's placement note). Mount it on the HTTP pipeline ABOVE the
 * envelope endpoint, and mount the session gate that sets `MeshDispatchIdentity.email` above this.
 */
export function useMeshDispatchGuard<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  options?: MeshDispatchGuardOptions,
): IMiddlewarePipelineBuilder<TContext> {
  const guardOptions = options ?? new MeshDispatchGuardOptions();

  app.register((x) => {
    x.addSingletonInstance(MeshDispatchGuardOptions, guardOptions);
    // ONE limiter for the process: per-instance counters are the whole mechanism, so a per-scope
    // limiter would count to one and bound nothing.
    tryAddSingletonFactory(x, MeshDispatchRateLimiter, () => new MeshDispatchRateLimiter());
    // Scoped: it carries who is asking, for this request only.
    tryAddScopedFactory(x, MeshDispatchIdentity, () => new MeshDispatchIdentity());
  });

  return app.use(
    (resolver) =>
      new MeshDispatchGuardMiddleware<TContext>(
        guardOptions,
        resolver.getService(MeshDispatchIdentity),
        resolver.getService(MeshDispatchRateLimiter),
        resolver.getService(IHttpRequestAdapter) as IHttpRequestAdapter<TContext>,
        resolver.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<TContext>,
        resolver.tryGetService(IRouteFinder),
        resolver.tryGetService(ILoggerFactory)?.createLogger('MeshDispatchGuard'),
        resolver.tryGetService(IMessageBodyGetter) as IMessageBodyGetter<TContext> | undefined,
      ),
  );
}

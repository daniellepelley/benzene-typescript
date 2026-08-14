/** Port of Benzene.Mesh.Dispatch.Extensions. */
import { tryAddSingletonFactory } from '@benzenejs/abstractions';
import { IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { MessageHandlerDefinition } from '@benzenejs/core-message-handlers';
import { RawStringMessage } from '@benzenejs/core-messages';
import { MeshServiceRegistry } from '@benzenejs/mesh-contracts';
import { EnvironmentVariableMeshDispatchEnvironment, IMeshDispatchEnvironment } from './IMeshDispatchEnvironment';
import { HttpMeshServiceDispatcher } from './HttpMeshServiceDispatcher';
import { IMeshServiceDispatcher } from './IMeshServiceDispatcher';
import { MeshDispatchGate } from './MeshDispatchGate';
import { MeshDispatchMessageHandler } from './MeshDispatchMessageHandler';
import { MeshDispatchOptions } from './MeshDispatchOptions';
import { MeshDispatchRequest } from './MeshDispatchRequest';

/** The reserved-style topic the dispatch handler is served on. */
export const DispatchTopic = 'mesh:dispatch';

/**
 * Registers the opt-in `mesh:dispatch` handler, which invokes ONE registered service's real handler with a
 * caller-supplied payload. Opt-in by construction AND gated at runtime (refused in Production unless
 * `MeshDispatchOptions.allowInProduction` is set). C# extension method -> free function taking the builder.
 *
 * Requires a `MeshServiceRegistry` registered in the same container, and at least one
 * `IMeshServiceDispatcher` for the transports in use (the HTTP dispatcher is registered here).
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
        ),
    );
  });
  return app;
}

/** Port of Benzene.Mesh.Reporting.Extensions. */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { IMeshReportPublisher } from '@benzenejs/mesh-contracts';
import { HttpMeshReportPublisher } from './HttpMeshReportPublisher';
import { MeshReportingOptions } from './MeshReportingOptions';
import { MeshSelfReportMiddleware } from './MeshSelfReportMiddleware';
import { MeshSelfReportOptions } from './MeshSelfReportOptions';
import { MeshSelfReportState } from './MeshSelfReportState';

/**
 * Registers `HttpMeshReportPublisher` (as `IMeshReportPublisher`) against the given options - for a reporting
 * service that isn't colocated with the aggregator's own storage. C# extension method -> free function.
 */
export function addMeshHttpReporting(
  services: IBenzeneServiceContainer,
  options: MeshReportingOptions,
): IBenzeneServiceContainer {
  services.addSingletonInstance(MeshReportingOptions, options);
  services.addSingletonFactory(
    IMeshReportPublisher,
    (resolver) => new HttpMeshReportPublisher(resolver.getService(MeshReportingOptions)),
  );
  return services;
}

/**
 * Registers `MeshSelfReportOptions` and the singleton `MeshSelfReportState` the self-report middleware needs.
 * Requires an `IMeshReportPublisher` already registered (via {@link addMeshHttpReporting} or the aggregator).
 */
export function addMeshSelfReport(
  services: IBenzeneServiceContainer,
  options: MeshSelfReportOptions,
): IBenzeneServiceContainer {
  services.addSingletonInstance(MeshSelfReportOptions, options);
  services.addSingletonFactory(MeshSelfReportState, () => new MeshSelfReportState());
  return services;
}

/**
 * Adds `MeshSelfReportMiddleware` to the pipeline. Requires {@link addMeshSelfReport} (and an
 * `IMeshReportPublisher` registration) already called on the same container.
 */
export function useMeshSelfReport<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
): IMiddlewarePipelineBuilder<TContext> {
  return app.use(
    (resolver) =>
      new MeshSelfReportMiddleware<TContext>(
        resolver.getService(IMeshReportPublisher),
        resolver.getService(MeshSelfReportOptions),
        resolver.getService(MeshSelfReportState),
      ),
  );
}

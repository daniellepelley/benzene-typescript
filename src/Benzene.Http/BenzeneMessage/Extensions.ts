/** Port of Benzene.Http.BenzeneMessage.Extensions (the UseBenzeneMessage HTTP-endpoint extensions). */
import { IServiceResolverFactory, tryAddScoped } from '@benzene/abstractions';
import {
  IMiddlewarePipeline,
  IMiddlewarePipelineBuilder,
  PipelineBuilderAction,
} from '@benzene/abstractions-middleware';
import { addBenzeneMessage } from '@benzene/core-message-handlers';
import { BenzeneMessageContext } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { DefaultHttpStatusCodeMapper } from '../DefaultHttpStatusCodeMapper';
import { IHttpContext } from '../IHttpContext';
import { IHttpRequestAdapter } from '../IHttpRequestAdapter';
import { IHttpStatusCodeMapper } from '../IHttpStatusCodeMapper';
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { IBenzeneResponseAdapter } from '@benzene/abstractions-message-handlers';
import { BenzeneMessageHttpMiddleware } from './BenzeneMessageHttpMiddleware';
import { BenzeneMessageHttpOptions } from './BenzeneMessageHttpOptions';
import {
  BenzeneMessageHttpEndpointInfo,
  IBenzeneMessageHttpEndpointInfo,
} from './IBenzeneMessageHttpEndpointInfo';

/**
 * The inner BenzeneMessage pipeline may be supplied as a configure `action` (built here) or as an
 * already-configured `IMiddlewarePipelineBuilder` (shared across adapters, built once). Both map to
 * the C# overloads' `Action<...>` / pre-built-builder shapes.
 */
export type BenzeneMessagePipelineSource =
  | PipelineBuilderAction<BenzeneMessageContext>
  | IMiddlewarePipelineBuilder<BenzeneMessageContext>;

/**
 * Adds a BenzeneMessage-over-HTTP endpoint to a Benzene HTTP pipeline — the HTTP equivalent of the
 * direct AWS Lambda invoke path, with the same name and overload shapes as C# `UseBenzeneMessage`. On
 * a POST to the configured path it dispatches the `{ topic, headers, body }` envelope into the inner
 * BenzeneMessage pipeline and writes the `{ statusCode, headers, body }` response; any other request
 * falls through.
 *
 * The C# four overloads collapse into one free function (the porting convention for extension methods):
 * the first extra argument is either the options (a {@link BenzeneMessageHttpOptions}, three-argument
 * form) or the pipeline source itself (two-argument form, default options). The pipeline source is
 * either a configure `action` (a function) or a pre-built `IMiddlewarePipelineBuilder` (an object) —
 * distinguished at runtime by `typeof`.
 *
 * Divergence from C#: for the `action` form the inner BenzeneMessage pipeline is built over its OWN DI
 * container (a fresh {@link DefaultBenzeneServiceContainer}) and dispatched through that container's
 * factory. C# lets both pipelines share one container because `IMessageGetter<TContext>` etc. are keyed
 * by the closed generic; TypeScript erases the generic to a single token, so an inner `BenzeneMessage`
 * pipeline sharing the outer HTTP transport's container would resolve the outer transport's context
 * getters. Giving the endpoint its own container is the port's "one container per entry point" rule
 * applied to nesting. (The pre-built-builder form runs the supplied builder as-is and dispatches through
 * the outer scope's factory, so share its container only with a compatible context.)
 *
 * Security: the endpoint exposes every topic the inner pipeline routes — including topics with no HTTP
 * mapping — so it is opt-in. Restrict topics via {@link BenzeneMessageHttpOptions.topicFilter} and place
 * authentication middleware in front of it; do not expose it unauthenticated in production. Registering
 * it also registers an {@link IBenzeneMessageHttpEndpointInfo}, which the `benzene` spec builder uses to
 * advertise the endpoint as the top-level `messageEndpoint` field.
 */
export function useBenzeneMessage<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  options: BenzeneMessageHttpOptions,
  source: BenzeneMessagePipelineSource,
): IMiddlewarePipelineBuilder<TContext>;
export function useBenzeneMessage<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  source: BenzeneMessagePipelineSource,
): IMiddlewarePipelineBuilder<TContext>;
export function useBenzeneMessage<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  optionsOrSource: BenzeneMessageHttpOptions | BenzeneMessagePipelineSource,
  maybeSource?: BenzeneMessagePipelineSource,
): IMiddlewarePipelineBuilder<TContext> {
  const options =
    maybeSource === undefined ? new BenzeneMessageHttpOptions() : (optionsOrSource as BenzeneMessageHttpOptions);
  const source = (maybeSource ?? optionsOrSource) as BenzeneMessagePipelineSource;

  let pipeline: IMiddlewarePipeline<BenzeneMessageContext>;
  // The endpoint's own container isolates the inner pipeline's context services (see the divergence
  // note above); undefined for the pre-built-builder form, which runs as-is on the outer scope.
  let innerFactory: IServiceResolverFactory | undefined;
  if (typeof source === 'function') {
    const innerContainer = new DefaultBenzeneServiceContainer();
    const innerBuilder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(innerContainer);
    // The endpoint's own container carries the BenzeneMessage transport services (C# `AddBenzeneMessage`).
    innerBuilder.register((x) => addBenzeneMessage(x));
    source(innerBuilder);
    pipeline = innerBuilder.build();
    innerFactory = innerContainer.createServiceResolverFactory();
  } else {
    pipeline = source.build();
  }

  app.register((x) => {
    tryAddScoped(x, IHttpStatusCodeMapper, DefaultHttpStatusCodeMapper);
    x.addSingletonFactory(
      IBenzeneMessageHttpEndpointInfo,
      () => new BenzeneMessageHttpEndpointInfo(options.path),
    );
  });

  return app.use(
    (resolver) =>
      new BenzeneMessageHttpMiddleware<TContext>(
        options,
        pipeline,
        innerFactory ?? resolver.getService(IServiceResolverFactory),
        resolver.getService(IHttpRequestAdapter) as unknown as IHttpRequestAdapter<TContext>,
        resolver.getService(IMessageBodyGetter) as unknown as IMessageBodyGetter<TContext>,
        resolver.getService(IBenzeneResponseAdapter) as unknown as IBenzeneResponseAdapter<TContext>,
        resolver.getService(IHttpStatusCodeMapper),
      ),
  );
}

/** Port of Benzene.Http.BenzeneMessage.Extensions (the UseBenzeneMessage HTTP-endpoint extensions). */
import { tryAddScoped } from '@benzenejs/abstractions';
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { addBenzeneMessage } from '@benzenejs/core-message-handlers';
import { BenzeneMessageContext } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { DefaultHttpStatusCodeMapper } from '../DefaultHttpStatusCodeMapper';
import { IHttpContext } from '../IHttpContext';
import { IHttpRequestAdapter } from '../IHttpRequestAdapter';
import { IHttpStatusCodeMapper } from '../IHttpStatusCodeMapper';
import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { IBenzeneResponseAdapter } from '@benzenejs/abstractions-message-handlers';
import { BenzeneMessageHttpMiddleware } from './BenzeneMessageHttpMiddleware';
import { BenzeneMessageHttpOptions } from './BenzeneMessageHttpOptions';
import {
  BenzeneMessageHttpEndpointInfo,
  IBenzeneMessageHttpEndpointInfo,
} from './IBenzeneMessageHttpEndpointInfo';

/**
 * Adds a BenzeneMessage-over-HTTP endpoint to a Benzene HTTP pipeline — the HTTP equivalent of the
 * direct AWS Lambda invoke path. On a POST to the configured path it dispatches the
 * `{ topic, headers, body }` envelope into the inner BenzeneMessage pipeline and writes the
 * `{ statusCode, headers, body }` response; any other request falls through.
 *
 * The inner pipeline is configured inline via `action`, exactly as `useServiceBus` / `useKafka` etc.
 * configure their inner pipelines. C#'s options+action / bare-action overloads collapse into one free
 * function: the first extra argument is either the options (a {@link BenzeneMessageHttpOptions},
 * three-argument form) or the `action` itself (two-argument form, default options).
 *
 * Divergence from C#: the inner BenzeneMessage pipeline is built over its OWN DI container (a fresh
 * {@link DefaultBenzeneServiceContainer}) and dispatched through that container's factory. C# lets the
 * inner and outer pipelines share one container because `IMessageGetter<TContext>` etc. are keyed by
 * the closed generic; TypeScript erases the generic to a single token (last-registered-wins), so an
 * inner pipeline sharing the outer HTTP transport's container would resolve the outer transport's
 * context getters. Giving the endpoint its own container is the port's "one container per entry point"
 * rule applied to nesting. For the same reason, **only the `action` form is ported** — C#'s
 * pre-built-`IMiddlewarePipelineBuilder` overloads (which share one BenzeneMessage pipeline across the
 * Lambda-direct path and this endpoint) cannot be dispatched through the outer HTTP container under
 * erasure, so they are deliberately dropped rather than shipped silently wrong.
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
  action: PipelineBuilderAction<BenzeneMessageContext>,
): IMiddlewarePipelineBuilder<TContext>;
export function useBenzeneMessage<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  action: PipelineBuilderAction<BenzeneMessageContext>,
): IMiddlewarePipelineBuilder<TContext>;
export function useBenzeneMessage<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  optionsOrAction: BenzeneMessageHttpOptions | PipelineBuilderAction<BenzeneMessageContext>,
  maybeAction?: PipelineBuilderAction<BenzeneMessageContext>,
): IMiddlewarePipelineBuilder<TContext> {
  const options =
    maybeAction === undefined ? new BenzeneMessageHttpOptions() : (optionsOrAction as BenzeneMessageHttpOptions);
  const action = (maybeAction ?? optionsOrAction) as PipelineBuilderAction<BenzeneMessageContext>;

  // The endpoint's own container isolates the inner pipeline's context services (see the divergence note
  // above): it carries the BenzeneMessage transport services (C# `AddBenzeneMessage`) and nothing from the
  // outer HTTP transport, so the inner getters can't be shadowed by the outer transport's under one token.
  const innerContainer = new DefaultBenzeneServiceContainer();
  const innerBuilder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(innerContainer);
  innerBuilder.register((x) => addBenzeneMessage(x));
  action(innerBuilder);
  const pipeline = innerBuilder.build();
  const innerFactory = innerContainer.createServiceResolverFactory();

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
        innerFactory,
        resolver.getService(IHttpRequestAdapter) as unknown as IHttpRequestAdapter<TContext>,
        resolver.getService(IMessageBodyGetter) as unknown as IMessageBodyGetter<TContext>,
        resolver.getService(IBenzeneResponseAdapter) as unknown as IBenzeneResponseAdapter<TContext>,
        resolver.getService(IHttpStatusCodeMapper),
      ),
  );
}

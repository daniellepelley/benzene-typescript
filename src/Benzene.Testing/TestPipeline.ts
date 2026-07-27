/**
 * `testPipeline(...)` — the focused single-transport test harness. It encapsulates the container +
 * `addBenzene` + builder + application + resolver-factory construction a direct middleware/transport test
 * used to write out by hand (the memorised six-step order), so a test reads:
 *
 * ```ts
 * const result = await testPipeline(apiGatewayV2Transport)
 *   .use(spec())
 *   .send(asApiGatewayV2Request(httpBuilder('GET', '/spec')));
 * ```
 *
 * The neutral core stays cloud-import-free: a {@link TransportDescriptor} supplies the transport's
 * `addServices` (its `addApiGateway`/… DI) and `createApplication` (its `Application` class), and lives in
 * the per-platform testing package (`@benzene/aws-lambda-testing`), not here.
 */
import { IBenzeneServiceContainer, IServiceResolverFactory } from '@benzene/abstractions';
import {
  Capability,
  IMiddleware,
  IMiddlewarePipeline,
  IMiddlewarePipelineBuilder,
  MiddlewareFactoryFunc,
} from '@benzene/abstractions-middleware';
import { addBenzene } from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/** Describes how to run a built pipeline for one transport: its DI registration and its application. */
export interface TransportDescriptor<TContext, TEvent, TResult> {
  /** Registers the transport's services (e.g. `addApiGatewayV2`). Runs after `addBenzene`. */
  addServices(container: IBenzeneServiceContainer): void;
  /** Wraps the built pipeline in the transport's application (e.g. `p => new ApiGatewayV2Application(p)`). */
  createApplication(pipeline: IMiddlewarePipeline<TContext>): {
    handleAsync(event: TEvent, serviceResolverFactory: IServiceResolverFactory): Promise<TResult>;
  };
}

/** The fluent harness returned by {@link testPipeline}. */
export interface TestPipeline<TContext, TEvent, TResult> {
  /** Registers extra services (mocks/fakes) on the container, after `addBenzene` + the transport's. */
  withServices(action: (container: IBenzeneServiceContainer) => void): TestPipeline<TContext, TEvent, TResult>;
  /** Adds a middleware, factory, or {@link Capability} to the pipeline (`.use(spec())`). */
  use(
    middleware: MiddlewareFactoryFunc<TContext> | IMiddleware<TContext> | Capability<TContext>,
  ): TestPipeline<TContext, TEvent, TResult>;
  /**
   * Runs a builder action against the pipeline builder — for wiring that takes the builder first, e.g.
   * `.configure((b) => useMessageHandlers(b, Handler))`.
   */
  configure(
    action: (builder: IMiddlewarePipelineBuilder<TContext>) => void,
  ): TestPipeline<TContext, TEvent, TResult>;
  /** Builds the pipeline + application and runs `event` through it, returning the transport's result. */
  send(event: TEvent): Promise<TResult>;
}

/** Starts a {@link TestPipeline} for the given transport. */
export function testPipeline<TContext, TEvent, TResult>(
  transport: TransportDescriptor<TContext, TEvent, TResult>,
): TestPipeline<TContext, TEvent, TResult> {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  transport.addServices(container);
  const builder = new MiddlewarePipelineBuilder<TContext>(container);

  const harness: TestPipeline<TContext, TEvent, TResult> = {
    withServices(action) {
      action(container);
      return harness;
    },
    use(middleware) {
      builder.use(middleware);
      return harness;
    },
    configure(action) {
      action(builder);
      return harness;
    },
    async send(event) {
      const application = transport.createApplication(builder.build());
      return application.handleAsync(event, container.createServiceResolverFactory());
    },
  };
  return harness;
}

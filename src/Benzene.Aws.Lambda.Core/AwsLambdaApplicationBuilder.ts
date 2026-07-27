import {
  IBenzeneServiceContainer,
  ILogContextBuilder,
  IServiceResolver,
  ServiceIdentifier,
} from '@benzene/abstractions';
import {
  IBenzeneApplicationBuilder,
  IContextConverter,
  IContextPredicate,
  IMiddleware,
  IMiddlewarePipeline,
  IMiddlewarePipelineBuilder,
  MiddlewareFactoryFunc,
  MiddlewareFunc,
  PipelineBuilderAction,
} from '@benzene/abstractions-middleware';
import { BenzeneApplicationBuilder } from '@benzene/core-middleware';
import { AwsEventStreamContext } from './AwsEventStream/AwsEventStreamContext';

type EventPipeline = IMiddlewarePipelineBuilder<AwsEventStreamContext>;

/**
 * Port of Benzene.Aws.Lambda.Core.AwsLambdaApplicationBuilder.
 *
 * AWS Lambda-specific application builder: a `BenzeneApplicationBuilder` that also carries the AWS event
 * stream pipeline builder. It is what a non-generic `BenzeneStartUp.configure(app)` receives, and
 * `useAwsLambda(app, aws => …)` unwraps `app.eventPipeline` as `aws`.
 *
 * TRANSITION SCAFFOLD: during the test-host unification it *also* implements
 * `IMiddlewarePipelineBuilder<AwsEventStreamContext>` by delegating every pipeline member to
 * `eventPipeline`. That lets one object satisfy BOTH a legacy startup (`configure(app)` calling
 * `useApiGateway(app, …)` on the raw pipeline) and a new startup (`useAwsLambda(app, aws => …)`), so the
 * `buildAwsLambdaHost` flip lands green before any startup is migrated. These delegating members are
 * removed once every AWS startup uses `useAwsLambda`.
 */
export class AwsLambdaApplicationBuilder extends BenzeneApplicationBuilder implements EventPipeline {
  /** The platform name identifier for AWS Lambda. */
  static readonly platformName = 'AwsLambda';

  /**
   * @param eventPipeline The AWS event stream middleware pipeline builder.
   * @param benzeneServiceContainer The Benzene service container.
   */
  constructor(
    public readonly eventPipeline: EventPipeline,
    benzeneServiceContainer: IBenzeneServiceContainer,
  ) {
    super(AwsLambdaApplicationBuilder.platformName, benzeneServiceContainer);
  }

  // --- transition scaffold: delegate the IMiddlewarePipelineBuilder surface to eventPipeline ----------
  use(arg: MiddlewareFactoryFunc<AwsEventStreamContext> | IMiddleware<AwsEventStreamContext>): EventPipeline {
    return this.eventPipeline.use(arg as MiddlewareFactoryFunc<AwsEventStreamContext>);
  }
  useFn(nameOrFunc: string | MiddlewareFunc<AwsEventStreamContext>, func?: MiddlewareFunc<AwsEventStreamContext>): EventPipeline {
    return func === undefined
      ? this.eventPipeline.useFn(nameOrFunc as MiddlewareFunc<AwsEventStreamContext>)
      : this.eventPipeline.useFn(nameOrFunc as string, func);
  }
  useService(identifier: ServiceIdentifier<IMiddleware<AwsEventStreamContext>>): EventPipeline {
    return this.eventPipeline.useService(identifier);
  }
  onRequest(
    nameOrAction: string | ((context: AwsEventStreamContext, resolver: IServiceResolver) => void),
    action?: (context: AwsEventStreamContext, resolver: IServiceResolver) => void,
  ): EventPipeline {
    return action === undefined
      ? this.eventPipeline.onRequest(nameOrAction as (c: AwsEventStreamContext, r: IServiceResolver) => void)
      : this.eventPipeline.onRequest(nameOrAction as string, action);
  }
  onResponse(
    nameOrAction: string | ((context: AwsEventStreamContext, resolver: IServiceResolver) => void),
    action?: (context: AwsEventStreamContext, resolver: IServiceResolver) => void,
  ): EventPipeline {
    return action === undefined
      ? this.eventPipeline.onResponse(nameOrAction as (c: AwsEventStreamContext, r: IServiceResolver) => void)
      : this.eventPipeline.onResponse(nameOrAction as string, action);
  }
  useExceptionHandler(onException: (context: AwsEventStreamContext, error: unknown) => void): EventPipeline {
    return this.eventPipeline.useExceptionHandler(onException);
  }
  split(
    check: ((context: AwsEventStreamContext) => boolean) | IContextPredicate<AwsEventStreamContext>,
    builder: PipelineBuilderAction<AwsEventStreamContext>,
  ): EventPipeline {
    return this.eventPipeline.split(check, builder);
  }
  convert<TContextOut>(
    ...args: [IContextConverter<AwsEventStreamContext, TContextOut> | ((context: AwsEventStreamContext) => TContextOut), ...unknown[]]
  ): EventPipeline {
    return (this.eventPipeline.convert as (...a: unknown[]) => EventPipeline)(...args);
  }
  useLogResult(action: (builder: ILogContextBuilder<AwsEventStreamContext>) => void): EventPipeline {
    return this.eventPipeline.useLogResult(action);
  }
  useLogContext(action: (builder: ILogContextBuilder<AwsEventStreamContext>) => void): EventPipeline {
    return this.eventPipeline.useLogContext(action);
  }
  create<TNewContext>(): IMiddlewarePipelineBuilder<TNewContext> {
    return this.eventPipeline.create<TNewContext>();
  }
  build(): IMiddlewarePipeline<AwsEventStreamContext> {
    return this.eventPipeline.build();
  }
}

/**
 * Port of Benzene.Aws.Lambda.Core.AwsLambdaApplicationBuilderExtensions.UseAwsLambda.
 *
 * Applies AWS Lambda-specific configuration to a platform-neutral `IBenzeneApplicationBuilder`. No-op on
 * other platforms (the C# extension-method → free-function convention; `app is AwsLambdaApplicationBuilder`
 * → `instanceof`).
 */
export function useAwsLambda(
  app: IBenzeneApplicationBuilder,
  configure: (eventPipeline: IMiddlewarePipelineBuilder<AwsEventStreamContext>) => void,
): IBenzeneApplicationBuilder {
  if (app instanceof AwsLambdaApplicationBuilder) {
    configure(app.eventPipeline);
  }
  return app;
}

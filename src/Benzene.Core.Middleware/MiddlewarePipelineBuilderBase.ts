import {
  IBenzeneServiceContainer,
  ILogContextBuilder,
  ILoggerFactory,
  IServiceResolver,
  NullLogger,
  ServiceIdentifier,
} from '@benzene/abstractions';
import { LogContextBuilder } from '@benzene/core';
import {
  IContextConverter,
  IContextPredicate,
  IMiddleware,
  IMiddlewarePipeline,
  IMiddlewarePipelineBuilder,
  MiddlewareFactoryFunc,
  MiddlewareFunc,
  PipelineBuilderAction,
} from '@benzene/abstractions-middleware';
import { ContextConverterMiddleware } from './ContextConverterMiddleware';
import { ExceptionHandlerMiddleware } from './ExceptionHandlerMiddleware';
import { FuncWrapperMiddleware } from './FuncWrapperMiddleware';
import { InlineContextConverter } from './InlineContextConverter';

const loggerCategory = 'Benzene';

/**
 * Implements the fluent pipeline-builder helpers in terms of the core `use`,
 * `create`, `build` and `register` members, so every builder implementation
 * inherits them.
 *
 * Port of the C# extension methods in Benzene.Core.Middleware.Extensions and
 * Benzene.Core.Middleware.LoggerExtensions (TypeScript has no extension methods,
 * so they become base-class members).
 */
export abstract class MiddlewarePipelineBuilderBase<TContext>
  implements IMiddlewarePipelineBuilder<TContext>
{
  abstract use(
    funcOrMiddleware: MiddlewareFactoryFunc<TContext> | IMiddleware<TContext>,
  ): IMiddlewarePipelineBuilder<TContext>;

  abstract create<TNewContext>(): IMiddlewarePipelineBuilder<TNewContext>;

  abstract build(): IMiddlewarePipeline<TContext>;

  abstract register(action: (container: IBenzeneServiceContainer) => void): void;

  useFn(func: MiddlewareFunc<TContext>): IMiddlewarePipelineBuilder<TContext>;
  useFn(name: string, func: MiddlewareFunc<TContext>): IMiddlewarePipelineBuilder<TContext>;
  useFn(
    nameOrFunc: string | MiddlewareFunc<TContext>,
    func?: MiddlewareFunc<TContext>,
  ): IMiddlewarePipelineBuilder<TContext> {
    const name = typeof nameOrFunc === 'string' ? nameOrFunc : '';
    const fn = typeof nameOrFunc === 'function' ? nameOrFunc : func!;

    return this.use((serviceResolver) =>
      new FuncWrapperMiddleware<TContext>(name, async (context, next) => {
        await fn(context, next, serviceResolver);
      }),
    );
  }

  useService(
    identifier: ServiceIdentifier<IMiddleware<TContext>>,
  ): IMiddlewarePipelineBuilder<TContext> {
    return this.use((serviceResolver) => serviceResolver.getService(identifier));
  }

  onRequest(action: (context: TContext, serviceResolver: IServiceResolver) => void): IMiddlewarePipelineBuilder<TContext>;
  onRequest(name: string, action: (context: TContext, serviceResolver: IServiceResolver) => void): IMiddlewarePipelineBuilder<TContext>;
  onRequest(
    nameOrAction: string | ((context: TContext, serviceResolver: IServiceResolver) => void),
    action?: (context: TContext, serviceResolver: IServiceResolver) => void,
  ): IMiddlewarePipelineBuilder<TContext> {
    const name = typeof nameOrAction === 'string' ? nameOrAction : '';
    const fn = typeof nameOrAction === 'function' ? nameOrAction : action!;

    return this.useFn(name, async (context, next, serviceResolver) => {
      fn(context, serviceResolver);
      await next();
    });
  }

  onResponse(action: (context: TContext, serviceResolver: IServiceResolver) => void): IMiddlewarePipelineBuilder<TContext>;
  onResponse(name: string, action: (context: TContext, serviceResolver: IServiceResolver) => void): IMiddlewarePipelineBuilder<TContext>;
  onResponse(
    nameOrAction: string | ((context: TContext, serviceResolver: IServiceResolver) => void),
    action?: (context: TContext, serviceResolver: IServiceResolver) => void,
  ): IMiddlewarePipelineBuilder<TContext> {
    const name = typeof nameOrAction === 'string' ? nameOrAction : '';
    const fn = typeof nameOrAction === 'function' ? nameOrAction : action!;

    return this.useFn(name, async (context, next, serviceResolver) => {
      await next();
      fn(context, serviceResolver);
    });
  }

  useExceptionHandler(
    onException: (context: TContext, error: unknown) => void,
  ): IMiddlewarePipelineBuilder<TContext> {
    return this.use((serviceResolver) =>
      new ExceptionHandlerMiddleware<TContext>(
        onException,
        serviceResolver.tryGetService(ILoggerFactory)?.createLogger(loggerCategory) ??
          NullLogger.instance,
      ),
    );
  }

  split(
    check: ((context: TContext) => boolean) | IContextPredicate<TContext>,
    builder: PipelineBuilderAction<TContext>,
  ): IMiddlewarePipelineBuilder<TContext> {
    const newApp = this.create<TContext>();
    builder(newApp);

    return this.use((serviceResolver) =>
      new FuncWrapperMiddleware<TContext>('Split', async (context, next) => {
        const matches =
          typeof check === 'function' ? check(context) : check.check(context, serviceResolver);

        if (matches) {
          await newApp.build().handleAsync(context, serviceResolver);
        } else {
          await next();
        }
      }),
    );
  }

  convert<TContextOut>(
    converter: IContextConverter<TContext, TContextOut>,
    pipeline: IMiddlewarePipeline<TContextOut> | PipelineBuilderAction<TContextOut>,
  ): IMiddlewarePipelineBuilder<TContext>;
  convert<TContextOut>(
    createContextFunc: (context: TContext) => TContextOut,
    mapContext: (context: TContext, contextOut: TContextOut) => void,
    pipeline: IMiddlewarePipeline<TContextOut> | PipelineBuilderAction<TContextOut>,
  ): IMiddlewarePipelineBuilder<TContext>;
  convert<TContextOut>(
    converterOrCreate:
      | IContextConverter<TContext, TContextOut>
      | ((context: TContext) => TContextOut),
    pipelineOrMap:
      | IMiddlewarePipeline<TContextOut>
      | PipelineBuilderAction<TContextOut>
      | ((context: TContext, contextOut: TContextOut) => void),
    pipelineArg?: IMiddlewarePipeline<TContextOut> | PipelineBuilderAction<TContextOut>,
  ): IMiddlewarePipelineBuilder<TContext> {
    const converter: IContextConverter<TContext, TContextOut> =
      typeof converterOrCreate === 'function'
        ? new InlineContextConverter<TContext, TContextOut>(
            converterOrCreate,
            pipelineOrMap as (context: TContext, contextOut: TContextOut) => void,
          )
        : converterOrCreate;

    const pipelineOrAction = (
      typeof converterOrCreate === 'function' ? pipelineArg : pipelineOrMap
    ) as IMiddlewarePipeline<TContextOut> | PipelineBuilderAction<TContextOut>;

    let middlewarePipeline: IMiddlewarePipeline<TContextOut>;
    if (typeof pipelineOrAction === 'function') {
      const innerBuilder = this.create<TContextOut>();
      pipelineOrAction(innerBuilder);
      middlewarePipeline = innerBuilder.build();
    } else {
      middlewarePipeline = pipelineOrAction;
    }

    return this.use((serviceResolver) =>
      new ContextConverterMiddleware<TContext, TContextOut>(
        converter,
        middlewarePipeline,
        serviceResolver,
      ),
    );
  }

  useLogResult(
    action: (builder: ILogContextBuilder<TContext>) => void,
  ): IMiddlewarePipelineBuilder<TContext> {
    const builder: ILogContextBuilder<TContext> = new LogContextBuilder<TContext>(this);
    action(builder);

    return this.useFn('LogResult', async (context, next, serviceResolver) => {
      const logger = serviceResolver.getService(ILoggerFactory).createLogger(loggerCategory);
      const start = Date.now();
      const requestScope = logger.beginScope(builder.buildRequestScope(serviceResolver, context));
      try {
        await next();

        const responseScope = logger.beginScope(
          builder.buildResponseScope(serviceResolver, context),
        );
        try {
          const processTimeScope = logger.beginScope({ processTime: Date.now() - start });
          try {
            logger.logInformation('BenzeneResult');
          } finally {
            processTimeScope.dispose();
          }
        } finally {
          responseScope.dispose();
        }
      } finally {
        requestScope.dispose();
      }
    });
  }

  useLogContext(
    action: (builder: ILogContextBuilder<TContext>) => void,
  ): IMiddlewarePipelineBuilder<TContext> {
    const builder: ILogContextBuilder<TContext> = new LogContextBuilder<TContext>(this);
    action(builder);

    return this.useFn('LogContext', async (context, next, serviceResolver) => {
      const logger = serviceResolver.getService(ILoggerFactory).createLogger(loggerCategory);
      const scope = logger.beginScope(builder.buildRequestScope(serviceResolver, context));
      try {
        await next();
      } finally {
        scope.dispose();
      }
    });
  }
}

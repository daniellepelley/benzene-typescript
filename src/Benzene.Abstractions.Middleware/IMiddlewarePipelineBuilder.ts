import {
  ILogContextBuilder,
  IRegisterDependency,
  IServiceResolver,
  ServiceIdentifier,
} from '@benzene/abstractions';
import { IMiddleware, MiddlewareFunc } from './IMiddleware';
import { IMiddlewarePipeline } from './IMiddlewarePipeline';
import { IContextConverter } from './IContextConverter';
import { IContextPredicate } from './IContextPredicate';

/** Port of C# `Func<IServiceResolver, IMiddleware<TContext>>`. */
export type MiddlewareFactoryFunc<TContext> = (
  serviceResolver: IServiceResolver,
) => IMiddleware<TContext>;

/** Configures a nested pipeline builder. Port of C# `Action<IMiddlewarePipelineBuilder<TContext>>`. */
export type PipelineBuilderAction<TContext> = (
  builder: IMiddlewarePipelineBuilder<TContext>,
) => void;

/**
 * Fluent builder for constructing middleware pipelines. Middleware execute in
 * registration order; once built, the pipeline is immutable.
 * Port of Benzene.Abstractions.Middleware.IMiddlewarePipelineBuilder&lt;TContext&gt;.
 *
 * TypeScript has no extension methods, so the fluent helpers C# defines in
 * `Benzene.Core.Middleware.Extensions` (`Use`, `OnRequest`, `OnResponse`, `Split`,
 * `Convert`, `UseExceptionHandler`, ...) and `LoggerExtensions` (`UseLogResult`,
 * `UseLogContext`) are declared here as interface members instead;
 * `MiddlewarePipelineBuilderBase` in Benzene.Core.Middleware implements them in
 * terms of `use`, so custom builders inherit them the way C# implementations
 * pick up the extension methods. Where C# overloads on delegate type, the
 * TypeScript methods split by name (`use` vs `useFn`) because parameter types
 * are erased at runtime.
 */
export interface IMiddlewarePipelineBuilder<TContext> extends IRegisterDependency {
  /**
   * Adds a middleware component using a factory function (the C# interface member)
   * or an existing instance (the C# `Use(middleware)` extension method).
   */
  use(func: MiddlewareFactoryFunc<TContext>): IMiddlewarePipelineBuilder<TContext>;
  use(middleware: IMiddleware<TContext>): IMiddlewarePipelineBuilder<TContext>;

  /**
   * Adds an inline handler function, optionally named.
   * Port of the C# `Use(func)` / `Use(name, func)` extension-method family;
   * the resolver-taking C# overloads are covered by the handler's trailing
   * `serviceResolver` argument.
   */
  useFn(func: MiddlewareFunc<TContext>): IMiddlewarePipelineBuilder<TContext>;
  useFn(name: string, func: MiddlewareFunc<TContext>): IMiddlewarePipelineBuilder<TContext>;

  /**
   * Adds a middleware resolved from the container.
   * Port of C# `Use<TContext, TMiddleware>()`.
   */
  useService(identifier: ServiceIdentifier<IMiddleware<TContext>>): IMiddlewarePipelineBuilder<TContext>;

  /**
   * Runs an action before the rest of the pipeline, optionally named.
   * Port of the C# `OnRequest` extension-method family (argument order is
   * context-first in the TypeScript port).
   */
  onRequest(action: (context: TContext, serviceResolver: IServiceResolver) => void): IMiddlewarePipelineBuilder<TContext>;
  onRequest(name: string, action: (context: TContext, serviceResolver: IServiceResolver) => void): IMiddlewarePipelineBuilder<TContext>;

  /**
   * Runs an action after the rest of the pipeline completes, optionally named.
   * Port of the C# `OnResponse` extension-method family.
   */
  onResponse(action: (context: TContext, serviceResolver: IServiceResolver) => void): IMiddlewarePipelineBuilder<TContext>;
  onResponse(name: string, action: (context: TContext, serviceResolver: IServiceResolver) => void): IMiddlewarePipelineBuilder<TContext>;

  /**
   * Catches unhandled errors from the rest of the pipeline.
   * Port of C# `UseExceptionHandler(Action<TContext, Exception>)`.
   */
  useExceptionHandler(onException: (context: TContext, error: unknown) => void): IMiddlewarePipelineBuilder<TContext>;

  /**
   * Branches into a sub-pipeline when the check passes; otherwise continues.
   * Port of the C# `Split` extension methods.
   */
  split(
    check: ((context: TContext) => boolean) | IContextPredicate<TContext>,
    builder: PipelineBuilderAction<TContext>,
  ): IMiddlewarePipelineBuilder<TContext>;

  /**
   * Converts to a different context type and runs an inner pipeline against it,
   * mapping results back afterwards. Port of the C# `Convert` extension methods.
   */
  convert<TContextOut>(
    converter: IContextConverter<TContext, TContextOut>,
    pipeline: IMiddlewarePipeline<TContextOut> | PipelineBuilderAction<TContextOut>,
  ): IMiddlewarePipelineBuilder<TContext>;
  convert<TContextOut>(
    createContextFunc: (context: TContext) => TContextOut,
    mapContext: (context: TContext, contextOut: TContextOut) => void,
    pipeline: IMiddlewarePipeline<TContextOut> | PipelineBuilderAction<TContextOut>,
  ): IMiddlewarePipelineBuilder<TContext>;

  /**
   * Wraps the rest of the pipeline in request/response logging scopes and logs a
   * result entry with the processing time. Port of C# `UseLogResult`.
   */
  useLogResult(action: (builder: ILogContextBuilder<TContext>) => void): IMiddlewarePipelineBuilder<TContext>;

  /**
   * Wraps the rest of the pipeline in a request logging scope.
   * Port of C# `UseLogContext`.
   */
  useLogContext(action: (builder: ILogContextBuilder<TContext>) => void): IMiddlewarePipelineBuilder<TContext>;

  /** Creates a new pipeline builder for a different context type, sharing dependency registration. */
  create<TNewContext>(): IMiddlewarePipelineBuilder<TNewContext>;

  /** Builds the immutable middleware pipeline from the registered components. */
  build(): IMiddlewarePipeline<TContext>;
}

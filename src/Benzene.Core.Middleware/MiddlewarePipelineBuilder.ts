import {
  IBenzeneServiceContainer,
  IRegisterDependency,
} from '@benzene/abstractions';
import {
  IMiddleware,
  IMiddlewarePipeline,
  IMiddlewarePipelineBuilder,
  MiddlewareFactoryFunc,
} from '@benzene/abstractions-middleware';
import { addBenzeneMiddleware } from './DependencyExtensions';
import { MiddlewarePipeline } from './MiddlewarePipeline';
import { MiddlewarePipelineBuilderBase } from './MiddlewarePipelineBuilderBase';
import { RegisterDependency } from './RegisterDependency';

function isRegisterDependency(
  value: IBenzeneServiceContainer | IRegisterDependency,
): value is IRegisterDependency {
  return typeof (value as IRegisterDependency).register === 'function';
}

/**
 * The standard middleware pipeline builder.
 * Port of Benzene.Core.Middleware.MiddlewarePipelineBuilder&lt;TContext&gt;.
 * The two C# constructors (container / IRegisterDependency) become a single
 * constructor accepting either.
 */
export class MiddlewarePipelineBuilder<TContext> extends MiddlewarePipelineBuilderBase<TContext> {
  private readonly items: MiddlewareFactoryFunc<TContext>[] = [];
  private readonly registerDependency: IRegisterDependency;

  constructor(containerOrRegisterDependency: IBenzeneServiceContainer | IRegisterDependency) {
    super();
    this.registerDependency = isRegisterDependency(containerOrRegisterDependency)
      ? containerOrRegisterDependency
      : new RegisterDependency(containerOrRegisterDependency);
    this.registerDependency.register((container) => addBenzeneMiddleware(container));
  }

  use(
    funcOrMiddleware: MiddlewareFactoryFunc<TContext> | IMiddleware<TContext>,
  ): IMiddlewarePipelineBuilder<TContext> {
    this.items.push(
      typeof funcOrMiddleware === 'function' ? funcOrMiddleware : () => funcOrMiddleware,
    );
    return this;
  }

  register(action: (container: IBenzeneServiceContainer) => void): void {
    this.registerDependency.register(action);
  }

  /** Port of C# `GetItems()`. */
  getItems(): MiddlewareFactoryFunc<TContext>[] {
    return [...this.items];
  }

  create<TNewContext>(): IMiddlewarePipelineBuilder<TNewContext> {
    return new MiddlewarePipelineBuilder<TNewContext>(this.registerDependency);
  }

  build(): IMiddlewarePipeline<TContext> {
    return new MiddlewarePipeline<TContext>(this.getItems());
  }

  /** Port of C# `Clear()`. */
  clear(): MiddlewarePipelineBuilder<TContext> {
    this.items.length = 0;
    return this;
  }
}

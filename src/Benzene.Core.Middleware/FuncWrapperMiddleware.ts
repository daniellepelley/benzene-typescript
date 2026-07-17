import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { Constants } from './Constants';

/** The inline handler shape wrapped by FuncWrapperMiddleware. Port of C# `Func<TContext, Func<Task>, Task>`. */
export type WrappedMiddlewareFunc<TContext> = (
  context: TContext,
  next: NextFunc,
) => Promise<void> | void;

/**
 * Adapts an inline function into an IMiddleware.
 * Port of Benzene.Core.Middleware.FuncWrapperMiddleware&lt;TContext&gt;.
 */
export class FuncWrapperMiddleware<TContext> implements IMiddleware<TContext> {
  readonly name: string;
  private readonly func: WrappedMiddlewareFunc<TContext>;

  constructor(func: WrappedMiddlewareFunc<TContext>);
  constructor(name: string, func: WrappedMiddlewareFunc<TContext>);
  constructor(
    nameOrFunc: string | WrappedMiddlewareFunc<TContext>,
    func?: WrappedMiddlewareFunc<TContext>,
  ) {
    if (typeof nameOrFunc === 'string') {
      this.name = nameOrFunc !== '' ? nameOrFunc : Constants.unnamed;
      this.func = func!;
    } else {
      this.name = Constants.unnamed;
      this.func = nameOrFunc;
    }
  }

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    await this.func(context, next);
  }
}

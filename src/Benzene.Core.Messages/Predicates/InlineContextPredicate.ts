import { IServiceResolver } from '@benzene/abstractions';
import { IContextPredicate } from '@benzene/abstractions-middleware';

/**
 * An `IContextPredicate` backed by an inline function.
 * Port of Benzene.Core.Messages.Predicates.InlineContextPredicate&lt;TContext&gt;.
 */
export class InlineContextPredicate<TContext> implements IContextPredicate<TContext> {
  constructor(private readonly canHandle: (context: TContext, serviceResolver: IServiceResolver) => boolean) {}

  check(context: TContext, serviceResolver: IServiceResolver): boolean {
    return this.canHandle(context, serviceResolver);
  }
}

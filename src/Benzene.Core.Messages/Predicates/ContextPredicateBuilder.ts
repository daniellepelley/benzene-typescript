import { IContextPredicate } from '@benzene/abstractions-middleware';
import { HeaderContextPredicate } from './HeaderContextPredicate';
import { InlineContextPredicate } from './InlineContextPredicate';

/**
 * Fluent factory for the common `IContextPredicate` shapes used with pipeline `.split(...)`.
 * Port of Benzene.Core.Messages.Predicates.ContextPredicateBuilder&lt;TContext&gt;.
 */
export class ContextPredicateBuilder<TContext> {
  /** Port of C# `CheckHeader`. */
  checkHeader(headerKey: string, headerValue: string): IContextPredicate<TContext> {
    return new HeaderContextPredicate<TContext>(headerKey, headerValue);
  }

  /** Port of C# `Always`. */
  always(): IContextPredicate<TContext> {
    return new InlineContextPredicate<TContext>(() => true);
  }
}

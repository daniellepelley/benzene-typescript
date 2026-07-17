import { IServiceResolver, LogContextDictionaryFunc } from '@benzene/abstractions';

/**
 * Accumulates functions producing log-context dictionaries from the resolver and context.
 * Port of Benzene.Core.Logging.IContextDictionaryBuilder&lt;TContext&gt;.
 */
export interface IContextDictionaryBuilder<TContext> {
  with(dictionaryAction: LogContextDictionaryFunc<TContext>): IContextDictionaryBuilder<TContext>;

  build(serviceResolver: IServiceResolver, context: TContext): Record<string, string>;
}

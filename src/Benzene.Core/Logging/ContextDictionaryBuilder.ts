import { IServiceResolver, LogContextDictionaryFunc } from '@benzene/abstractions';
import { IContextDictionaryBuilder } from './IContextDictionaryBuilder';

/**
 * Port of Benzene.Core.Logging.ContextDictionaryBuilder&lt;TContext&gt;.
 * Empty values are filtered out of the built dictionary, matching the C# behavior.
 */
export class ContextDictionaryBuilder<TContext> implements IContextDictionaryBuilder<TContext> {
  private readonly list: LogContextDictionaryFunc<TContext>[] = [];

  with(dictionaryAction: LogContextDictionaryFunc<TContext>): IContextDictionaryBuilder<TContext> {
    this.list.push(dictionaryAction);
    return this;
  }

  build(serviceResolver: IServiceResolver, context: TContext): Record<string, string> {
    const output: Record<string, string> = {};

    for (const func of this.list) {
      for (const [key, value] of Object.entries(func(serviceResolver, context))) {
        if (value !== undefined && value !== null && value !== '') {
          output[key] = value;
        }
      }
    }

    return output;
  }
}

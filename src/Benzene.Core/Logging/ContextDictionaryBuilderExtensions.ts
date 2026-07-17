import { IServiceResolver, LogContextDictionaryFunc } from '@benzene/abstractions';
import { IContextDictionaryBuilder } from './IContextDictionaryBuilder';

/**
 * Convenience helpers for IContextDictionaryBuilder.
 * Port of Benzene.Core.Logging.ContextDictionaryBuilderExtensions (C# extension
 * methods become free functions). The C# overloads taking resolver-only callbacks
 * collapse into the function forms, since a JavaScript callback may simply ignore
 * trailing arguments.
 */
export function withEntry<TContext>(
  source: IContextDictionaryBuilder<TContext>,
  key: string,
  value: string | ((serviceResolver: IServiceResolver, context: TContext) => string),
): IContextDictionaryBuilder<TContext>;
export function withEntry<TContext>(
  source: IContextDictionaryBuilder<TContext>,
  dictionary: Record<string, string> | LogContextDictionaryFunc<TContext>,
): IContextDictionaryBuilder<TContext>;
export function withEntry<TContext>(
  source: IContextDictionaryBuilder<TContext>,
  keyOrDictionary: string | Record<string, string> | LogContextDictionaryFunc<TContext>,
  value?: string | ((serviceResolver: IServiceResolver, context: TContext) => string),
): IContextDictionaryBuilder<TContext> {
  if (typeof keyOrDictionary === 'string') {
    const key = keyOrDictionary;
    return source.with((resolver, context) => ({
      [key]: typeof value === 'function' ? value(resolver, context) : (value as string),
    }));
  }
  if (typeof keyOrDictionary === 'function') {
    return source.with(keyOrDictionary);
  }
  const dictionary = keyOrDictionary;
  return source.with(() => dictionary);
}

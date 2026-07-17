import { IServiceResolver } from '../DI/IServiceResolver';
import { ILogContextBuilder, LogContextDictionaryFunc } from './ILogContextBuilder';

/**
 * Convenience helpers for ILogContextBuilder.
 * Port of Benzene.Abstractions.Logging.LogContextBuilderExtensions (C# extension
 * methods become free functions).
 *
 * The C# overloads taking `Func<IServiceResolver, string>` and
 * `Func<IServiceResolver, TContext, string>` collapse into the function forms here:
 * a JavaScript callback may simply ignore trailing arguments.
 */

export function onRequest<TContext>(
  source: ILogContextBuilder<TContext>,
  key: string,
  value: string | ((serviceResolver: IServiceResolver, context: TContext) => string),
): ILogContextBuilder<TContext>;
export function onRequest<TContext>(
  source: ILogContextBuilder<TContext>,
  dictionary: Record<string, string> | LogContextDictionaryFunc<TContext>,
): ILogContextBuilder<TContext>;
export function onRequest<TContext>(
  source: ILogContextBuilder<TContext>,
  keyOrDictionary: string | Record<string, string> | LogContextDictionaryFunc<TContext>,
  value?: string | ((serviceResolver: IServiceResolver, context: TContext) => string),
): ILogContextBuilder<TContext> {
  return source.onRequest(toDictionaryFunc(keyOrDictionary, value));
}

export function onResponse<TContext>(
  source: ILogContextBuilder<TContext>,
  key: string,
  value: string | ((serviceResolver: IServiceResolver, context: TContext) => string),
): ILogContextBuilder<TContext>;
export function onResponse<TContext>(
  source: ILogContextBuilder<TContext>,
  dictionary: Record<string, string> | LogContextDictionaryFunc<TContext>,
): ILogContextBuilder<TContext>;
export function onResponse<TContext>(
  source: ILogContextBuilder<TContext>,
  keyOrDictionary: string | Record<string, string> | LogContextDictionaryFunc<TContext>,
  value?: string | ((serviceResolver: IServiceResolver, context: TContext) => string),
): ILogContextBuilder<TContext> {
  return source.onResponse(toDictionaryFunc(keyOrDictionary, value));
}

function toDictionaryFunc<TContext>(
  keyOrDictionary: string | Record<string, string> | LogContextDictionaryFunc<TContext>,
  value?: string | ((serviceResolver: IServiceResolver, context: TContext) => string),
): LogContextDictionaryFunc<TContext> {
  if (typeof keyOrDictionary === 'string') {
    const key = keyOrDictionary;
    return (resolver, context) => ({
      [key]: typeof value === 'function' ? value(resolver, context) : (value as string),
    });
  }
  if (typeof keyOrDictionary === 'function') {
    return keyOrDictionary;
  }
  const dictionary = keyOrDictionary;
  return () => dictionary;
}

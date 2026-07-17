import { IRegisterDependency } from '../DI/IRegisterDependency';
import { IServiceResolver } from '../DI/IServiceResolver';

/**
 * A function producing structured log-context entries from the resolver and context.
 * Port of C# `Func<IServiceResolver, TContext, IDictionary<string, string>>`
 * (C# `IDictionary<string, string>` maps to `Record<string, string>`).
 */
export type LogContextDictionaryFunc<TContext> = (
  serviceResolver: IServiceResolver,
  context: TContext,
) => Record<string, string>;

/**
 * Builds structured logging scopes for pipeline requests and responses.
 * Port of Benzene.Abstractions.Logging.ILogContextBuilder.
 */
export interface ILogContextBuilder<TContext> extends IRegisterDependency {
  onRequest(dictionaryAction: LogContextDictionaryFunc<TContext>): ILogContextBuilder<TContext>;

  onResponse(dictionaryAction: LogContextDictionaryFunc<TContext>): ILogContextBuilder<TContext>;

  buildRequestScope(serviceResolver: IServiceResolver, context: TContext): Readonly<Record<string, unknown>>;

  buildResponseScope(serviceResolver: IServiceResolver, context: TContext): Readonly<Record<string, unknown>>;
}

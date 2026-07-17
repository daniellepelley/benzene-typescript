import {
  IBenzeneServiceContainer,
  ILogContextBuilder,
  IRegisterDependency,
  IServiceResolver,
  LogContextDictionaryFunc,
} from '@benzene/abstractions';
import { ContextDictionaryBuilder } from './ContextDictionaryBuilder';
import { IContextDictionaryBuilder } from './IContextDictionaryBuilder';

/**
 * Port of Benzene.Core.Logging.LogContextBuilder&lt;TContext&gt;.
 */
export class LogContextBuilder<TContext> implements ILogContextBuilder<TContext> {
  private readonly requestContextDictionaryBuilder: IContextDictionaryBuilder<TContext> =
    new ContextDictionaryBuilder<TContext>();
  private readonly responseContextDictionaryBuilder: IContextDictionaryBuilder<TContext> =
    new ContextDictionaryBuilder<TContext>();

  constructor(private readonly registerDependency: IRegisterDependency) {}

  onRequest(dictionaryAction: LogContextDictionaryFunc<TContext>): ILogContextBuilder<TContext> {
    this.requestContextDictionaryBuilder.with(dictionaryAction);
    return this;
  }

  onResponse(dictionaryAction: LogContextDictionaryFunc<TContext>): ILogContextBuilder<TContext> {
    this.responseContextDictionaryBuilder.with(dictionaryAction);
    return this;
  }

  buildRequestScope(
    serviceResolver: IServiceResolver,
    context: TContext,
  ): Readonly<Record<string, unknown>> {
    return this.requestContextDictionaryBuilder.build(serviceResolver, context);
  }

  buildResponseScope(
    serviceResolver: IServiceResolver,
    context: TContext,
  ): Readonly<Record<string, unknown>> {
    return this.responseContextDictionaryBuilder.build(serviceResolver, context);
  }

  register(action: (container: IBenzeneServiceContainer) => void): void {
    this.registerDependency.register(action);
  }
}

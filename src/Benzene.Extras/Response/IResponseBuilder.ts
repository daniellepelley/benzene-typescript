/** Port of Benzene.Extras.Response.IResponseBuilder. */
import { InjectableConstructor, IServiceResolver, ServiceFactory } from '@benzene/abstractions';
import { IResponseHandler } from '@benzene/abstractions-message-handlers';

/**
 * Fluent builder collecting the ordered set of `IResponseHandler<TContext>` factories that make up a
 * response pipeline.
 * Port of Benzene.Extras.Response.IResponseBuilder&lt;TContext&gt;.
 *
 * The two C# `Add` overloads (`Add<T>()` registering a handler type, and `Add(Func<…>)` taking a
 * factory) become two distinctly-named methods here: `add` (a handler constructor — the erased
 * `typeof(T)` is passed explicitly) and `addFactory` (a resolver→handler factory).
 */
export interface IResponseBuilder<TContext> {
  /** Port of C# `Add<T>()` — registers the handler type scoped and appends a resolve-it factory. */
  add(implementation: InjectableConstructor<IResponseHandler<TContext>>): IResponseBuilder<TContext>;

  /** Port of C# `Add(Func<IServiceResolver, IResponseHandler<TContext>>)` — appends a factory as-is. */
  addFactory(factory: ServiceFactory<IResponseHandler<TContext>>): IResponseBuilder<TContext>;

  /** Port of C# `GetBuilders()` — the collected handler factories, in registration order. */
  getBuilders(): Array<(serviceResolver: IServiceResolver) => IResponseHandler<TContext>>;
}

/** Port of Benzene.Extras.Response.ResponseBuilder. */
import {
  InjectableConstructor,
  IRegisterDependency,
  IServiceResolver,
  ServiceFactory,
} from '@benzene/abstractions';
import { IResponseHandler } from '@benzene/abstractions-message-handlers';
import { IResponseBuilder } from './IResponseBuilder';

/**
 * Default {@link IResponseBuilder} implementation.
 * Port of Benzene.Extras.Response.ResponseBuilder&lt;TContext&gt;.
 *
 * `add` registers the handler constructor scoped (via the injected {@link IRegisterDependency}) and
 * appends a factory that resolves it — the port of C# `Add<T>()`, whose erased `typeof(T)` is passed
 * as the constructor. Registering by the constructor as its own service identifier mirrors the C#
 * `AddScoped<T>()` / `GetService<T>()` pairing.
 */
export class ResponseBuilder<TContext> implements IResponseBuilder<TContext> {
  private readonly builders: Array<(serviceResolver: IServiceResolver) => IResponseHandler<TContext>> = [];

  constructor(private readonly register: IRegisterDependency) {}

  add(implementation: InjectableConstructor<IResponseHandler<TContext>>): IResponseBuilder<TContext> {
    this.register.register((container) => container.addScoped(implementation, implementation));
    this.builders.push((serviceResolver) => serviceResolver.getService(implementation));
    return this;
  }

  addFactory(factory: ServiceFactory<IResponseHandler<TContext>>): IResponseBuilder<TContext> {
    this.builders.push(factory);
    return this;
  }

  getBuilders(): Array<(serviceResolver: IServiceResolver) => IResponseHandler<TContext>> {
    return [...this.builders];
  }
}

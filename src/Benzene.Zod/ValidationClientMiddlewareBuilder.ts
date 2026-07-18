import { IServiceResolver } from '@benzene/abstractions';
import {
  IBenzeneClientContext,
  IBenzeneClientContextMiddlewareBuilder,
} from '@benzene/abstractions-messages';
import { IMiddleware } from '@benzene/abstractions-middleware';
import { ValidationClientMiddleware } from './ValidationClientMiddleware';

/**
 * `IBenzeneClientContextMiddlewareBuilder` that produces a `ValidationClientMiddleware` for the
 * client (outbound) pipeline.
 *
 * Port of Benzene.FluentValidation.ValidationClientMiddlewareBuilder, ADAPTED to Zod. C# injects the
 * `IServiceResolver` so the middleware can resolve `IValidator<TRequest>`; the Zod client middleware
 * resolves its schema from the message instance's constructor instead, so it needs no injected
 * state and the resolver argument is unused.
 */
export class ValidationClientMiddlewareBuilder implements IBenzeneClientContextMiddlewareBuilder {
  create<TRequest, TResponse>(
    _serviceResolver: IServiceResolver,
  ): IMiddleware<IBenzeneClientContext<TRequest, TResponse>> | undefined {
    return new ValidationClientMiddleware<TRequest, TResponse>();
  }
}

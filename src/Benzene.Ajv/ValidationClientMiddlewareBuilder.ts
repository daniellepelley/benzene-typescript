import { IServiceResolver } from '@benzenejs/abstractions';
import {
  IBenzeneClientContext,
  IBenzeneClientContextMiddlewareBuilder,
} from '@benzenejs/abstractions-messages';
import { IMiddleware } from '@benzenejs/abstractions-middleware';
import { ValidationClientMiddleware } from './ValidationClientMiddleware';

/**
 * `IBenzeneClientContextMiddlewareBuilder` that produces a `ValidationClientMiddleware` for the client
 * (outbound) pipeline.
 *
 * Port of the client-side builder half of Benzene.JsonSchema, ADAPTED to ajv exactly as the Zod adapter's
 * client builder. The client middleware resolves its validator from the message instance's constructor, so
 * it needs no injected state and the resolver argument is unused.
 */
export class ValidationClientMiddlewareBuilder implements IBenzeneClientContextMiddlewareBuilder {
  create<TRequest, TResponse>(
    _serviceResolver: IServiceResolver,
  ): IMiddleware<IBenzeneClientContext<TRequest, TResponse>> | undefined {
    return new ValidationClientMiddleware<TRequest, TResponse>();
  }
}

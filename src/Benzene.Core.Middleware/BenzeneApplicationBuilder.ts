import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IBenzeneApplicationBuilder, IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { MiddlewarePipelineBuilder } from './MiddlewarePipelineBuilder';

/**
 * Port of Benzene.Core.Middleware.BenzeneApplicationBuilder.
 *
 * Base `IBenzeneApplicationBuilder` implementation every hosting platform subclasses (e.g. AWS Lambda's
 * `AwsLambdaApplicationBuilder`) — platform subclasses supply their own `platform` constant and any
 * platform-specific pipeline/state alongside the base's `register`/`create` plumbing.
 */
export class BenzeneApplicationBuilder implements IBenzeneApplicationBuilder {
  /**
   * @param platform The hosting platform identifier, e.g. "AwsLambda" or "Worker".
   * @param benzeneServiceContainer The service container backing this builder.
   */
  constructor(
    public readonly platform: string,
    private readonly benzeneServiceContainer: IBenzeneServiceContainer,
  ) {}

  register(action: (container: IBenzeneServiceContainer) => void): void {
    action(this.benzeneServiceContainer);
  }

  create<TContext>(): IMiddlewarePipelineBuilder<TContext> {
    return new MiddlewarePipelineBuilder<TContext>(this.benzeneServiceContainer);
  }
}

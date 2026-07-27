import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IBenzeneApplicationBuilder, IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { BenzeneApplicationBuilder } from '@benzene/core-middleware';
import { AwsEventStreamContext } from './AwsEventStream/AwsEventStreamContext';

/**
 * Port of Benzene.Aws.Lambda.Core.AwsLambdaApplicationBuilder.
 *
 * AWS Lambda-specific application builder: a `BenzeneApplicationBuilder` that also carries the AWS event
 * stream pipeline builder. It is what a `BenzeneStartUp.configure(app)` receives, and
 * `useAwsLambda(app, aws => …)` unwraps `app.eventPipeline` as `aws`.
 */
export class AwsLambdaApplicationBuilder extends BenzeneApplicationBuilder {
  /** The platform name identifier for AWS Lambda. */
  static readonly platformName = 'AwsLambda';

  /**
   * @param eventPipeline The AWS event stream middleware pipeline builder.
   * @param benzeneServiceContainer The Benzene service container.
   */
  constructor(
    public readonly eventPipeline: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
    benzeneServiceContainer: IBenzeneServiceContainer,
  ) {
    super(AwsLambdaApplicationBuilder.platformName, benzeneServiceContainer);
  }
}

/**
 * Port of Benzene.Aws.Lambda.Core.AwsLambdaApplicationBuilderExtensions.UseAwsLambda.
 *
 * Applies AWS Lambda-specific configuration to a platform-neutral `IBenzeneApplicationBuilder`. No-op on
 * other platforms (the C# extension-method → free-function convention; `app is AwsLambdaApplicationBuilder`
 * → `instanceof`).
 */
export function useAwsLambda(
  app: IBenzeneApplicationBuilder,
  configure: (eventPipeline: IMiddlewarePipelineBuilder<AwsEventStreamContext>) => void,
): IBenzeneApplicationBuilder {
  if (app instanceof AwsLambdaApplicationBuilder) {
    configure(app.eventPipeline);
  }
  return app;
}

import { IRegisterDependency } from '@benzene/abstractions';
import { IMiddlewarePipelineBuilder } from '../IMiddlewarePipelineBuilder';

/**
 * Port of Benzene.Abstractions.Hosting.IBenzeneApplicationBuilder.
 *
 * Platform-neutral application builder passed to a `BenzeneStartUp`'s `configure` step. Every hosting
 * platform's builder (e.g. AWS Lambda's `AwsLambdaApplicationBuilder`) subclasses the
 * `BenzeneApplicationBuilder` base that implements this, supplying its own `platform` constant and any
 * platform-specific pipeline/state alongside the base's `register`/`create` plumbing.
 *
 * `Platform { get; }` → a readonly `platform` property.
 */
export interface IBenzeneApplicationBuilder extends IRegisterDependency {
  /** The hosting platform identifier, e.g. "AwsLambda" or "Worker". */
  readonly platform: string;

  /** Creates a middleware pipeline builder for the given context type. */
  create<TContext>(): IMiddlewarePipelineBuilder<TContext>;
}

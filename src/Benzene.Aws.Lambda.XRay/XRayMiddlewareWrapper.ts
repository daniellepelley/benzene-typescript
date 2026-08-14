/** Port of Benzene.Aws.Lambda.XRay.XRayMiddlewareWrapper. */
import { IServiceResolver } from '@benzenejs/abstractions';
import { IMiddleware, IMiddlewareWrapper } from '@benzenejs/abstractions-middleware';
import { XRayMiddlewareDecorator } from './XRayMiddlewareDecorator';

/**
 * Wraps every middleware in the pipeline in an {@link XRayMiddlewareDecorator}, opening an AWS X-Ray
 * subsegment per pipeline stage. Registered by `addXRayTracing`. The direct-to-X-Ray counterpart of
 * `Benzene.Diagnostics.ActivityMiddlewareWrapper`.
 */
export class XRayMiddlewareWrapper implements IMiddlewareWrapper {
  wrap<TContext>(
    serviceResolver: IServiceResolver,
    middleware: IMiddleware<TContext>,
  ): IMiddleware<TContext> {
    return new XRayMiddlewareDecorator<TContext>(middleware, serviceResolver);
  }
}

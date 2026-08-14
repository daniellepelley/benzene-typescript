/** Port of Benzene.Aws.Lambda.XRay.DependencyInjectionExtensions. */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IMiddlewareWrapper } from '@benzenejs/abstractions-middleware';
import { XRayMiddlewareWrapper } from './XRayMiddlewareWrapper';

/**
 * Registers {@link XRayMiddlewareWrapper} so every middleware in every pipeline is wrapped in its own AWS
 * X-Ray subsegment (named after the middleware, annotated `benzene_transport`/`benzene_topic`/
 * `benzene_version`/`benzene_handler` where resolvable), nested under the Lambda's X-Ray segment. The
 * X-Ray equivalent of `addActivityPerMiddleware`.
 *
 * Idempotent (an `isTypeRegistered` guard means it never double-wraps a middleware) and composes with
 * `@benzenejs/diagnostics`'s `addActivityPerMiddleware`/`addDiagnostics` — wire both to emit X-Ray
 * subsegments *and* OpenTelemetry spans from the same pipeline. Requires no exporter or collector: the
 * AWS X-Ray SDK sends subsegments to the X-Ray daemon the Lambda runtime provides when active tracing is
 * on. Off Lambda it is a safe no-op.
 */
export function addXRayTracing(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  if (!services.isTypeRegistered(XRayMiddlewareWrapper)) {
    services.addSingleton(XRayMiddlewareWrapper);
    services.addSingleton(IMiddlewareWrapper, XRayMiddlewareWrapper);
  }

  return services;
}

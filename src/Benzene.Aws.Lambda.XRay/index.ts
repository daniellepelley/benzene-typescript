/**
 * Port of Benzene.Aws.Lambda.XRay — per-middleware tracing straight into AWS X-Ray, no OpenTelemetry/OTLP
 * collector in the middle.
 *
 * `addXRayTracing(services)` wraps every middleware in every pipeline in an X-Ray subsegment (via
 * `aws-xray-sdk-core`), named after the middleware, so the middleware breakdown nests directly under the
 * Lambda's `AWS::Lambda::Function` segment inside the same X-Ray trace. Composes with
 * `@benzene/diagnostics`'s OpenTelemetry per-middleware spans; off Lambda it is a safe no-op.
 *
 * PORTING BEND: the concrete `AWSXRayRecorder.Instance` becomes an injectable {@link IXRayRecorder} seam
 * (default {@link XRayRecorder}) over `aws-xray-sdk-core`'s module functions + CLS context, keeping the
 * decorator testable without a live X-Ray context.
 */
export * from './IXRayRecorder';
export * from './XRayMiddlewareDecorator';
export * from './XRayMiddlewareWrapper';
export * from './DependencyInjectionExtensions';

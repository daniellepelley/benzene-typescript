import { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { BenzeneStartUp } from '@benzenejs/abstractions-middleware';
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import { handleHttpRequest } from './Extensions';

/**
 * The `@azure/functions` HTTP-trigger handler an `app.http(name, { handler })` registration expects, with
 * `context` optional so the getter's result is also callable as `host.httpFunction(request)` in a test.
 * Assignable to `@azure/functions`' stricter `HttpHandler` (a function with an optional trailing parameter
 * is assignable to one that requires it).
 */
export type AzureHttpFunction = (
  request: HttpRequest,
  context?: InvocationContext,
) => Promise<HttpResponseInit>;

/**
 * Adds the `.httpFunction` getter to {@link AzureFunctionHost}, mirroring `AwsLambdaHost.lambdaHandler` /
 * `GoogleCloudFunctionHost.httpFunction`. It returns the `@azure/functions` HTTP handler to register with
 * `app.http(name, { …, handler: host.httpFunction })`.
 *
 * WHY MODULE AUGMENTATION: the built-app HTTP dispatch (`handleHttpRequest`, which reads the request body
 * and wraps it for the HTTP pipeline) lives in THIS package, but `AzureFunctionHost` lives in transport-
 * agnostic `@benzenejs/azure-function-core`. Adding the getter here — the exact `declare module` + prototype
 * pattern the `@benzenejs/azure-function-testing` package uses to add `buildAzureFunctionApp` to the neutral
 * test host — keeps core free of the HTTP transport while still giving the host a first-class
 * `.httpFunction`. The getter lights up wherever this package is imported, which an HTTP trigger
 * registration always is (for its `useAzureHttp` wiring). A closure over `this.app` keeps `this` attached
 * when the getter's result is passed as a bare `handler`.
 */
declare module '@benzenejs/azure-function-core' {
  interface AzureFunctionHost<TStartUp extends BenzeneStartUp> {
    /** The HTTP-trigger handler to register with `app.http(name, { handler: host.httpFunction })`. */
    readonly httpFunction: AzureHttpFunction;
  }
}

Object.defineProperty(AzureFunctionHost.prototype, 'httpFunction', {
  configurable: true,
  get(this: AzureFunctionHost<BenzeneStartUp>): AzureHttpFunction {
    return (request) => handleHttpRequest(this.app, request);
  },
});

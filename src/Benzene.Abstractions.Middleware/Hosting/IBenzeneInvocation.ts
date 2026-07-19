import { ServiceIdentifier, ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Port of Benzene.Abstractions.Hosting.IBenzeneInvocation
 * (defined in the C# `Benzene.Abstractions.Pipelines` project; this port folds the
 * `Benzene.Abstractions.Hosting` namespace into `@benzene/abstractions-middleware`, the abstractions
 * package that already carries `IMiddlewarePipelineBuilder`/`IRegisterDependency` — the two types the
 * sibling `IBenzeneApplicationBuilder` depends on — so no separate hosting package is needed).
 *
 * Exposes platform-neutral and platform-specific metadata for the current invocation, so a handler can
 * stay portable across hosts while still reaching native platform context (e.g. AWS's `Context`/
 * `ILambdaContext` or ASP.NET Core's `HttpContext`) when it genuinely needs to. Resolve it as a scoped
 * dependency; it is populated once per invocation by the hosting platform's `useBenzeneInvocation()`
 * pipeline middleware.
 *
 * ADAPTATION — `getFeature<T>()`. C# `T? GetFeature<T>() where T : class` keys the feature bag by the
 * runtime `Type` of `T`, which TypeScript erases. Following the port's service-resolution convention,
 * the feature is instead looked up by an explicit `ServiceIdentifier<T>` argument (a `ServiceToken` for
 * an interface, or a class constructor), the same runtime stand-in used for `getService`. The result is
 * `T | undefined` (C# `null` → `undefined`).
 */
export interface IBenzeneInvocation {
  /**
   * An identifier for the current invocation (e.g. the AWS Lambda request ID or the ASP.NET Core trace
   * identifier), unique enough for correlating logs and traces for this invocation.
   */
  readonly invocationId: string;

  /**
   * The hosting platform identifier for the current invocation (e.g. "AwsLambda", "AspNet"), matching
   * `IBenzeneApplicationBuilder.platform`.
   */
  readonly platform: string;

  /**
   * Gets the native platform feature identified by `feature` for this invocation (e.g. the Lambda
   * `Context`), or `undefined` if this invocation's platform doesn't expose one.
   *
   * @param feature The identifier the feature was keyed under (the TypeScript stand-in for the C#
   * `typeof(T)` key — see the class remarks).
   */
  getFeature<T>(feature: ServiceIdentifier<T>): T | undefined;
}

export const IBenzeneInvocation: ServiceToken<IBenzeneInvocation> =
  serviceToken<IBenzeneInvocation>('IBenzeneInvocation');

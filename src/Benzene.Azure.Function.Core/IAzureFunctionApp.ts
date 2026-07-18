/** Port of Benzene.Azure.Function.Core.IAzureFunctionApp. */

/**
 * Represents a built Azure Function app that dispatches requests to the matching registered entry
 * point application, based on the request type.
 *
 * ISOLATED-WORKER ADAPTATION: the .NET original is invoked from an isolated-worker trigger method
 * (`[ServiceBusTrigger] ... => azureFunctionApp.HandleServiceBusMessages(...)`), which injects this
 * built app and hands it the trigger payload. The Node `@azure/functions` v4 programming model is the
 * same idea — a registered trigger callback (`app.serviceBusQueue('name', { handler })`) receives the
 * payload and the `InvocationContext`, then forwards the payload here. This interface is transport-
 * agnostic, so it stays a pure dispatcher; only the transport packages know their message types.
 *
 * OVERLOAD SPLIT (arity-overloaded generic method): C# overloads `HandleAsync` on generic arity —
 * `HandleAsync<TRequest, TResponse>` (response) and `HandleAsync<TRequest>` (fire-and-forget). Both
 * take a single value argument, so they are indistinguishable once TypeScript erases generics; per
 * the port's `WithResult` naming rule the response-returning variant becomes `handleAsyncWithResult`
 * and the fire-and-forget variant keeps `handleAsync`.
 */
export interface IAzureFunctionApp {
  /**
   * Handles a request that expects a response, dispatching to the registered entry point application
   * whose request/response types match. Port of C# `HandleAsync<TRequest, TResponse>`.
   * @typeParam TRequest The request type.
   * @typeParam TResponse The response type.
   * @param request The request to handle.
   * @returns The response produced by the matching entry point application.
   */
  handleAsyncWithResult<TRequest, TResponse>(request: TRequest): Promise<TResponse>;

  /**
   * Handles a fire-and-forget request, dispatching to the registered entry point application whose
   * request type matches. Port of C# `HandleAsync<TRequest>`.
   * @typeParam TRequest The request type.
   * @param request The request to handle.
   * @returns A promise that resolves when the matching entry point application has finished.
   */
  handleAsync<TRequest>(request: TRequest): Promise<void>;
}

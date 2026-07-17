/**
 * Entry points are the top-level bootstrap components that receive external events
 * (HTTP requests, queue messages, etc.) and process them through a middleware pipeline.
 * Port of Benzene.Abstractions.Middleware.IEntryPointMiddlewareApplication.
 *
 * The C# marker interface and its two generic variants map to two TypeScript
 * interfaces; `IEntryPointMiddlewareApplication<TEvent>` (no result) and
 * `IEntryPointMiddlewareApplicationWithResult<TEvent, TResult>`, since TypeScript
 * cannot overload a type name on arity.
 */
export interface IEntryPointMiddlewareApplication<TEvent> {
  /** Sends an event through the middleware pipeline for processing. */
  sendAsync(event: TEvent): Promise<void>;
}

/** Port of C# `IEntryPointMiddlewareApplication<TEvent, TResult>`. */
export interface IEntryPointMiddlewareApplicationWithResult<TEvent, TResult> {
  /** Sends an event through the middleware pipeline and returns the result. */
  sendAsync(event: TEvent): Promise<TResult>;
}

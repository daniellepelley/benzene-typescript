/**
 * Provides bidirectional conversion between different context types in a middleware
 * pipeline. Context converters enable splitting pipelines into multiple stages with
 * different context types (e.g. separating transport-specific concerns from business
 * logic in a hexagonal architecture).
 * Port of Benzene.Abstractions.Middleware.IContextConverter&lt;TContextIn, TContextOut&gt;.
 */
export interface IContextConverter<TContextIn, TContextOut> {
  /**
   * Creates the output context from the input context (forward transformation,
   * called before the inner pipeline executes).
   */
  createRequestAsync(contextIn: TContextIn): Promise<TContextOut>;

  /**
   * Maps results from the output context back onto the input context (backward
   * mapping, called after the inner pipeline completes).
   */
  mapResponseAsync(contextIn: TContextIn, contextOut: TContextOut): Promise<void>;
}

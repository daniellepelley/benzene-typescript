import { IMiddlewarePipelineBuilder } from './IMiddlewarePipelineBuilder';

/**
 * A composable pipeline capability — the TypeScript-idiomatic answer to .NET's `app.UseXml()` /
 * `app.UseHealthCheck()` extension methods. Because TypeScript has no cross-package extension methods,
 * a capability is an *imported factory value* you drop into `builder.use(...)`: `builder.use(xml())`,
 * `builder.use(healthCheck('healthcheck', checks))`. This reads as the same top-to-bottom capability
 * checklist as .NET, stays fully tree-shakeable (you import only the verbs you use), and needs no
 * prototype augmentation.
 *
 * A capability can express *both* effects a `useX(app, …)` free function does today — registering
 * services and/or adding middleware — because its {@link configure} runs against the builder, which
 * exposes both `register` and `use`/`useFn`. It is a branded object (not a bare function) so
 * `builder.use(...)` can tell it apart from a `MiddlewareFactoryFunc` at runtime.
 */
export interface Capability<TContext> {
  /** Brand so `use(...)` can distinguish a capability from a middleware factory function. */
  readonly __benzeneCapability: true;

  /** Applies the capability to the builder — registers services and/or adds middleware. */
  configure(builder: IMiddlewarePipelineBuilder<TContext>): void;
}

/**
 * Wraps a `configure` action as a {@link Capability}. Capability authors (`xml()`, `healthCheck(...)`)
 * return `capability((b) => useXml(b))` etc., so the existing `useX` free functions stay the single
 * source of behaviour.
 */
export function capability<TContext>(
  configure: (builder: IMiddlewarePipelineBuilder<TContext>) => void,
): Capability<TContext> {
  return { __benzeneCapability: true, configure };
}

/** Whether `value` is a {@link Capability} (used by `builder.use(...)` to dispatch). */
export function isCapability<TContext>(value: unknown): value is Capability<TContext> {
  return typeof value === 'object' && value !== null && '__benzeneCapability' in value;
}

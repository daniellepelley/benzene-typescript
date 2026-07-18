import { tryAddSingleton } from '@benzene/abstractions';
import { IMessageRouterBuilder } from '@benzene/abstractions-message-handlers';
import {
  DefaultValidationStatusMapper,
  IValidationStatusMapper,
} from '@benzene/abstractions-validation';
import { ValidationMiddlewareBuilder } from './ValidationMiddlewareBuilder';

export { registerJoiSchema } from './JoiSchemaRegistry';

/**
 * Adds Joi request validation to a message router.
 *
 * Port of Benzene.FluentValidation.DependencyExtensions.UseFluentValidation (a fluent C# extension
 * method → a free function taking the builder as its first argument, per the porting conventions),
 * ADAPTED to Joi. Registers `DefaultValidationStatusMapper` as the `IValidationStatusMapper` (via
 * `tryAddSingleton`, the port of C# `TryAddSingleton`) and adds the `ValidationMiddlewareBuilder` to
 * the handler pipeline. Returns the builder for chaining, mirroring the C# return value.
 *
 * C#'s `AddFluentValidation` also scans assemblies to discover and register `IValidator<T>`
 * implementations; the Joi equivalent of that association is `registerJoiSchema`, called explicitly
 * by the application (there is no assembly scanning in Node), so this function only wires the
 * middleware and the status mapper.
 */
export function useJoiValidation(builder: IMessageRouterBuilder): IMessageRouterBuilder {
  builder.register((container) => {
    tryAddSingleton(container, IValidationStatusMapper, DefaultValidationStatusMapper);
  });
  return builder.add(new ValidationMiddlewareBuilder());
}

/**
 * Client-side (outbound) counterpart of `useJoiValidation`.
 *
 * C#'s `Benzene.FluentValidation` ships `ValidationClientMiddleware(Builder)` but no `Use...`
 * extension for it; the port has no router surface that consumes an
 * `IBenzeneClientContextMiddlewareBuilder` yet either (the client middleware slice is defined in
 * `@benzene/abstractions-messages` but not consumed by any pipeline builder in the port so far). So
 * rather than invent a registration that has nothing to attach to, `ValidationClientMiddlewareBuilder`
 * is exported for manual wiring; a `useJoiValidationClient` free function will be added here once a
 * client router exposes an `add`, mirroring `useJoiValidation`.
 */
export { ValidationClientMiddlewareBuilder } from './ValidationClientMiddlewareBuilder';

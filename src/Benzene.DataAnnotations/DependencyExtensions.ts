import { IMessageRouterBuilder } from '@benzene/abstractions-message-handlers';
import { ValidationMiddlewareBuilder } from './ValidationMiddlewareBuilder';

/**
 * Adds DataAnnotations request validation to a message router.
 * Port of Benzene.DataAnnotations.DependencyExtensions.UseDataAnnotationsValidation
 * (a fluent C# extension method → a free function taking the builder as its first argument, per the
 * porting conventions). Returns the builder for chaining, mirroring the C# return value.
 */
export function useDataAnnotationsValidation(builder: IMessageRouterBuilder): IMessageRouterBuilder {
  return builder.add(new ValidationMiddlewareBuilder());
}

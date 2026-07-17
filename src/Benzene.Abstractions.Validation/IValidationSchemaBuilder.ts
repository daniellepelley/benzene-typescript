import { Constructor, ServiceToken, serviceToken } from '@benzene/abstractions';
import { IValidationSchema } from './IValidationSchema';

/**
 * Builds the validation schemas for a request type, keyed by property name.
 * Port of Benzene.Abstractions.Validation.IValidationSchemaBuilder.
 *
 * Deviations:
 * - C# `IDictionary<string, IValidationSchema[]>` → `Record<string, IValidationSchema[]>`.
 * - C# `GetValidationSchemas(Type type)` resolves the type by reflection; TypeScript erases types,
 *   so `Type` becomes a `Constructor<unknown>` runtime identifier.
 *
 * Resolved from the container, so a merged `ServiceToken` of the same name is declared.
 */
export interface IValidationSchemaBuilder {
  getValidationSchemas(type: Constructor<unknown>): Record<string, IValidationSchema[]>;
}

export const IValidationSchemaBuilder: ServiceToken<IValidationSchemaBuilder> =
  serviceToken<IValidationSchemaBuilder>('IValidationSchemaBuilder');

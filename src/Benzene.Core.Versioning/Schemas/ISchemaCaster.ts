/** Port of Benzene.Core.Versioning.Schemas.ISchemaCaster (+ the generic ISchemaCaster<TFrom,TTo>). */
import { Constructor, ServiceToken, serviceToken } from '@benzene/abstractions';
import { ICaster } from '../Casters/ICaster';
import { SchemaCastDefinition } from './SchemaCastDefinition';

/**
 * A registered schema cast, keyed by its from/to CLR shapes. Lets a caller that only knows the runtime
 * types (a version-aware request/response mapper) invoke the strongly-typed caster without reflection.
 *
 * Erasure: C#'s `Type FromType`/`ToType` (from `typeof(T)`) become `Constructor` (the message class),
 * per the port convention. C#'s `object? Cast(object)` -> `cast(from: unknown): unknown`.
 */
export interface ISchemaCaster {
  readonly definition: SchemaCastDefinition;
  readonly fromType: Constructor<unknown>;
  readonly toType: Constructor<unknown>;

  /** Casts a value of {@link fromType} to a value of {@link toType}. */
  cast(from: unknown): unknown;
}

/**
 * Container token: individual casters are registered under this and collected via
 * `getServices(ISchemaCaster)` by `registerPayloadSchemaVersions`.
 */
export const ISchemaCaster: ServiceToken<ISchemaCaster> = serviceToken<ISchemaCaster>('ISchemaCaster');

/**
 * The strongly-typed view of an {@link ISchemaCaster}. C#'s `ISchemaCaster<TFrom,TTo>` -> `ISchemaCasterOf`
 * (the port's `IFoo`/`IFooOf<T>` split, as with `IBenzeneResult`/`IBenzeneResultOf`).
 */
export interface ISchemaCasterOf<TFrom, TTo> extends ISchemaCaster {
  readonly caster: ICaster<TFrom, TTo>;
}

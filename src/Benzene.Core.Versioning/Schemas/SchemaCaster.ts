/** Port of Benzene.Core.Versioning.Schemas.SchemaCaster. */
import { Constructor } from '@benzene/abstractions';
import { ICaster } from '../Casters/ICaster';
import { ISchemaCasterOf } from './ISchemaCaster';
import { SchemaCastDefinition } from './SchemaCastDefinition';

/**
 * Default {@link ISchemaCasterOf} implementation: pairs a {@link SchemaCastDefinition} with the typed
 * caster that performs the conversion.
 *
 * Erasure: C# derives `FromType`/`ToType` from `typeof(TFrom)`/`typeof(TTo)`; TypeScript has no runtime
 * `typeof(T)`, so the from/to constructors are passed in explicitly.
 */
export class SchemaCaster<TFrom, TTo> implements ISchemaCasterOf<TFrom, TTo> {
  constructor(
    readonly fromType: Constructor<unknown>,
    readonly toType: Constructor<unknown>,
    readonly definition: SchemaCastDefinition,
    readonly caster: ICaster<TFrom, TTo>,
  ) {}

  cast(from: unknown): unknown {
    return this.caster.cast(from as TFrom);
  }
}

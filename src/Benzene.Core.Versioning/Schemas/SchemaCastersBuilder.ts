/** Port of Benzene.Core.Versioning.Schemas.SchemaCastersBuilder. */
import { Constructor } from '@benzene/abstractions';
import { ISchemaCaster } from './ISchemaCaster';
import { CasterInput, SchemaCasterBuilder } from './SchemaCasterBuilder';

/**
 * Fluent builder for a set of {@link ISchemaCaster}s.
 *
 * DIVERGENCE from C#: `add` requires an explicit caster (the auto-mapper default is not ported - see
 * {@link SchemaCasterBuilder}), and takes the `fromType`/`toType` constructors up front (C#'s `typeof(T)`
 * has no TS runtime equivalent).
 */
export class SchemaCastersBuilder {
  private readonly definitions: ISchemaCaster[] = [];

  add<TFrom, TTo>(
    fromType: Constructor<unknown>,
    toType: Constructor<unknown>,
    topic: string,
    fromSchema: string,
    toSchema: string,
    caster: CasterInput<TFrom, TTo>,
  ): SchemaCastersBuilder {
    const builder = new SchemaCasterBuilder<TFrom, TTo>(fromType, toType, topic, fromSchema, toSchema).withCustomCaster(caster);
    this.definitions.push(builder.build());
    return this;
  }

  build(): ISchemaCaster[] {
    return [...this.definitions];
  }
}

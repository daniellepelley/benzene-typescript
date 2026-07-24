/** Port of Benzene.Core.Versioning.Schemas.SchemaCasterBuilder. */
import { Constructor } from '@benzene/abstractions';
import { FuncCaster } from '../Casters/FuncCaster';
import { ICaster } from '../Casters/ICaster';
import { ISchemaCaster } from './ISchemaCaster';
import { SchemaCaster } from './SchemaCaster';
import { SchemaCastDefinition } from './SchemaCastDefinition';

/** A cast supplied to the builder: an {@link ICaster} instance or a bare `(from) => to` function. */
export type CasterInput<TFrom, TTo> = ICaster<TFrom, TTo> | ((from: TFrom) => TTo);

/**
 * Builds one {@link ISchemaCaster} for a `(topic, fromSchema -> toSchema)` pair.
 *
 * DIVERGENCE: the C# builder's parameterless default builds a reflection + expression-tree auto-mapper
 * (`CasterFactory`) that maps properties by name. That has no faithful TypeScript equivalent (no runtime
 * property reflection, no IL compilation, no assembly type-scanning), so it is NOT ported - a caster must
 * be supplied explicitly via {@link withCustomCaster} (an `ICaster` or a `(from) => to` function, which
 * is the idiomatic TS way anyway). The `fromType`/`toType` constructors are passed in because C# derives
 * them from `typeof(TFrom)`/`typeof(TTo)`, which TypeScript erases.
 */
export class SchemaCasterBuilder<TFrom, TTo> {
  private caster: ICaster<TFrom, TTo> | undefined;

  constructor(
    private readonly fromType: Constructor<unknown>,
    private readonly toType: Constructor<unknown>,
    private readonly topic: string,
    private readonly fromSchema: string,
    private readonly toSchema: string,
  ) {}

  withCustomCaster(caster: CasterInput<TFrom, TTo>): SchemaCasterBuilder<TFrom, TTo> {
    this.caster = typeof caster === 'function' ? new FuncCaster<TFrom, TTo>(caster) : caster;
    return this;
  }

  build(): ISchemaCaster {
    if (this.caster === undefined) {
      throw new Error(
        `No caster supplied for ${this.topic}: ${this.fromSchema} -> ${this.toSchema}. The reflection-based ` +
          'auto-mapper has no TypeScript port; supply an explicit cast function via withCustomCaster.',
      );
    }

    try {
      return new SchemaCaster<TFrom, TTo>(
        this.fromType,
        this.toType,
        new SchemaCastDefinition(this.topic, this.fromSchema, this.toSchema),
        this.caster,
      );
    } catch (ex) {
      throw new Error(
        `Failed to build caster for ${this.topic}: ${this.fromSchema} -> ${this.toSchema}`,
        { cause: ex },
      );
    }
  }
}

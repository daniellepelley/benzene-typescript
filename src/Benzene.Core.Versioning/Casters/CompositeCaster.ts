/** Port of Benzene.Core.Versioning.Casters.CompositeCaster. */
import { ICaster } from './ICaster';

/** Chains two casters (`TFrom -> TIntermediate -> TTo`), so a multi-step version migration runs as one. */
export class CompositeCaster<TFrom, TIntermediate, TTo> implements ICaster<TFrom, TTo> {
  constructor(
    private readonly caster1: ICaster<TFrom, TIntermediate>,
    private readonly caster2: ICaster<TIntermediate, TTo>,
  ) {}

  cast(from: TFrom): TTo {
    return this.caster2.cast(this.caster1.cast(from));
  }
}

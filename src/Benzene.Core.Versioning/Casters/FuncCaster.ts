/** Port of Benzene.Core.Versioning.Casters.FuncCaster. */
import { ICaster } from './ICaster';

/** An {@link ICaster} backed by an inline cast function - the idiomatic way to write a version cast. */
export class FuncCaster<TFrom, TTo> implements ICaster<TFrom, TTo> {
  constructor(private readonly castFunc: (from: TFrom) => TTo) {}

  cast(from: TFrom): TTo {
    return this.castFunc(from);
  }
}

import { IValidationSchema } from './IValidationSchema';

/**
 * A minimum-length validation constraint.
 * Port of Benzene.Abstractions.Validation.IMinLengthValidationSchema.
 */
export interface IMinLengthValidationSchema extends IValidationSchema {
  readonly min: number;
}

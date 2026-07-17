import { IValidationSchema } from './IValidationSchema';

/**
 * A maximum-length validation constraint.
 * Port of Benzene.Abstractions.Validation.IMaxLengthValidationSchema.
 */
export interface IMaxLengthValidationSchema extends IValidationSchema {
  readonly max: number;
}

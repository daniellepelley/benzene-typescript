import { IValidationSchema } from './IValidationSchema';

/**
 * A constraint requiring the value to be one of a fixed set of options.
 * Port of Benzene.Abstractions.Validation.IIsOneOfValidationSchema.
 */
export interface IIsOneOfValidationSchema extends IValidationSchema {
  readonly options: string[];
}

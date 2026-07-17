import { IValidationSchema } from './IValidationSchema';

/**
 * A regular-expression validation constraint.
 * Port of Benzene.Abstractions.Validation.IRegexValidationSchema.
 */
export interface IRegexValidationSchema extends IValidationSchema {
  readonly expression: string;
}

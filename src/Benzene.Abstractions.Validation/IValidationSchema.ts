/**
 * A single validation constraint described for a property (a name/description pair that concrete
 * constraint interfaces extend with their specifics).
 * Port of Benzene.Abstractions.Validation.IValidationSchema.
 */
export interface IValidationSchema {
  readonly name: string;
  readonly description: string;
}

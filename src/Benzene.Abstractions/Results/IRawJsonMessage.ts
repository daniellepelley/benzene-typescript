/**
 * A payload that carries a pre-rendered JSON string, delivered as-is rather than re-serialized.
 * Port of Benzene.Abstractions.Results.IRawJsonMessage.
 *
 * Deviation: in .NET this interface physically lives in the `Benzene.Abstractions.Pipelines`
 * assembly (under the `Benzene.Abstractions.Results` namespace). The port folds it into
 * `@benzene/abstractions` alongside the other result types rather than creating a separate package
 * for two marker interfaces.
 */
export interface IRawJsonMessage {
  /** The raw JSON string to deliver. */
  readonly json: string;
}

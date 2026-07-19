/**
 * A payload that carries a Base64-encoded JSON string, delivered as-is rather than re-serialized.
 * Port of Benzene.Abstractions.Results.IBase64JsonMessage.
 *
 * Deviation: as with {@link IRawJsonMessage}, in .NET this lives in the
 * `Benzene.Abstractions.Pipelines` assembly (under the `Benzene.Abstractions.Results` namespace);
 * the port folds it into `@benzene/abstractions`.
 */
export interface IBase64JsonMessage {
  /** The Base64-encoded JSON string to deliver. */
  readonly base64Json: string;
}

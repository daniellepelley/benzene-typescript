/**
 * Identifies a message by id and version.
 * Port of Benzene.Abstractions.Messages.ITopic.
 */
export interface ITopic {
  readonly id: string;
  readonly version: string;
}

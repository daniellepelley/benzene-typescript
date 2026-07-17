/**
 * The outcome flag carried on a message context.
 * Port of Benzene.Abstractions.MessageHandlers.IMessageResult.
 */
export interface IMessageResult {
  readonly isSuccessful: boolean;
}

/** Port of Benzene.Abstractions.MessageHandlers.IHasMessageResult. */
export interface IHasMessageResult {
  messageResult: IMessageResult;
}

import { IBenzeneResult } from '@benzene/abstractions';
import {
  IMessageHandlerDefinition,
  IMessageHandlerResult,
} from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';

/**
 * Default `IMessageHandlerResult` implementation, produced by `MessageRouter<TContext>` after
 * routing and (attempting to) invoke a handler for one message.
 * Port of Benzene.Core.MessageHandlers.MessageHandlerResult.
 *
 * The strongly-typed C# `MessageHandlerResult<TResponse>` is deferred alongside its interface — the
 * routing path only produces the untyped form (see `IMessageHandlerResult`).
 */
export class MessageHandlerResult implements IMessageHandlerResult {
  readonly topic: ITopic | undefined;

  readonly messageHandlerDefinition: IMessageHandlerDefinition | undefined;

  readonly benzeneResult: IBenzeneResult;

  constructor(benzeneResult: IBenzeneResult);
  constructor(
    topic: ITopic | undefined,
    messageHandlerDefinition: IMessageHandlerDefinition | undefined,
    benzeneResult: IBenzeneResult,
  );
  constructor(
    topicOrBenzeneResult: ITopic | undefined | IBenzeneResult,
    messageHandlerDefinition?: IMessageHandlerDefinition | undefined,
    benzeneResult?: IBenzeneResult,
  ) {
    if (benzeneResult === undefined) {
      // Single-argument overload: only the untyped result, no routing metadata.
      this.benzeneResult = topicOrBenzeneResult as IBenzeneResult;
      this.topic = undefined;
      this.messageHandlerDefinition = undefined;
      return;
    }

    this.topic = topicOrBenzeneResult as ITopic | undefined;
    this.messageHandlerDefinition = messageHandlerDefinition;
    this.benzeneResult = benzeneResult;
  }
}

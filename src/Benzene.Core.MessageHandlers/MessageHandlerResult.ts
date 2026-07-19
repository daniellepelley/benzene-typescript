import { IBenzeneResult, IBenzeneResultOf } from '@benzene/abstractions';
import {
  IMessageHandlerDefinition,
  IMessageHandlerResult,
  IMessageHandlerResultOf,
} from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';

/**
 * Default `IMessageHandlerResult` implementation, produced by `MessageRouter<TContext>` after
 * routing and (attempting to) invoke a handler for one message.
 * Port of Benzene.Core.MessageHandlers.MessageHandlerResult.
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

/**
 * Strongly-typed variant of `MessageHandlerResult`, carrying the handler's typed response payload.
 * Port of Benzene.Core.MessageHandlers.MessageHandlerResult&lt;TResponse&gt;.
 */
export class MessageHandlerResultOf<TResponse> implements IMessageHandlerResultOf<TResponse> {
  readonly topic: ITopic | undefined;

  readonly messageHandlerDefinition: IMessageHandlerDefinition | undefined;

  readonly benzeneResult: IBenzeneResultOf<TResponse>;

  constructor(benzeneResult: IBenzeneResultOf<TResponse>);
  constructor(
    topic: ITopic | undefined,
    messageHandlerDefinition: IMessageHandlerDefinition | undefined,
    benzeneResult: IBenzeneResultOf<TResponse>,
  );
  constructor(
    topicOrBenzeneResult: ITopic | undefined | IBenzeneResultOf<TResponse>,
    messageHandlerDefinition?: IMessageHandlerDefinition | undefined,
    benzeneResult?: IBenzeneResultOf<TResponse>,
  ) {
    if (benzeneResult === undefined) {
      // Single-argument overload: only the typed result, no routing metadata.
      this.benzeneResult = topicOrBenzeneResult as IBenzeneResultOf<TResponse>;
      this.topic = undefined;
      this.messageHandlerDefinition = undefined;
      return;
    }

    this.topic = topicOrBenzeneResult as ITopic | undefined;
    this.messageHandlerDefinition = messageHandlerDefinition;
    this.benzeneResult = benzeneResult;
  }

  /**
   * Converts this strongly-typed result to the untyped `MessageHandlerResult`, carrying the same
   * routing metadata and the underlying untyped `IBenzeneResult`. TypeScript has no C# explicit
   * conversion operator, so the port exposes it as an instance method (see the README mapping).
   */
  toUntyped(): MessageHandlerResult {
    return new MessageHandlerResult(this.topic, this.messageHandlerDefinition, this.benzeneResult);
  }
}

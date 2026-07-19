/** Port of Benzene.Core.Messages.MessageSenderDefinition. */
import { ServiceIdentifier, VoidResult } from '@benzene/abstractions';
import { IMessageSenderDefinition, ITopic } from '@benzene/abstractions-messages';
import { Constants } from '../Constants';
import { Topic } from '../Topic';

/**
 * Default {@link IMessageSenderDefinition}: describes an outbound sender — its topic, request/response
 * types and the sender's own type. The sender-side counterpart of `MessageHandlerDefinition`, consumed
 * by the mesh/schema tooling to describe what a service sends.
 * Port of Benzene.Core.Messages.MessageSenderDefinition.
 *
 * The four C# `CreateInstance` overloads collapse into a single {@link create} with optional
 * parameters (the port's standard overload treatment); `VoidResult` is the "no type" sentinel that
 * mirrors C# `typeof(Void)`, and the string-topic form builds a {@link Topic}. The constructor is
 * private, matching the C# design where only the static factories are public.
 */
export class MessageSenderDefinition implements IMessageSenderDefinition {
  readonly topic: ITopic;

  readonly requestType: ServiceIdentifier<unknown>;

  readonly responseType: ServiceIdentifier<unknown>;

  readonly senderType: ServiceIdentifier<unknown>;

  private constructor(
    topic: ITopic,
    requestType: ServiceIdentifier<unknown>,
    responseType: ServiceIdentifier<unknown>,
    senderType: ServiceIdentifier<unknown>,
  ) {
    this.topic = topic;
    this.requestType = requestType;
    this.responseType = responseType;
    this.senderType = senderType;
  }

  /**
   * Port of the C# `CreateInstance` overloads. `requestType` / `responseType` / `senderType` default to
   * the `VoidResult` sentinel (C# `typeof(Void)`); a string topic is wrapped in a {@link Topic} with the
   * given `version` (default empty).
   */
  static create(
    topic: string | ITopic,
    requestType: ServiceIdentifier<unknown> = VoidResult,
    responseType: ServiceIdentifier<unknown> = VoidResult,
    senderType: ServiceIdentifier<unknown> = VoidResult,
    version = '',
  ): MessageSenderDefinition {
    const resolvedTopic = typeof topic === 'string' ? new Topic(topic, version) : topic;
    return new MessageSenderDefinition(resolvedTopic, requestType, responseType, senderType);
  }

  /** Port of C# `MessageSenderDefinition.Empty()` — the missing-topic, all-`Void` sentinel definition. */
  static empty(): MessageSenderDefinition {
    return new MessageSenderDefinition(Constants.missing, VoidResult, VoidResult, VoidResult);
  }
}

/** Port of Benzene.Extras.Broadcast.BroadcastEventDefinition. */
import { ServiceIdentifier } from '@benzene/abstractions';
import { IMessageDefinition, ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';

/**
 * An {@link IMessageDefinition} describing a broadcastable event: a topic and the payload type it
 * carries.
 * Port of Benzene.Extras.Broadcast.BroadcastEventDefinition.
 *
 * The two C# constructor overloads (`string topic` / `ITopic topic`) collapse into one taking either;
 * C# `Type payloadType` maps to a runtime service identifier (the payload's constructor), as
 * everywhere else in the port.
 */
export class BroadcastEventDefinition implements IMessageDefinition {
  readonly topic: ITopic;

  readonly requestType: ServiceIdentifier<unknown>;

  constructor(topic: string | ITopic, payloadType: ServiceIdentifier<unknown>) {
    this.topic = typeof topic === 'string' ? new Topic(topic) : topic;
    this.requestType = payloadType;
  }
}

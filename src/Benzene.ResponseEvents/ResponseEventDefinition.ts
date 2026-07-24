import { ServiceIdentifier } from '@benzene/abstractions';
import { IMessageDefinition, ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';

/**
 * An {@link IMessageDefinition} describing one event this service publishes as a mapped handler response
 * - the (event topic, payload type) pair surfaced to spec generation by
 * {@link ResponseEventCatalog.findDefinitions}.
 * Port of Benzene.ResponseEvents.ResponseEventDefinition.
 *
 * C# `Type payloadType` maps to a runtime service identifier (a class constructor), stored as the
 * definition's `requestType` - the `IMessageDefinition` payload-type slot.
 */
export class ResponseEventDefinition implements IMessageDefinition {
  readonly topic: ITopic;
  readonly requestType: ServiceIdentifier<unknown>;

  constructor(topic: string | ITopic, payloadType: ServiceIdentifier<unknown>) {
    this.topic = typeof topic === 'string' ? new Topic(topic) : topic;
    this.requestType = payloadType;
  }
}

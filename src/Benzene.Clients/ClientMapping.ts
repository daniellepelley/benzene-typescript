import { IServiceResolver } from '@benzene/abstractions';
import { IBenzeneMessageClient } from './IBenzeneMessageClient';
import { TopicAndServiceKey } from './TopicAndServiceKey';

/**
 * Port of Benzene.Clients.ClientMapping.
 *
 * Associates a set of routing keys with a builder that produces the client for those keys. C# has
 * two constructors — `(string topic, string service, builder)` and `(TopicAndServiceKey[] keys,
 * builder)`; both are preserved here as constructor overloads (distinguishable by first-argument
 * shape). C# `Func<IServiceResolver, IBenzeneMessageClient>` maps to `(resolver) => client`.
 */
export class ClientMapping {
  readonly keys: TopicAndServiceKey[];
  readonly builder: (serviceResolver: IServiceResolver) => IBenzeneMessageClient;

  constructor(topic: string, service: string, builder: (serviceResolver: IServiceResolver) => IBenzeneMessageClient);
  constructor(keys: TopicAndServiceKey[], builder: (serviceResolver: IServiceResolver) => IBenzeneMessageClient);
  constructor(
    topicOrKeys: string | TopicAndServiceKey[],
    serviceOrBuilder: string | ((serviceResolver: IServiceResolver) => IBenzeneMessageClient),
    builder?: (serviceResolver: IServiceResolver) => IBenzeneMessageClient,
  ) {
    if (typeof topicOrKeys === 'string') {
      this.keys = [new TopicAndServiceKey(topicOrKeys, serviceOrBuilder as string)];
      this.builder = builder!;
    } else {
      this.keys = topicOrKeys;
      this.builder = serviceOrBuilder as (serviceResolver: IServiceResolver) => IBenzeneMessageClient;
    }
  }
}

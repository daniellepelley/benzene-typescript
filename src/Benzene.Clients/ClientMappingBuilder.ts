import { TopicAndServiceKey } from './TopicAndServiceKey';

/**
 * Port of Benzene.Clients.ClientMappingBuilder.
 *
 * Fluently accumulates `TopicAndServiceKey`s, rejecting duplicates, then produces the key array a
 * `ClientMapping` is built from. C# `params string[]` maps to rest parameters; C# `string.Empty`
 * maps to `''`.
 */
export class ClientMappingBuilder {
  private readonly topicsAndServiceKeys: TopicAndServiceKey[] = [];

  forService(...services: string[]): ClientMappingBuilder {
    this.addRange(services.map((service) => new TopicAndServiceKey('', service)));
    return this;
  }

  forTopic(...topics: string[]): ClientMappingBuilder {
    this.addRange(topics.map((topic) => new TopicAndServiceKey(topic, '')));
    return this;
  }

  forServiceAndTopic(service: string, topic: string): ClientMappingBuilder {
    this.addRange([new TopicAndServiceKey(topic, service)]);
    return this;
  }

  forTopicAndService(topic: string, ...services: string[]): ClientMappingBuilder {
    this.addRange(services.map((service) => new TopicAndServiceKey(topic, service)));
    return this;
  }

  build(): TopicAndServiceKey[] {
    return [...this.topicsAndServiceKeys];
  }

  private addRange(topicAndServiceKeys: TopicAndServiceKey[]): void {
    for (const topicAndServiceKey of topicAndServiceKeys) {
      if (
        this.topicsAndServiceKeys.some(
          (x) => x.topic === topicAndServiceKey.topic && x.service === topicAndServiceKey.service,
        )
      ) {
        throw new Error('Duplicate client mapping');
      }
      this.topicsAndServiceKeys.push(topicAndServiceKey);
    }
  }
}

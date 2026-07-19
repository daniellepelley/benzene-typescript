/**
 * Port of Benzene.Clients.TopicAndServiceKey.
 *
 * A (topic, service) pair used as a routing key for `ClientMapping` / `BenzeneMessageClientFactory`.
 */
export class TopicAndServiceKey {
  readonly topic: string;
  readonly service: string;

  constructor(topic: string, service: string) {
    this.topic = topic;
    this.service = service;
  }
}

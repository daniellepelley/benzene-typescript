import { IServiceResolver } from '@benzene/abstractions';
import { IBenzeneMessageClient } from './IBenzeneMessageClient';
import { IBenzeneMessageClientFactory } from './IBenzeneMessageClientFactory';
import { ClientMapping } from './ClientMapping';

/**
 * Port of Benzene.Clients.BenzeneMessageClientFactory.
 *
 * Eagerly builds every mapping's client at construction (mirroring C#
 * `clientMapping.ToDictionary(x => x, x => x.Builder(resolver))`) and then resolves one by (service,
 * topic) using the same precedence rules as the C# `Contains` helper: an exact (service, topic)
 * match, or a service-only key with empty topic, or a topic-only key with empty service. C#
 * `string.IsNullOrEmpty` maps to a `!value` check (empty string or `undefined`);
 * `InvalidOperationException` maps to a thrown `Error`.
 */
export class BenzeneMessageClientFactory implements IBenzeneMessageClientFactory {
  private readonly clients: Array<{ key: ClientMapping; client: IBenzeneMessageClient }>;

  constructor(clientMapping: Iterable<ClientMapping>, serviceResolver: IServiceResolver) {
    this.clients = Array.from(clientMapping, (mapping) => ({
      key: mapping,
      client: mapping.builder(serviceResolver),
    }));
  }

  create(service?: string, topic?: string): IBenzeneMessageClient {
    // C# `Create()` (no args) returns the first registered client.
    if (service === undefined && topic === undefined) {
      const first = this.clients[0];
      if (first === undefined) {
        throw new Error('There are no IBenzeneMessageClient registered.');
      }
      return first.client;
    }

    const match = this.clients.find((x) => BenzeneMessageClientFactory.contains(service ?? '', topic ?? '', x.key));

    if (match === undefined) {
      throw new Error(
        `There is no IBenzeneMessageClient registered for service ${service} and topic ${topic}.`,
      );
    }

    return match.client;
  }

  private static contains(service: string, topic: string, clientMapping: ClientMapping): boolean {
    if (service && topic) {
      return (
        clientMapping.keys.some((x) => x.service === service && x.topic === topic) ||
        clientMapping.keys.some((x) => x.service === service && !x.topic) ||
        clientMapping.keys.some((x) => x.topic === topic && !x.service)
      );
    }

    if (service && !topic) {
      return clientMapping.keys.some((x) => x.service === service && !x.topic);
    }

    if (topic && !service) {
      return clientMapping.keys.some((x) => x.topic === topic && !x.service);
    }

    return false;
  }
}

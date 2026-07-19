import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IServiceResolver } from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import { BenzeneResult } from '@benzene/results';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  BenzeneMessageClientFactory,
  ClientMapping,
  IBenzeneMessageClient,
  TopicAndServiceKey,
} from '@benzene/clients';

/**
 * Port of Benzene.Test.Clients.BenzeneMessageClientFactoryTest: the (service, topic) -> client
 * resolution rules (exact match, service-only key, topic-only key), and the not-found throw.
 */

class FakeClient implements IBenzeneMessageClient {
  sendMessageAsync<TRequest, TResponse>(
    _request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    return Promise.resolve(BenzeneResult.ok<TResponse>());
  }
  dispose(): void {}
}

function makeFactory(): BenzeneMessageClientFactory {
  const resolver: IServiceResolver = new DefaultBenzeneServiceContainer()
    .createServiceResolverFactory()
    .createScope();
  const keys = [
    new TopicAndServiceKey('', 'clientCore'),
    new TopicAndServiceKey('client:create', ''),
    new TopicAndServiceKey('tenant:create', 'tenantCore'),
  ];
  const mappings = [new ClientMapping(keys, () => new FakeClient())];
  return new BenzeneMessageClientFactory(mappings, resolver);
}

describe('BenzeneMessageClientFactoryTest', () => {
  // [service, topic, isFound] — the C# theory cases (null -> undefined).
  const cases: Array<[string | undefined, string | undefined, boolean]> = [
    ['tenantCore', '', false],
    ['', 'tenant:create', false],
    ['tenantCore', 'tenant:create', true],
    ['TENANTCORE', 'TENANT:CREATE', false],
    ['tenantCore', 'tenant:delete', false],
    ['clientCore', '', true],
    ['clientCore', undefined, true],
    ['clientCore', 'random:topic', true],
    ['', 'client:create', true],
    [undefined, 'client:create', true],
    ['randomService', 'client:create', true],
    ['randomService', 'random:topic', false],
  ];

  it.each(cases)('Create(%o, %o) isFound=%s', (service, topic, isFound) => {
    const factory = makeFactory();
    if (isFound) {
      expect(factory.create(service, topic)).toBeDefined();
    } else {
      expect(() => factory.create(service, topic)).toThrow();
    }
  });
});

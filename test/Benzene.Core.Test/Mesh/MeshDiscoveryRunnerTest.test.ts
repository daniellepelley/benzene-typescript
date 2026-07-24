import { describe, expect, it } from 'vitest';
import {
  IMeshDiscoveryProvider,
  MeshDiscoveryFilter,
  MeshDiscoveryRunner,
  MeshRegistryJson,
  MeshServiceRegistry,
  MeshServiceRegistryEntry,
  MeshServiceSource,
} from '@benzene/mesh-contracts';

/** Port of test/Benzene.Mesh.Test/Discovery/MeshDiscoveryRunnerTest.cs. */

class FakeProvider implements IMeshDiscoveryProvider {
  private readonly entries: MeshServiceRegistryEntry[];

  constructor(
    readonly key: string,
    ...entries: MeshServiceRegistryEntry[]
  ) {
    this.entries = entries;
  }

  discoverAsync(): Promise<readonly MeshServiceRegistryEntry[]> {
    return Promise.resolve(this.entries);
  }
}

const lambda = (name: string): MeshServiceRegistryEntry =>
  new MeshServiceRegistryEntry(name, '', '', MeshServiceSource.awsLambdaInvoke, { functionName: name });

describe('MeshDiscoveryRunner', () => {
  it('Discover_UnionsProvidersAndSeed', async () => {
    const runner = new MeshDiscoveryRunner([new FakeProvider('aws', lambda('orders'), lambda('billing'))]);
    const seed = new MeshServiceRegistry([
      new MeshServiceRegistryEntry('legacy', 'https://legacy/spec', 'https://legacy/health'),
    ]);

    const registry = await runner.discoverAsync(new MeshDiscoveryFilter(), seed);

    expect(registry.services.map((s) => s.name).sort()).toEqual(['billing', 'legacy', 'orders']);
  });

  it('Discover_StaticSeedWinsOnNameClash', async () => {
    // A hand-pinned entry is an intentional override; discovery must not replace it.
    const runner = new MeshDiscoveryRunner([new FakeProvider('aws', lambda('orders'))]);
    const seed = new MeshServiceRegistry([
      new MeshServiceRegistryEntry('orders', 'https://pinned/spec', 'https://pinned/health'),
    ]);

    const registry = await runner.discoverAsync(new MeshDiscoveryFilter(), seed);

    expect(registry.services).toHaveLength(1);
    expect(registry.services[0]!.source).toBe(MeshServiceSource.http); // the pinned HTTP entry, not the Lambda one
    expect(registry.services[0]!.specUrl).toBe('https://pinned/spec');
  });

  it('Discover_NoProvidersNoSeed_IsEmpty', async () => {
    const runner = new MeshDiscoveryRunner([]);

    const registry = await runner.discoverAsync(new MeshDiscoveryFilter());

    expect(registry.services).toHaveLength(0);
  });

  it('RegistryJson_RoundTripsThroughTheMeshJsonShape', () => {
    const registry = new MeshServiceRegistry([
      lambda('orders'),
      new MeshServiceRegistryEntry('legacy', 'https://legacy/spec', 'https://legacy/health'),
    ]);

    const json = MeshRegistryJson.serialize(registry);
    const back = MeshRegistryJson.deserialize(json);

    expect(json).toContain('"services"');
    expect(json).toContain('"functionName": "orders"'); // camelCase, mesh.json shape
    expect(back.services).toHaveLength(2);
    const orders = back.services.find((s) => s.name === 'orders')!;
    expect(orders.source).toBe(MeshServiceSource.awsLambdaInvoke);
    expect(orders.sourceOptions!.functionName).toBe('orders');
  });

  it('Filter_Matches_RequiresTagPresence_AndExactValueWhenSpecified', () => {
    const defaultFilter = new MeshDiscoveryFilter(); // { benzene: null } => present, any value
    expect(defaultFilter.matches({ benzene: 'true' })).toBe(true);
    expect(defaultFilter.matches({ benzene: 'anything' })).toBe(true);
    expect(defaultFilter.matches({ other: 'x' })).toBe(false);

    const valued = new MeshDiscoveryFilter({ benzene: 'prod' });
    expect(valued.matches({ benzene: 'prod' })).toBe(true);
    expect(valued.matches({ benzene: 'dev' })).toBe(false);
  });
});

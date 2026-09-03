/**
 * Port of test/Benzene.Mesh.Test/MeshCollectorSideBySideVersionTest.cs (.NET round-16 #251, fixed):
 * mesh spec §2.4 requires "a collector's catalog key is the pair (service, serviceVersion) - two
 * releases deployed side by side are two catalog entries rather than one silently overwriting the
 * other" and explicitly rules that "two different versions reporting different hashes is NOT drift".
 * `MeshCollectorStore` keys its internal per-service state by `serviceVersion ?? ''`: `register` for
 * a new version no longer evicts a still-live sibling version's descriptor, and
 * `ServiceView.instances[].hashMatches` is computed against EVERY currently registered version's hash
 * for the service, not just the "current"/latest one - so each instance matches against its own
 * version's descriptor rather than whichever version registered last.
 *
 * View-shape note (a documented divergence from the C# original's [RESOLVED] choice): the
 * `benzene:mesh:query:service` view stays one-per-NAME (the headline version), like C# - but the FLEET
 * list here carries one row per live (service, serviceVersion) entry, because the canonical
 * `mesh-service-version-cases.json` fixture (vendored but unrun in the .NET repo) asserts exactly
 * that, and the fixture wins over the port.
 */
import { describe, expect, it } from 'vitest';
import { MeshCollectorStore } from '@benzenejs/mesh-collector';
import {
  MeshDescriptorHashing,
  MeshHeartbeat,
  MeshServiceDescriptor,
  MeshTopicDescriptor,
} from '@benzenejs/mesh-wire';

function descriptor(service: string, version: string, topic: string): MeshServiceDescriptor {
  const value = new MeshServiceDescriptor();
  value.service = service;
  value.serviceVersion = version;
  value.topics = [];
  const produced = new MeshTopicDescriptor();
  produced.id = topic;
  value.produces = [produced];
  value.descriptorHash = MeshDescriptorHashing.computeHash(value);
  return value;
}

function heartbeat(service: string, instanceId: string, descriptorHash: string | undefined): MeshHeartbeat {
  const value = new MeshHeartbeat();
  value.service = service;
  value.instanceId = instanceId;
  value.descriptorHash = descriptorHash;
  return value;
}

describe('MeshCollectorSideBySideVersionTest', () => {
  it('TwoSideBySideVersions_BothCatalogEntriesLive_EachInstanceMatchesItsOwnVersion', () => {
    const store = new MeshCollectorStore();

    // Two releases of "orders" running side by side (a canary), each providing a DIFFERENT topic
    // - a completely healthy, spec-legal state (§2.4).
    const v1 = descriptor('orders', '1.0.0', 'order:created:v1');
    const v2 = descriptor('orders', '2.0.0', 'order:created:v2');

    store.register(v1);
    store.heartbeat(heartbeat('orders', 'v1-instance', v1.descriptorHash));

    store.register(v2);
    store.heartbeat(heartbeat('orders', 'v2-instance', v2.descriptorHash));

    // v1's contract is NOT evicted - its provided topic still shows "orders" as the provider, even
    // though v2 registered afterwards under the same service name.
    const v1Topic = store.topic('order:created:v1', undefined);
    const v2Topic = store.topic('order:created:v2', undefined);
    expect(v1Topic).toBeDefined();
    expect(v1Topic!.providers).toContain('orders');
    expect(v2Topic).toBeDefined();
    expect(v2Topic!.providers).toContain('orders');

    const view = store.service('orders');
    expect(view).toBeDefined();

    const v1Instance = view!.instances.find((i) => i.instanceId === 'v1-instance')!;
    const v2Instance = view!.instances.find((i) => i.instanceId === 'v2-instance')!;

    // Each instance's own, correctly-computed hash is compared against its OWN version's descriptor
    // (not just whichever version happens to be "current") - two live versions reporting two
    // different, individually-correct hashes is the expected side-by-side deployment state, not
    // drift (§2.4).
    expect(v1Instance.hashMatches).toBe(true);
    expect(v2Instance.hashMatches).toBe(true);
  });

  it('SameVersionReregisteredWithADifferentHash_IsFlaggedAsDrift', () => {
    const store = new MeshCollectorStore();

    // A real drift scenario (§2.4's OTHER case): the SAME (service, version) pair re-registers with a
    // different descriptor hash - a silent contract change without a version bump.
    const v1Original = descriptor('orders', '1.0.0', 'order:created:v1');
    store.register(v1Original);
    store.heartbeat(heartbeat('orders', 'stale-instance', v1Original.descriptorHash));

    // "orders" 1.0.0 redeploys with a changed contract (a second produced topic) but the SAME version
    // string - a genuinely different hash under the same catalog key.
    const v1Updated = descriptor('orders', '1.0.0', 'order:created:v1');
    const extra = new MeshTopicDescriptor();
    extra.id = 'order:created:v1-extra';
    v1Updated.produces.push(extra);
    v1Updated.descriptorHash = MeshDescriptorHashing.computeHash(v1Updated);
    expect(v1Updated.descriptorHash).not.toBe(v1Original.descriptorHash);
    store.register(v1Updated);

    const view = store.service('orders');
    expect(view).toBeDefined();
    const staleInstance = view!.instances.find((i) => i.instanceId === 'stale-instance')!;

    // The instance still reporting the OLD hash for the SAME version no longer matches any live
    // descriptor for "orders" - this IS drift, and must still be flagged as such.
    expect(staleInstance.hashMatches).toBe(false);
  });
});

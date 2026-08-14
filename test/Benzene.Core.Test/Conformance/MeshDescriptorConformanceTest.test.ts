/**
 * Runs docs/specification/conformance/mesh-descriptor-cases.json against the TypeScript port: derives
 * the ServiceDescriptor (mesh.md §2) from the canonical conformance handlers and asserts the derived
 * payload schemas plus the descriptorHash's format/invariance/sensitivity properties. `runtime` and
 * the hash value are per-port by design and not pinned by the fixture.
 *
 * The one divergence from the C# conformance test: where .NET recovers the §2.1 schemas by reflecting
 * over the handler request/response types, this port injects them via a `MapMeshSchemaProvider` (types
 * are erased at runtime - see `@benzenejs/mesh-wire`'s `MeshSchemaProvider`). The schemas supplied here
 * are exactly the fixture's expected schemas, so the test still pins the §2.1 mapping's output.
 */
import { describe, expect, it } from 'vitest';
import { Constructor } from '@benzenejs/abstractions';
import {
  IMessageHandlerDefinition,
  IMessageHandlerDefinitionLookUp,
} from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { RegistryMessageHandlersFinder } from '@benzenejs/core-message-handlers';
import {
  MapMeshSchemaProvider,
  MeshDescriptorFactory,
  MeshJson,
  MeshPlacement,
  MeshServiceInfo,
} from '@benzenejs/mesh-wire';
import { findSubsetMismatch, load } from './ConformanceFixtures';
import {
  GreetConformanceHandler,
  GreetReply,
  GreetRequest,
} from './Handlers/GreetConformanceHandler';
import {
  StatusConformanceHandler,
  StatusReply,
  StatusRequest,
} from './Handlers/StatusConformanceHandler';
import { PanicConformanceHandler } from './Handlers/PanicConformanceHandler';

interface DescriptorFixture {
  serviceInfo: {
    service: string;
    serviceVersion?: string;
    placement: { cloud: string; region?: string };
  };
  expectedDescriptor: unknown;
  hash: {
    prefix: string;
    hexLength: number;
    invariantToInstanceId: boolean;
    sensitiveToServiceVersion: boolean;
    sensitiveToTopics: boolean;
  };
}

const fixture = load<DescriptorFixture>('mesh-descriptor-cases.json');

// The §2.1 schemas the port would derive from the canonical handlers, supplied explicitly because
// TypeScript erases the request/response types at runtime. These match the fixture's expected schemas.
const schemaProvider = new MapMeshSchemaProvider({
  'conformance:greet': {
    request: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    response: {
      type: 'object',
      properties: { greeting: { type: 'string' } },
      required: ['greeting'],
    },
  },
  'conformance:status': {
    request: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        errors: { type: 'array', items: { type: 'string' } },
      },
      required: ['status'],
    },
    response: {
      type: 'object',
      properties: { applied: { type: 'string' } },
      required: ['applied'],
    },
  },
});

function info(instanceId?: string, serviceVersion?: string): MeshServiceInfo {
  const placement = new MeshPlacement();
  placement.cloud = fixture.serviceInfo.placement.cloud;
  placement.region = fixture.serviceInfo.placement.region;
  return new MeshServiceInfo(
    fixture.serviceInfo.service,
    serviceVersion ?? fixture.serviceInfo.serviceVersion,
    instanceId,
    undefined,
    placement,
  );
}

/** Minimal lookup over an explicit definition list - the port of the C# test's `DefinitionsLookUp`. */
class DefinitionsLookUp implements IMessageHandlerDefinitionLookUp {
  constructor(private readonly definitions: IMessageHandlerDefinition[]) {}

  findHandler(topic: ITopic): IMessageHandlerDefinition | undefined {
    return this.definitions.find(
      (x) => x.topic.id === topic.id && x.topic.version === topic.version,
    );
  }

  getAllHandlers(): IMessageHandlerDefinition[] {
    return this.definitions;
  }
}

function canonicalLookUp(...extraHandlerTypes: Constructor<unknown>[]): DefinitionsLookUp {
  const types: Constructor<unknown>[] = [
    GreetConformanceHandler,
    StatusConformanceHandler,
    ...extraHandlerTypes,
  ];
  return new DefinitionsLookUp(new RegistryMessageHandlersFinder(...types).findDefinitions());
}

// Reference the handlers' payload types so their imports are load-bearing (and the classes register).
void GreetRequest;
void GreetReply;
void StatusRequest;
void StatusReply;

describe('MeshDescriptorConformanceTest', () => {
  it('derives the expected descriptor', () => {
    const descriptor = MeshDescriptorFactory.create(canonicalLookUp(), info(), schemaProvider);

    const actual = JSON.parse(MeshJson.serialize(descriptor)) as unknown;
    const mismatch = findSubsetMismatch(fixture.expectedDescriptor, actual);
    expect(mismatch, mismatch ?? undefined).toBeNull();
  });

  it('produces a descriptorHash with the wire format', () => {
    const hash = MeshDescriptorFactory.create(canonicalLookUp(), info(), schemaProvider).descriptorHash;

    expect(hash).toBeDefined();
    expect(hash!.startsWith(fixture.hash.prefix)).toBe(true);
    expect(hash!.length).toBe(fixture.hash.prefix.length + fixture.hash.hexLength);
    expect(hash!.substring(fixture.hash.prefix.length)).toMatch(/^[0-9a-f]+$/);
  });

  it('produces a descriptorHash invariant to instanceId', () => {
    if (!fixture.hash.invariantToInstanceId) return;

    const first = MeshDescriptorFactory.create(canonicalLookUp(), info('instance-1'), schemaProvider);
    const second = MeshDescriptorFactory.create(canonicalLookUp(), info('instance-2'), schemaProvider);

    expect(first.descriptorHash).toBe(second.descriptorHash);
  });

  it('produces a descriptorHash sensitive to serviceVersion', () => {
    if (!fixture.hash.sensitiveToServiceVersion) return;

    const baseline = MeshDescriptorFactory.create(canonicalLookUp(), info(), schemaProvider);
    const bumped = MeshDescriptorFactory.create(
      canonicalLookUp(),
      info(undefined, `${fixture.serviceInfo.serviceVersion}-changed`),
      schemaProvider,
    );

    expect(baseline.descriptorHash).not.toBe(bumped.descriptorHash);
  });

  it('produces a descriptorHash sensitive to the topic set', () => {
    if (!fixture.hash.sensitiveToTopics) return;

    const baseline = MeshDescriptorFactory.create(canonicalLookUp(), info(), schemaProvider);
    const grown = MeshDescriptorFactory.create(
      canonicalLookUp(PanicConformanceHandler),
      info(),
      schemaProvider,
    );

    expect(baseline.descriptorHash).not.toBe(grown.descriptorHash);
  });

  it('degrades the feed, not the descriptor, when the registry is missing', () => {
    const descriptor = MeshDescriptorFactory.create(undefined, info(), schemaProvider);

    expect(descriptor.topics).toHaveLength(0);
    expect(descriptor.degraded).toEqual([MeshDescriptorFactory.registryFeed]);
    expect(descriptor.service).toBe(fixture.serviceInfo.service);
    expect(descriptor.descriptorHash).toBeDefined();
  });
});

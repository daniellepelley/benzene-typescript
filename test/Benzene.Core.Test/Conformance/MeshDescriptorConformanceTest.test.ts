/**
 * Runs docs/specification/conformance/mesh-descriptor-cases.json against the TypeScript port: derives
 * the ServiceDescriptor (mesh.md §2) from the canonical conformance handlers (`topics`) plus the
 * canonical outbound registration (`consumes`, mesh.md §2.3) and asserts the derived payload schemas
 * plus the descriptorHash's format/invariance/sensitivity properties, including its sensitivity to the
 * consumed-topic set (the 2026-08 revision). `runtime` and the hash value are per-port by design and
 * not pinned by the fixture.
 *
 * Divergences from the C# conformance test: where .NET recovers the §2.1 schemas by reflecting over
 * the handler/sender request-response types, this port injects them via a `MapMeshSchemaProvider`
 * (types are erased at runtime - see `@benzenejs/mesh-wire`'s `MeshSchemaProvider`). The schemas
 * supplied here are exactly the fixture's expected schemas, so the test still pins the §2.1 mapping's
 * output. The canonical outbound registration (README.md's `conformance:log`, no handler) is expressed
 * with `MessageSenderDefinition` + `DependencyMessageSendersFinder` (`@benzenejs/core-messages`) - the
 * sender-side counterpart of the handler registry, mirroring inbound discovery exactly.
 */
import { describe, expect, it } from 'vitest';
import { Constructor } from '@benzenejs/abstractions';
import {
  IMessageHandlerDefinition,
  IMessageHandlerDefinitionLookUp,
} from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { RegistryMessageHandlersFinder } from '@benzenejs/core-message-handlers';
import { DependencyMessageSendersFinder, MessageSenderDefinition } from '@benzenejs/core-messages';
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
  // Optional on purpose, so a key the fixture does not carry is distinguishable from a key set to
  // false. See `asserted` below for why that distinction is load-bearing.
  hash: {
    prefix: string;
    hexLength: number;
    invariantToInstanceId?: boolean;
    sensitiveToServiceVersion?: boolean;
    sensitiveToTopics?: boolean;
    sensitiveToProduces?: boolean;
  };
}

/**
 * Whether the fixture asks for a hash property - throwing if the fixture does not mention it at all.
 *
 * This test spent the whole producer/consumer role inversion reading `sensitiveToConsumes` after the
 * fixture had renamed the key to `sensitiveToProduces`. Read as a plain boolean that was simply
 * `undefined`, the `if (!...) return;` guard turned the test into an empty function that passed, so
 * a green suite said nothing about whether the hash covered produced topics at all. A key the
 * fixture does not carry is drift between test and fixture - never permission to stop checking.
 */
function asserted(flag: boolean | undefined, key: string): boolean {
  if (flag === undefined) {
    throw new Error(`fixture hash section has no "${key}" - the test and the fixture have drifted`);
  }
  return flag;
}

const fixture = load<DescriptorFixture>('mesh-descriptor-cases.json');

// The §2.1 schemas the port would derive from the canonical handlers/outbound registration, supplied
// explicitly because TypeScript erases the request/response types at runtime. These match the
// fixture's expected schemas - `conformance:log` (the canonical outbound registration, README.md)
// declares no response type, so its responseSchema is `{}` (unconstrained), per §2.3.
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
  'conformance:log': {
    request: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    response: {},
  },
});

/** The canonical outbound registration's request payload (README.md's `conformance:log`). */
class LogRequest {
  message = '';
}

/**
 * The canonical outbound registration (docs/specification/conformance/README.md): one registered
 * `IMessageSenderDefinition` for `conformance:log` - no handler, since nothing here receives (mesh.md
 * §2.3). `DependencyMessageSendersFinder` mirrors `IMessageHandlerDefinitionLookUp`'s role for
 * `topics`, projected into `consumes`.
 */
function canonicalSendersFinder(): DependencyMessageSendersFinder {
  return new DependencyMessageSendersFinder([MessageSenderDefinition.create('conformance:log', LogRequest)]);
}

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
    const descriptor = MeshDescriptorFactory.create(
      canonicalLookUp(),
      info(),
      schemaProvider,
      canonicalSendersFinder(),
    );

    const actual = JSON.parse(MeshJson.serialize(descriptor)) as unknown;
    const mismatch = findSubsetMismatch(fixture.expectedDescriptor, actual);
    expect(mismatch, mismatch ?? undefined).toBeNull();
  });

  it('produces a descriptorHash with the wire format', () => {
    const hash = MeshDescriptorFactory.create(
      canonicalLookUp(),
      info(),
      schemaProvider,
      canonicalSendersFinder(),
    ).descriptorHash;

    expect(hash).toBeDefined();
    expect(hash!.startsWith(fixture.hash.prefix)).toBe(true);
    expect(hash!.length).toBe(fixture.hash.prefix.length + fixture.hash.hexLength);
    expect(hash!.substring(fixture.hash.prefix.length)).toMatch(/^[0-9a-f]+$/);
  });

  it('produces a descriptorHash invariant to instanceId', () => {
    if (!asserted(fixture.hash.invariantToInstanceId, 'invariantToInstanceId')) return;

    const first = MeshDescriptorFactory.create(
      canonicalLookUp(),
      info('instance-1'),
      schemaProvider,
      canonicalSendersFinder(),
    );
    const second = MeshDescriptorFactory.create(
      canonicalLookUp(),
      info('instance-2'),
      schemaProvider,
      canonicalSendersFinder(),
    );

    expect(first.descriptorHash).toBe(second.descriptorHash);
  });

  it('produces a descriptorHash sensitive to serviceVersion', () => {
    if (!asserted(fixture.hash.sensitiveToServiceVersion, 'sensitiveToServiceVersion')) return;

    const baseline = MeshDescriptorFactory.create(
      canonicalLookUp(),
      info(),
      schemaProvider,
      canonicalSendersFinder(),
    );
    const bumped = MeshDescriptorFactory.create(
      canonicalLookUp(),
      info(undefined, `${fixture.serviceInfo.serviceVersion}-changed`),
      schemaProvider,
      canonicalSendersFinder(),
    );

    expect(baseline.descriptorHash).not.toBe(bumped.descriptorHash);
  });

  it('produces a descriptorHash sensitive to the topic set', () => {
    if (!asserted(fixture.hash.sensitiveToTopics, 'sensitiveToTopics')) return;

    const baseline = MeshDescriptorFactory.create(
      canonicalLookUp(),
      info(),
      schemaProvider,
      canonicalSendersFinder(),
    );
    const grown = MeshDescriptorFactory.create(
      canonicalLookUp(PanicConformanceHandler),
      info(),
      schemaProvider,
      canonicalSendersFinder(),
    );

    expect(baseline.descriptorHash).not.toBe(grown.descriptorHash);
  });

  it('produces a descriptorHash sensitive to the produced-topic set', () => {
    if (!asserted(fixture.hash.sensitiveToProduces, 'sensitiveToProduces')) return;

    const baseline = MeshDescriptorFactory.create(
      canonicalLookUp(),
      info(),
      schemaProvider,
      canonicalSendersFinder(),
    );
    const grown = MeshDescriptorFactory.create(
      canonicalLookUp(),
      info(),
      schemaProvider,
      new DependencyMessageSendersFinder([
        MessageSenderDefinition.create('conformance:log', LogRequest),
        MessageSenderDefinition.create('conformance:audit', LogRequest),
      ]),
    );

    expect(baseline.descriptorHash).not.toBe(grown.descriptorHash);
  });

  it('degrades the registry feed, not the descriptor, when the handler registry is missing', () => {
    // sendersFinder still supplied, so only the inbound (`topics`) feed is degraded - isolates the
    // registry-side degradation from the outbound-registry-side degradation asserted below.
    const descriptor = MeshDescriptorFactory.create(undefined, info(), schemaProvider, canonicalSendersFinder());

    expect(descriptor.topics).toHaveLength(0);
    expect(descriptor.produces).toHaveLength(1);
    expect(descriptor.degraded).toEqual([MeshDescriptorFactory.registryFeed]);
    expect(descriptor.service).toBe(fixture.serviceInfo.service);
    expect(descriptor.descriptorHash).toBeDefined();
  });

  it('degrades the outbound-registry feed, not an empty produces, when no sendersFinder is supplied', () => {
    // Per mesh.md §2.3: a port that hasn't wired outbound registration MUST mark `produces` degraded
    // rather than assert "produces nothing" via an empty array.
    const descriptor = MeshDescriptorFactory.create(canonicalLookUp(), info(), schemaProvider);

    expect(descriptor.produces).toHaveLength(0);
    expect(descriptor.topics).toHaveLength(2);
    expect(descriptor.degraded).toEqual([MeshDescriptorFactory.outboundRegistryFeed]);
  });

  it('degrades both feeds when neither the registry nor a sendersFinder is supplied', () => {
    const descriptor = MeshDescriptorFactory.create(undefined, info(), schemaProvider);

    expect(descriptor.degraded).toEqual([
      MeshDescriptorFactory.registryFeed,
      MeshDescriptorFactory.outboundRegistryFeed,
    ]);
  });
});

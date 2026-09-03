/** Port of Benzene.Mesh.Wire.MeshDescriptorFactory (and MeshDescriptorHashing). */
import { createHash } from 'node:crypto';
import { IMessageHandlerDefinitionLookUp } from '@benzenejs/abstractions-message-handlers';
import { IMessageSendersFinder, ITopic } from '@benzenejs/abstractions-messages';
import { MeshJson } from './MeshJson';
import {
  MeshPlacement,
  MeshServiceDescriptor,
  MeshTopicDescriptor,
} from './MeshServiceDescriptor';
import { MeshServiceInfo } from './MeshServiceInfo';
import { IMeshSchemaProvider, NoMeshSchemaProvider } from './MeshSchemaProvider';

/** Ordinal (code-unit) string comparison - the port of C# `StringComparer.Ordinal`. */
function ordinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Builds the ServiceDescriptor (docs/specification/mesh.md §2) from the live message-handler
 * registry (what the service **provides**), the outbound registration (§2.3, what it **produces**),
 * plus static identity. Call it after registration is complete (registration is a startup activity).
 * An undefined `lookUp`/`sendersFinder` is not an error: per the spec's degradation rule (§6) the
 * descriptor is built without that list and the missing feed is recorded in `degraded`, so a service
 * whose registry or outbound-registry feed isn't wired up still participates in the mesh reduced,
 * rather than not at all.
 *
 * Divergences from C#: the schemas come from an injected `IMeshSchemaProvider` (keyed by topic)
 * instead of CLR reflection over the request/response types - see `MeshSchemaProvider`. Outbound
 * registration mirrors inbound handler discovery (core-concepts.md §9, mesh.md §2.3): `IMessageHandlerDefinitionLookUp`'s
 * sender-side counterpart is `@benzenejs/abstractions-messages`' `IMessageSendersFinder` - already
 * present in this port for the OpenAPI/AsyncAPI spec builders - so no new abstraction was needed, just
 * a second, optional source the factory projects the same way. Everything else (topic ordering,
 * degradation, hashing) matches the original.
 */
export const MeshDescriptorFactory = {
  registryFeed: 'registry',

  /** Names the outbound-registration feed in `degraded` (spec §2/§2.3) when no `sendersFinder` is supplied. */
  outboundRegistryFeed: 'outbound-registry',

  create(
    lookUp: IMessageHandlerDefinitionLookUp | undefined,
    info: MeshServiceInfo,
    schemaProvider: IMeshSchemaProvider = new NoMeshSchemaProvider(),
    sendersFinder?: IMessageSendersFinder,
  ): MeshServiceDescriptor {
    const descriptor = new MeshServiceDescriptor();
    descriptor.service = info.service;
    descriptor.serviceVersion = info.serviceVersion;
    descriptor.instanceId = info.instanceId;
    descriptor.binding = info.binding;
    descriptor.placement = placementFor(info.placement);

    const degraded: string[] = [];

    if (lookUp === undefined) {
      degraded.push(MeshDescriptorFactory.registryFeed);
    } else {
      descriptor.topics = lookUp
        .getAllHandlers()
        .slice()
        .sort((a, b) => ordinal(a.topic.id, b.topic.id) || ordinal(a.topic.version, b.topic.version))
        .map((definition) => topicDescriptorFor(definition.topic, schemaProvider));
    }

    if (sendersFinder === undefined) {
      degraded.push(MeshDescriptorFactory.outboundRegistryFeed);
    } else {
      descriptor.produces = sendersFinder
        .findDefinitions()
        .slice()
        .sort((a, b) => ordinal(a.topic.id, b.topic.id) || ordinal(a.topic.version, b.topic.version))
        .map((definition) => topicDescriptorFor(definition.topic, schemaProvider));
    }

    if (degraded.length > 0) {
      descriptor.degraded = degraded;
    }

    descriptor.descriptorHash = MeshDescriptorHashing.computeHash(descriptor);
    return descriptor;
  },
} as const;

function topicDescriptorFor(topic: ITopic, schemaProvider: IMeshSchemaProvider): MeshTopicDescriptor {
  const schemas = schemaProvider.getSchemas(topic);
  const descriptor = new MeshTopicDescriptor();
  descriptor.id = topic.id;
  descriptor.version = topic.version ? topic.version : undefined;
  descriptor.requestSchema = schemas.request;
  descriptor.responseSchema = schemas.response;
  return descriptor;
}

function placementFor(placement: MeshPlacement | undefined): MeshPlacement {
  const result = new MeshPlacement();
  if (placement === undefined) {
    result.cloud = 'self-hosted';
  } else {
    result.cloud = placement.cloud;
    result.region = placement.region;
  }
  return result;
}

/**
 * The contract hash of docs/specification/mesh.md §2.2: `"sha256:" + lowercase-hex(sha256(...))` over
 * the descriptor's canonical JSON with the per-instance (`instanceId`) and transient
 * (`degraded`/`profile`/`descriptorHash`) fields blanked - two instances of one build hash
 * identically, and the hash changes exactly when the contract changes.
 *
 * Canonical JSON per §2.2: object members in a fixed documented order - declaration order for the
 * fixed descriptor shape, lexicographic for schema maps - with no insignificant whitespace. Because
 * `runtime` participates, the hash is per-port by design and is never compared across ports.
 */
export const MeshDescriptorHashing = {
  computeHash(descriptor: MeshServiceDescriptor): string {
    const json = MeshJson.serialize(canonicalDescriptor(descriptor));
    const hash = createHash('sha256').update(json, 'utf8').digest('hex');
    return `sha256:${hash}`;
  },
} as const;

/**
 * Rebuilds the descriptor as a plain object with the §2.2 canonical member order: the fixed
 * descriptor/placement/topic fields in declaration order, schema objects with lexicographically
 * sorted keys. `instanceId`/`degraded`/`profile`/`descriptorHash` are blanked (omitted). Building an
 * object with keys inserted in this order and stringifying it yields the canonical bytes, because
 * `JSON.stringify` preserves insertion order and omits `undefined`.
 */
function canonicalDescriptor(descriptor: MeshServiceDescriptor): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  canonical['service'] = descriptor.service;
  if (descriptor.serviceVersion !== undefined) {
    canonical['serviceVersion'] = descriptor.serviceVersion;
  }
  // instanceId blanked (§2.2)
  canonical['runtime'] = descriptor.runtime;
  if (descriptor.binding !== undefined) {
    canonical['binding'] = descriptor.binding;
  }
  canonical['placement'] = canonicalPlacement(descriptor.placement);
  canonical['topics'] = descriptor.topics.map(canonicalTopic);
  canonical['produces'] = descriptor.produces.map(canonicalTopic);
  // descriptorHash, degraded, profile blanked (§2.2)
  return canonical;
}

function canonicalPlacement(placement: MeshPlacement): Record<string, unknown> {
  const canonical: Record<string, unknown> = { cloud: placement.cloud };
  if (placement.region !== undefined) {
    canonical['region'] = placement.region;
  }
  return canonical;
}

function canonicalTopic(topic: MeshTopicDescriptor): Record<string, unknown> {
  const canonical: Record<string, unknown> = { id: topic.id };
  if (topic.version !== undefined) {
    canonical['version'] = topic.version;
  }
  if (topic.requestSchema !== undefined) {
    canonical['requestSchema'] = canonicalSchema(topic.requestSchema);
  }
  if (topic.responseSchema !== undefined) {
    canonical['responseSchema'] = canonicalSchema(topic.responseSchema);
  }
  return canonical;
}

/**
 * Recursively sorts object keys lexicographically (the §2.2 canonical order for schema maps). Arrays keep
 * their semantic order, with one exception: a `required` member's string array is sorted ordinally, matching
 * .NET's `MeshSchemaGenerator` (`StringComparer.Ordinal`). `required` is a set — its order carries no
 * meaning — so a provider that emits it in property-declaration order must not change the contract hash;
 * every other array (`enum`, `oneOf`, a `type` union, …) is order-significant and left alone.
 */
function canonicalSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalSchema);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const member = source[key];
      sorted[key] =
        key === 'required' && Array.isArray(member) && member.every((item) => typeof item === 'string')
          ? [...member].sort()
          : canonicalSchema(member);
    }
    return sorted;
  }
  return value;
}

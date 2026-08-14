/**
 * Builds this service's normative mesh **ServiceDescriptor** (docs/specification/mesh.md §2) - the
 * cross-language self-description a collector reads over the reserved `mesh` topic. Unlike the
 * `/benzene/spec` HTTP descriptor (which an aggregator *polls*), the ServiceDescriptor is the shape a
 * .NET, Go, or TypeScript service emits identically, carries a per-port `descriptorHash` (§2.2), and
 * is derived here from the same running `registry` - never hand-maintained.
 *
 * The topic list and identity come from `MeshDescriptorFactory`; the §2.1 payload schemas are supplied
 * by a `MapMeshSchemaProvider` (TypeScript erases the request/response types at runtime, so the port
 * injects schemas rather than reflecting - see `@benzenejs/mesh-wire`).
 */
import {
  IMessageHandlerDefinition,
  IMessageHandlerDefinitionLookUp,
} from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import {
  MessageHandlersRegistry,
  RegistryMessageHandlersFinder,
} from '@benzenejs/core-message-handlers';
import {
  MapMeshSchemaProvider,
  MeshDescriptorFactory,
  MeshPlacement,
  MeshServiceDescriptor,
  MeshServiceInfo,
} from '@benzenejs/mesh-wire';

/** The §2.1 schemas for this service's topics, keyed by topic id. */
const schemaProvider = new MapMeshSchemaProvider({
  'order:create': {
    request: { type: 'object', properties: { customerId: { type: 'string' } } },
    response: { type: 'object', properties: { orderId: { type: 'string' } } },
  },
  'order:get': {
    request: {
      type: 'object',
      properties: { orderId: { type: 'string' }, status: { type: 'string' } },
    },
    response: {
      type: 'object',
      properties: { orderId: { type: 'string' }, status: { type: 'string' } },
    },
  },
});

/** Minimal lookup over the registry's definitions, for `MeshDescriptorFactory`. */
class RegistryDefinitionsLookUp implements IMessageHandlerDefinitionLookUp {
  private readonly definitions: IMessageHandlerDefinition[];

  constructor(registry: MessageHandlersRegistry) {
    this.definitions = new RegistryMessageHandlersFinder(registry).findDefinitions();
  }

  findHandler(topic: ITopic): IMessageHandlerDefinition | undefined {
    return this.definitions.find(
      (x) => x.topic.id === topic.id && x.topic.version === topic.version,
    );
  }

  getAllHandlers(): IMessageHandlerDefinition[] {
    return this.definitions;
  }
}

/** Derives the normative ServiceDescriptor from the running registry. */
export function buildDescriptor(registry: MessageHandlersRegistry): MeshServiceDescriptor {
  const placement = new MeshPlacement();
  placement.cloud = 'self-hosted';

  const info = new MeshServiceInfo('orders', '1.0.0', undefined, 'http', placement);
  return MeshDescriptorFactory.create(new RegistryDefinitionsLookUp(registry), info, schemaProvider);
}

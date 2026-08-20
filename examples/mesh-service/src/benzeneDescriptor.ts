/**
 * Builds this service's normative mesh **ServiceDescriptor** (docs/specification/mesh.md §2) - the
 * cross-language self-description a collector reads over the reserved `benzene:mesh` topic. Unlike the
 * `/benzene/spec` HTTP descriptor (which an aggregator *polls*), the ServiceDescriptor is the shape a
 * .NET, Go, or TypeScript service emits identically, carries a per-port `descriptorHash` (§2.2), and
 * is derived here from the same running `registry` (what it **provides**, `topics`) plus an explicit
 * outbound registration (§2.3, what it **consumes**) - neither is ever hand-maintained.
 *
 * `order:create` demonstrates the outbound half: in a real deployment it would call downstream to
 * capture payment (exactly the orders -> payments chain `examples/k8s-mesh` actually wires end to end),
 * so it declares `payments:capture` here - no handler, no destination address, since §2.3 registration
 * is a pure contract declaration, not a live client. Declaring it (rather than staying silent) is what
 * lets a collector build the `orders -> payments` consumer edge from this descriptor alone, before a
 * single message has ever flowed (mesh.md §4).
 *
 * The topic lists and identity come from `MeshDescriptorFactory`; the §2.1 payload schemas are supplied
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
import { DependencyMessageSendersFinder, MessageSenderDefinition } from '@benzenejs/core-messages';
import {
  MapMeshSchemaProvider,
  MeshDescriptorFactory,
  MeshPlacement,
  MeshServiceDescriptor,
  MeshServiceInfo,
} from '@benzenejs/mesh-wire';

/** The §2.1 schemas for this service's provided AND consumed topics, keyed by topic id. */
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
  'payments:capture': {
    request: { type: 'object', properties: { orderId: { type: 'string' } } },
    response: {},
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

/** `payments:capture` outbound request payload (the downstream call `order:create` would make). */
class CapturePaymentRequest {
  orderId?: string;
}

/**
 * This service's outbound registration (mesh.md §2.3): the one topic it may send, with no handler and
 * no destination address - `DependencyMessageSendersFinder` mirrors `RegistryDefinitionsLookUp` above
 * for the outbound side, over an explicit list rather than a container resolve.
 */
const consumesFinder = new DependencyMessageSendersFinder([
  MessageSenderDefinition.create('payments:capture', CapturePaymentRequest),
]);

/** Derives the normative ServiceDescriptor from the running registry (`topics`) plus the outbound registration (`consumes`). */
export function buildDescriptor(registry: MessageHandlersRegistry): MeshServiceDescriptor {
  const placement = new MeshPlacement();
  placement.cloud = 'self-hosted';

  const info = new MeshServiceInfo('orders', '1.0.0', undefined, 'http', placement);
  return MeshDescriptorFactory.create(
    new RegistryDefinitionsLookUp(registry),
    info,
    schemaProvider,
    consumesFinder,
  );
}

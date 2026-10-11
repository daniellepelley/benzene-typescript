/** Port of Benzene.Mesh.Wire.MeshOutboundRegistry. */
import { IBenzeneServiceContainer, VoidResult } from '@benzenejs/abstractions';
import {
  IMeshOutboundDefinitionLookUp,
  IMessageSenderDefinition,
  OutboundDeclaration,
} from '@benzenejs/abstractions-messages';
import { MessageSenderDefinition } from '@benzenejs/core-messages';

/**
 * The explicit outbound registration every port supports (contract-document.md §3.3): an application hands
 * it the topics it puts on the wire, each declared as an **event** (a topic this service publishes and
 * defines) or a **send** (a message to a topic another party defines) — no handler, since nothing here
 * receives, and no destination, since that is deployment configuration.
 *
 * ```ts
 * const outbound = new MeshOutboundRegistry()
 *   .register({ kind: 'event', topic: 'order:placed', message: OrderPlaced })
 *   .register({ kind: 'send', topic: 'payment:take', request: TakePayment })
 *   .register({ kind: 'send', topic: 'inventory:reserve', request: Reserve, response: Reservation });
 * ```
 *
 * One registry feeds both self-descriptions: the Contract Document's `events[]` and `sends[]`, and the mesh
 * descriptor's `produces` (events ∪ sends). Register it with {@link addMeshOutbound}, or hand it to a cloud
 * service's `withOutbound`.
 *
 * Divergence from C#: `Register<TRequest[, TResponse]>` cannot tell an event from a send (both are one
 * record shape there); the port takes a declaration discriminated by `kind` instead (design §10.3). Declaring
 * one (topic, version) as both an event and a send is a start-up error (contract-document.md §3.3), thrown
 * here at registration. Build it once at start-up, like the inbound handler registry.
 */
export class MeshOutboundRegistry implements IMeshOutboundDefinitionLookUp {
  private readonly declarations: OutboundDeclaration[] = [];

  /** Registers one declaration. Throws if its (topic, version) is already declared differently. */
  register(declaration: OutboundDeclaration): this {
    const version = declaration.version ?? '';
    const existing = this.declarations.find((d) => d.topic === declaration.topic && (d.version ?? '') === version);
    if (existing !== undefined) {
      if (existing.kind !== declaration.kind) {
        const versionText = version === '' ? '' : ` (version '${version}')`;
        throw new Error(
          `Topic '${declaration.topic}'${versionText} is declared both as an event and as a send. An event is a ` +
            "topic this service defines; a send targets a topic another party defines - declare it as one or " +
            'the other (contract-document.md §3.3).',
        );
      }
      if (!sameTypes(existing, declaration)) {
        throw new Error(
          `Topic '${declaration.topic}' is declared twice as a ${declaration.kind} with different payload types.`,
        );
      }
      return this;
    }
    this.declarations.push(declaration);
    return this;
  }

  getAllDeclarations(): readonly OutboundDeclaration[] {
    return [...this.declarations];
  }

  getAllDefinitions(): IMessageSenderDefinition[] {
    return this.declarations.map((declaration) =>
      declaration.kind === 'event'
        ? MessageSenderDefinition.create(declaration.topic, declaration.message ?? VoidResult, VoidResult, VoidResult, declaration.version ?? '')
        : MessageSenderDefinition.create(
            declaration.topic,
            declaration.request ?? VoidResult,
            declaration.response ?? VoidResult,
            VoidResult,
            declaration.version ?? '',
          ),
    );
  }
}

function sameTypes(a: OutboundDeclaration, b: OutboundDeclaration): boolean {
  if (a.kind === 'event' && b.kind === 'event') {
    return a.message === b.message;
  }
  if (a.kind === 'send' && b.kind === 'send') {
    return a.request === b.request && a.response === b.response;
  }
  return false;
}

/**
 * Registers `registry` as the container's {@link IMeshOutboundDefinitionLookUp}, so the spec builder
 * (`events`/`sends`) and the mesh descriptor (`produces`) both read it. C# has no equivalent free function
 * (its registry is handed to `WithConsumes`); added so a host without the cloud-service builder can wire it.
 */
export function addMeshOutbound(
  container: IBenzeneServiceContainer,
  registry: MeshOutboundRegistry,
): IBenzeneServiceContainer {
  container.addSingletonInstance(IMeshOutboundDefinitionLookUp, registry);
  return container;
}

import { ServiceIdentifier, ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { IMessageSenderDefinition } from './IMessageSenderDefinition';

/**
 * An **event declaration** (contract-document.md §3.1, §3.3): a topic this service publishes and whose
 * contract it defines. It lands in the Contract Document's `events[]`, and so in the `contractHash` a
 * client of this service depends on.
 */
export interface EventDeclaration {
  readonly kind: 'event';
  readonly topic: string;
  /** The version written into `benzene-version`; absent (or `''`) for an unversioned topic. */
  readonly version?: string;
  /** The event payload's type; absent means a payload of unconstrained shape (`{}`). */
  readonly message?: ServiceIdentifier<unknown>;
}

/**
 * A **send declaration** (contract-document.md §3.2, §3.3): a message to a topic another party defines — a
 * command to a queue, a request to another service, a publish onto someone else's topic. It lands in the
 * Contract Document's `sends[]`: a dependency of this service, outside the `contractHash`.
 */
export interface SendDeclaration {
  readonly kind: 'send';
  readonly topic: string;
  /** The version written into `benzene-version`; absent (or `''`) for an unversioned topic. */
  readonly version?: string;
  /** The type of the message sent; absent means a message of unconstrained shape (`{}`). */
  readonly request?: ServiceIdentifier<unknown>;
  /** The reply's type; **absent means one-way** — nothing comes back. */
  readonly response?: ServiceIdentifier<unknown>;
}

/** One outbound declaration: an event or a send, discriminated by `kind`. */
export type OutboundDeclaration = EventDeclaration | SendDeclaration;

/**
 * Looks up every outbound declaration an application has registered. Port of
 * `Benzene.Mesh.Wire.IMeshOutboundDefinitionLookUp`, widened by the `kind` of each record.
 *
 * Divergence from C#: the lookup lives here rather than in `@benzenejs/mesh-wire` (where its implementation,
 * `MeshOutboundRegistry`, lives), because the spec builder in `@benzenejs/schema-openapi` reads it too and
 * self-description must not depend on the mesh. Both the Contract Document (`events`/`sends`) and the mesh
 * descriptor (`produces`, events ∪ sends) are fed from this one registration.
 */
export interface IMeshOutboundDefinitionLookUp {
  /** Every declaration, in registration order. */
  getAllDeclarations(): readonly OutboundDeclaration[];

  /**
   * Every declaration as a sender definition (`(topic, request, response)` — an event's message is its
   * request, with no response): the shape the mesh descriptor's `produces` is projected from.
   */
  getAllDefinitions(): IMessageSenderDefinition[];
}

export const IMeshOutboundDefinitionLookUp: ServiceToken<IMeshOutboundDefinitionLookUp> =
  serviceToken<IMeshOutboundDefinitionLookUp>('IMeshOutboundDefinitionLookUp');

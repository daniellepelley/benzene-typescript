/** Port of Benzene.Mesh.Contracts.MeshDeclaredSchema (and MeshDeclaredSchemaRole). */

/**
 * What one service declares a topic's payload looks like — its own declaration, verbatim, attributed to it
 * by name.
 *
 * Published only where `MeshTopicEntry.schemaMismatch` is true, and it exists for exactly one reason: the
 * flag says the services on a topic disagree about its shape, and until now nothing said *where*. A reader
 * was told two services will fail to talk to each other and then left to open each service's own spec by
 * hand. That is a detection with no finding underneath it.
 *
 * **Raw declarations, not a computed diff.** A diff needs a baseline, and choosing one crowns a service as
 * the reference — "billing-api is missing customerId" is a verdict nobody earned, since either declaration
 * could be the correct one. Publishing what each service actually declared keeps the data symmetric by
 * construction, and lets a reader compare on any axis they care about rather than the one axis a comparer
 * happened to classify. It also carries differences that a keyword-limited comparer structurally cannot see
 * — a tightened `maxLength`, a changed `pattern` — which would otherwise be published as an empty
 * difference list.
 *
 * Absence is not agreement: a service that declared no schema for a side is present here with `undefined`
 * for that side, and a service missing entirely contributed no declaration at all.
 *
 * `System.Text.Json.Nodes.JsonObject?` (the inlined JSON Schemas) -> `Record<string, unknown> | undefined`,
 * matching `MeshTopicEntry`.
 */
export class MeshDeclaredSchema {
  /**
   * @param service The declaring service. Never inferred — this is the attribution the flag was missing.
   * @param role One of `MeshDeclaredSchemaRole`; a reader must tolerate a role it does not recognise, per
   * this catalogue's loose-string convention.
   * @param requestSchema The inbound payload this service declares it accepts. `undefined` means it
   * declared none — no signal, never agreement.
   * @param responseSchema The response payload this service declares it returns, or `undefined` when it
   * declared none.
   * @param messageSchema The message this service declares it sends, or `undefined`. Only meaningful for a
   * producer.
   */
  constructor(
    readonly service: string,
    readonly role: string,
    readonly requestSchema?: Record<string, unknown>,
    readonly responseSchema?: Record<string, unknown>,
    readonly messageSchema?: Record<string, unknown>,
  ) {}
}

/**
 * Which end of a topic a `MeshDeclaredSchema` comes from — loose string constants (the `MeshTopicStatus`
 * convention, not an enum) so an older reader renders an unknown role rather than failing to parse.
 */
export const MeshDeclaredSchemaRole = {
  /** The service handles this topic — its request/response declarations apply. */
  consumer: 'consumer',

  /** The service sends this topic — its message declaration applies. */
  producer: 'producer',
} as const;

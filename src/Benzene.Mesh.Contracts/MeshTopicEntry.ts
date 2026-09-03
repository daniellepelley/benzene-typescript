/** Port of Benzene.Mesh.Contracts.MeshTopicEntry. */
import { MeshDeclaredSchema } from './MeshDeclaredSchema';
import { MeshTopicChange } from './MeshTopicChange';
import { MeshTopicProducer, MeshTopicService } from './MeshTopicService';

/**
 * One distinct (topic, version) pair in a `MeshTopicCatalog`, and every service in the fleet that produces
 * or consumes it. Aggregator-computed, derived from each service's own spec (`requests`/`events`).
 *
 * `System.Text.Json.Nodes.JsonObject?` (the inlined JSON Schemas) -> `Record<string, unknown> | undefined`
 * (an arbitrary JSON object); `DateTimeOffset` fields don't appear here.
 */
export class MeshTopicEntry {
  readonly status: string | undefined;
  readonly requestSchema: Record<string, unknown> | undefined;
  readonly responseSchema: Record<string, unknown> | undefined;
  readonly messageSchema: Record<string, unknown> | undefined;
  readonly schemaMismatch: boolean;
  readonly changes: MeshTopicChange[];

  /**
   * What each service on this topic declares its payload looks like, attributed by name — the substance
   * behind `schemaMismatch`. Published **only** where `schemaMismatch` is true: on a topic whose services
   * agree there is nothing to attribute, and the representative schemas above are the whole story.
   * `undefined` means this build does not publish the substance, which is **not** the same as "nothing
   * differs" — a reader must render it as unknown. See `MeshDeclaredSchema` for why these are raw
   * declarations rather than a computed diff.
   */
  readonly declaredSchemas: MeshDeclaredSchema[] | undefined;

  /**
   * @param version The topic's handler version (empty for the unversioned handler).
   * @param reserved True for a reserved Benzene utility topic (spec/health/mesh/…).
   * @param status One of `MeshTopicStatus`, or `undefined` when neither signal applies.
   * @param schemaMismatch True when consumers disagree on the inbound payload - a likely contract error.
   * @param changes What changed for this (topic, version) since the previous run; empty when nothing did.
   * @param declaredSchemas What each service on this topic declares, attributed by name — see
   * {@link declaredSchemas}. Only where `schemaMismatch` is true.
   */
  constructor(
    readonly topic: string,
    readonly version: string,
    readonly reserved: boolean,
    readonly consumers: MeshTopicService[],
    readonly producers: MeshTopicProducer[],
    status: string | undefined,
    requestSchema?: Record<string, unknown>,
    responseSchema?: Record<string, unknown>,
    messageSchema?: Record<string, unknown>,
    schemaMismatch = false,
    changes: MeshTopicChange[] = [],
    declaredSchemas?: MeshDeclaredSchema[],
  ) {
    this.status = status;
    this.requestSchema = requestSchema;
    this.responseSchema = responseSchema;
    this.messageSchema = messageSchema;
    this.schemaMismatch = schemaMismatch;
    this.changes = changes;
    this.declaredSchemas = declaredSchemas;
  }
}

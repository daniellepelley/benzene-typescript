/**
 * The TypeScript stand-in for Benzene.Mesh.Wire.MeshSchemaGenerator.
 *
 * The C# generator derives a topic's `requestSchema`/`responseSchema` (mesh.md §2.1) by *reflecting*
 * over the registered request/response CLR types with `NullabilityInfoContext`. TypeScript erases
 * types at runtime, so there is nothing to reflect over: `MessageHandlerDefinition.requestType` is a
 * value-level token/constructor, not a structural type. The port therefore replaces reflection with a
 * pluggable provider keyed by topic - the schema is supplied by whatever *does* know the shape (a
 * schema registry, a zod/joi model, a hand-written map), rather than recovered from the type system.
 *
 * This is a documented divergence (README "Porting conventions"): the §2.1 mapping table is normative
 * and unchanged; only its *source* moves from CLR reflection to an injected provider.
 */
import { ITopic } from '@benzenejs/abstractions-messages';
import { JsonObject } from './MeshJson';

/** A topic's derived request/response schemas (either may be absent -> unconstrained). */
export interface MeshTopicSchemas {
  request?: JsonObject;
  response?: JsonObject;
}

/**
 * Supplies the §2.1 payload schemas for a topic when the descriptor is built. Called once per topic
 * at startup, inside `MeshDescriptorFactory.create` - never on the message hot path.
 */
export interface IMeshSchemaProvider {
  getSchemas(topic: ITopic): MeshTopicSchemas;
}

/**
 * The default: no schemas. A meshed service still self-describes its full topic *list* (the load-
 * bearing part of §2) with `requestSchema`/`responseSchema` simply omitted (unconstrained), exactly
 * as the §2.1 mapping's `{}` case allows. Use this when no schema source is wired up.
 */
export class NoMeshSchemaProvider implements IMeshSchemaProvider {
  getSchemas(): MeshTopicSchemas {
    return {};
  }
}

/**
 * Schemas supplied explicitly, keyed by topic id. The value is the §2.1-derived schema object as it
 * should appear on the wire; the factory copies it onto the topic descriptor verbatim. A topic with
 * no entry gets no schemas (unconstrained).
 */
export class MapMeshSchemaProvider implements IMeshSchemaProvider {
  constructor(private readonly byTopicId: Record<string, MeshTopicSchemas>) {}

  getSchemas(topic: ITopic): MeshTopicSchemas {
    return this.byTopicId[topic.id] ?? {};
  }
}

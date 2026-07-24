/** Port of Benzene.SchemaRegistry.Core.SchemaRegistrar. */
import { Constructor, IPayloadSerializer } from '@benzene/abstractions';
import { ISchemaRegistryClient } from './ISchemaRegistryClient';
import { ISchemaResolver } from './ISchemaResolver';
import { SchemaIncompatibleException } from './SchemaIncompatibleException';
import { SchemaRegistrySerializer } from './SchemaRegistrySerializer';

/**
 * Startup helper that registers message-type schemas with an {@link ISchemaRegistryClient} and builds
 * the per-type id map a {@link SchemaRegistrySerializer} needs, plus a fail-fast evolution check. Run
 * this once at startup (before wiring the pipeline), so registration and compatibility happen up front -
 * not on the first message.
 *
 * C#'s runtime `Type` keys become `Constructor` keys (type-erasure convention); `CancellationToken` ->
 * optional `AbortSignal`.
 */
export class SchemaRegistrar {
  constructor(
    private readonly registry: ISchemaRegistryClient,
    private readonly resolver: ISchemaResolver,
  ) {}

  /** Registers each type's schema and returns the resulting per-type schema-id map. */
  async registerAsync(
    types: Iterable<Constructor<unknown>>,
    cancellationToken?: AbortSignal,
  ): Promise<ReadonlyMap<Constructor<unknown>, number>> {
    const map = new Map<Constructor<unknown>, number>();
    for (const type of types) {
      map.set(type, await this.registry.registerAsync(this.resolver.resolve(type), cancellationToken));
    }
    return map;
  }

  /**
   * Verifies every type's current schema is compatible with the registry, throwing
   * {@link SchemaIncompatibleException} listing all incompatible subjects at once - an evolution gate.
   */
  async ensureCompatibleAsync(
    types: Iterable<Constructor<unknown>>,
    cancellationToken?: AbortSignal,
  ): Promise<void> {
    const incompatible: string[] = [];
    for (const type of types) {
      const definition = this.resolver.resolve(type);
      if (!(await this.registry.isCompatibleAsync(definition, cancellationToken))) {
        incompatible.push(definition.subject);
      }
    }

    if (incompatible.length > 0) {
      throw new SchemaIncompatibleException(incompatible.join(', '));
    }
  }

  /**
   * Registers the given types' schemas and returns a {@link SchemaRegistrySerializer} that frames
   * `inner`'s output with the resolved ids.
   */
  async createSerializerAsync(
    inner: IPayloadSerializer,
    types: Iterable<Constructor<unknown>>,
    cancellationToken?: AbortSignal,
  ): Promise<SchemaRegistrySerializer> {
    const map = await this.registerAsync(types, cancellationToken);
    return new SchemaRegistrySerializer(inner, map);
  }
}

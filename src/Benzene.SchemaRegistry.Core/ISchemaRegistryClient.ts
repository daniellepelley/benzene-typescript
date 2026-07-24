/** Port of Benzene.SchemaRegistry.Core.ISchemaRegistryClient. */
import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { RegisteredSchema } from './RegisteredSchema';
import { SchemaDefinition } from './SchemaDefinition';

/**
 * The neutral schema-registry seam: register a schema under a subject and get back a stable id, look a
 * schema up by id or subject, and check whether a candidate schema is compatible. An app depends on
 * this; a provider adapter (Confluent Schema Registry, Azure Schema Registry, ...) implements it, so
 * registry-backed serialization and evolution checks aren't tied to one vendor.
 *
 * C#'s `CancellationToken` parameters map to an optional `AbortSignal` per the port convention.
 */
export interface ISchemaRegistryClient {
  /**
   * Registers `schema` under its subject and returns its registry-wide id. Registering an identical
   * schema again returns the existing id (idempotent).
   */
  registerAsync(schema: SchemaDefinition, cancellationToken?: AbortSignal): Promise<number>;

  /** Returns the schema with the given id, or `undefined` if unknown. */
  getByIdAsync(id: number, cancellationToken?: AbortSignal): Promise<RegisteredSchema | undefined>;

  /** Returns the latest registered version for `subject`, or `undefined` if none. */
  getLatestAsync(subject: string, cancellationToken?: AbortSignal): Promise<RegisteredSchema | undefined>;

  /**
   * Returns whether `schema` is compatible with the subject's existing versions under the registry's
   * configured compatibility mode (a first schema for a subject is always compatible). Use this as an
   * evolution check before publishing a new contract.
   */
  isCompatibleAsync(schema: SchemaDefinition, cancellationToken?: AbortSignal): Promise<boolean>;
}

/** Container token: an app resolves the registry client by this interface. */
export const ISchemaRegistryClient: ServiceToken<ISchemaRegistryClient> =
  serviceToken<ISchemaRegistryClient>('ISchemaRegistryClient');

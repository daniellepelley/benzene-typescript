/** Port of Benzene.SchemaRegistry.Core.InMemorySchemaRegistryClient. */
import {
  ISchemaCompatibilityChecker,
  TextualSchemaCompatibilityChecker,
} from './ISchemaCompatibilityChecker';
import { ISchemaRegistryClient } from './ISchemaRegistryClient';
import { RegisteredSchema } from './RegisteredSchema';
import { SchemaCompatibilityMode } from './SchemaCompatibilityMode';
import { SchemaDefinition } from './SchemaDefinition';
import { SchemaIncompatibleException } from './SchemaIncompatibleException';

/**
 * An in-process {@link ISchemaRegistryClient} - for tests, local development, and single-node
 * deployments that want registry-framed payloads without running a registry server. Assigns monotonic
 * ids, versions per subject, dedups an identical re-registration, and enforces compatibility via a
 * pluggable {@link ISchemaCompatibilityChecker}.
 *
 * State lives in this process only - it does not coordinate ids across instances. C#'s `lock (_gate)`
 * is dropped: Node runs each method's synchronous body to completion before any other, so the
 * check-and-insert is already atomic (same reasoning as `InMemoryIdempotencyStore`).
 */
export class InMemorySchemaRegistryClient implements ISchemaRegistryClient {
  private readonly byId: RegisteredSchema[] = [];
  private readonly bySubject = new Map<string, RegisteredSchema[]>();
  private readonly checker: ISchemaCompatibilityChecker;
  private readonly mode: SchemaCompatibilityMode;
  private nextId = 1;

  /**
   * @param mode The compatibility level enforced on registration. Defaults to {@link SchemaCompatibilityMode.Backward}.
   * @param checker The compatibility checker. Defaults to {@link TextualSchemaCompatibilityChecker}.
   */
  constructor(
    mode: SchemaCompatibilityMode = SchemaCompatibilityMode.Backward,
    checker: ISchemaCompatibilityChecker = new TextualSchemaCompatibilityChecker(),
  ) {
    this.mode = mode;
    this.checker = checker;
  }

  async registerAsync(schema: SchemaDefinition, cancellationToken?: AbortSignal): Promise<number> {
    cancellationToken?.throwIfAborted();
    const versions = this.versions(schema.subject);

    const existing = versions.find((v) => v.schema === schema.schema && v.format === schema.format);
    if (existing !== undefined) {
      return existing.id; // idempotent
    }

    const latest = versions.length > 0 ? versions[versions.length - 1] : undefined;
    if (!this.checker.isCompatible(latest, schema, this.mode)) {
      throw new SchemaIncompatibleException(schema.subject);
    }

    const registered = new RegisteredSchema(
      this.nextId++,
      schema.subject,
      versions.length + 1,
      schema.schema,
      schema.format,
    );
    versions.push(registered);
    this.byId.push(registered);
    return registered.id;
  }

  async getByIdAsync(id: number, cancellationToken?: AbortSignal): Promise<RegisteredSchema | undefined> {
    cancellationToken?.throwIfAborted();
    return this.byId.find((s) => s.id === id);
  }

  async getLatestAsync(
    subject: string,
    cancellationToken?: AbortSignal,
  ): Promise<RegisteredSchema | undefined> {
    cancellationToken?.throwIfAborted();
    const versions = this.versions(subject);
    return versions.length > 0 ? versions[versions.length - 1] : undefined;
  }

  async isCompatibleAsync(schema: SchemaDefinition, cancellationToken?: AbortSignal): Promise<boolean> {
    cancellationToken?.throwIfAborted();
    const versions = this.versions(schema.subject);
    const latest = versions.length > 0 ? versions[versions.length - 1] : undefined;
    return this.checker.isCompatible(latest, schema, this.mode);
  }

  private versions(subject: string): RegisteredSchema[] {
    let versions = this.bySubject.get(subject);
    if (versions === undefined) {
      versions = [];
      this.bySubject.set(subject, versions);
    }
    return versions;
  }
}

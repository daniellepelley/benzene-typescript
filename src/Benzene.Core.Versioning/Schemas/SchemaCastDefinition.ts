/** Port of Benzene.Core.Versioning.Schemas.SchemaCastDefinition. */

/** Identifies a schema cast: the topic it applies to, and the from/to schema version strings. */
export class SchemaCastDefinition {
  constructor(
    readonly topic: string,
    readonly fromSchema: string,
    readonly toSchema: string,
  ) {}

  toString(): string {
    return `${this.topic}: ${this.fromSchema} -> ${this.toSchema}`;
  }
}

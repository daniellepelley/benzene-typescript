/** Port of Benzene.SchemaRegistry.Core.RegisteredSchema. */
import { SchemaFormat } from './SchemaFormat';

/** A schema as stored in the registry: its global id and per-subject version, plus the definition. */
export class RegisteredSchema {
  /**
   * @param id The registry-wide schema id (what the Confluent wire format embeds).
   * @param subject The subject this version belongs to.
   * @param version The 1-based version within the subject.
   * @param schema The schema text.
   * @param format The schema format.
   */
  constructor(
    readonly id: number,
    readonly subject: string,
    readonly version: number,
    readonly schema: string,
    readonly format: SchemaFormat,
  ) {}
}

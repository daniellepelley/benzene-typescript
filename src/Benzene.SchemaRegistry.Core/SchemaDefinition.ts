/** Port of Benzene.SchemaRegistry.Core.SchemaDefinition. */
import { SchemaFormat } from './SchemaFormat';

/**
 * A schema to register or check: the subject it belongs to (the registry's namespace key, by
 * convention `<topic>-value` or `<topic>-key` for Kafka), the schema text, and its format.
 */
export class SchemaDefinition {
  /**
   * @param subject The registry subject this schema belongs to.
   * @param schema The schema text (e.g. an Avro `.avsc` document).
   * @param format The schema format. Defaults to {@link SchemaFormat.Avro}.
   */
  constructor(
    readonly subject: string,
    readonly schema: string,
    readonly format: SchemaFormat = SchemaFormat.Avro,
  ) {}
}

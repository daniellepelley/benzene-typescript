/** Port of Benzene.Avro.IAvroSchemaResolver. */
import { Constructor } from '@benzene/abstractions';
import * as avro from 'avsc';

/**
 * Resolves the Avro {@link avro.Type} to use for a message class.
 * Port of Benzene.Avro.IAvroSchemaResolver.
 *
 * **avsc mapping.** The C# resolver returns Apache.Avro's `Schema` (a parsed schema model that a
 * separate `GenericDatumWriter`/`GenericDatumReader` then reads/writes). avsc's `Type` subsumes both:
 * it is the compiled schema *and* the codec (`toBuffer`/`fromBuffer`), so `AvroDatumConverter`'s
 * POCO ↔ datum step is unnecessary. This resolver therefore returns a ready-to-use `avro.Type`.
 */
export interface IAvroSchemaResolver {
  /**
   * Gets the Avro `Type` for a message class. Port of C# `Schema GetSchema(Type type)` — the `Type`
   * argument is a constructor here, since TypeScript has no runtime `System.Type`.
   */
  getSchema(messageType: Constructor<unknown>): avro.Type;
}

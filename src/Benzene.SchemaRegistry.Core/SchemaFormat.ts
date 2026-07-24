/** Port of Benzene.SchemaRegistry.Core.SchemaFormat. */

/** The wire format a registered schema describes. C# enum -> TypeScript `enum` (member names kept as-is). */
export enum SchemaFormat {
  /** Apache Avro (the Confluent registry default). */
  Avro,

  /** JSON Schema. */
  Json,

  /** Protocol Buffers. */
  Protobuf,
}

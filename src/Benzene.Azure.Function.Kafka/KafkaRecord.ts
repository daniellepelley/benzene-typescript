/** Port of the Microsoft.Azure.Functions.Worker `KafkaRecord` message type (modelled locally). */

/**
 * The shape of a single Kafka event delivered by an Azure Functions Kafka trigger.
 *
 * TYPE-MODEL CHOICE: .NET binds the Kafka trigger to `Microsoft.Azure.Functions.Worker`'s
 * `KafkaRecord` (from `Microsoft.Azure.Functions.Worker.Extensions.Kafka`). Unlike Service Bus
 * (`@azure/service-bus`) or Event Hubs (`@azure/event-hubs`), the Node ecosystem has NO first-class
 * Azure-Functions Kafka record type: `@azure/functions` v4 exposes the trigger only as opaque
 * `InvocationContext` binding data, with no exported record interface. So — per the "adapt the
 * integration to the ecosystem" convention — the minimal record shape the getters need is modelled
 * here as a small local interface, mirroring the C# `KafkaRecord` members the package actually reads.
 *
 * Field mapping (.NET PascalCase -> Node camelCase), matching the C# getters:
 *   - C# `KafkaRecord.Topic` (`string`)      -> `topic`  (read by `KafkaMessageTopicGetter`)
 *   - C# `KafkaRecord.Value` (`byte[]`)       -> `value`  (UTF-8 decoded by `KafkaMessageBodyGetter`;
 *                                                modelled as bytes to match the C# `byte[]` /
 *                                                `Encoding.UTF8.GetString(...)`)
 *   - C# `KafkaRecord.Headers`                -> `headers` (read by `KafkaMessageHeadersGetter`, and by
 *                                                `KafkaMessageTopicGetter` for the `topic` header -
 *                                                a divergence: the C# getters ignore them)
 * The remaining members (`key`, `offset`, `partition`) are modelled for realism/parity and are optional
 * here and unused by the port.
 */
export interface KafkaRecord {
  /** The Kafka topic the record was published to. Routes when the record has no `topic` header. */
  topic: string;

  /** The record value (payload) as raw bytes, UTF-8 decoded to the message body. C# `byte[]`. */
  value?: Uint8Array;

  /** The record key, if any. Modelled for parity; not read by the port. */
  key?: string;

  /** The record's offset within its partition. Modelled for parity; not read by the port. */
  offset?: number;

  /** The partition the record came from. Modelled for parity; not read by the port. */
  partition?: number;

  /**
   * The record's headers: a string value is used as-is, a byte array is UTF-8 decoded, anything else is
   * skipped. The `topic` header, when present, is the Benzene topic (else `topic` above routes).
   */
  headers?: Record<string, unknown>;
}

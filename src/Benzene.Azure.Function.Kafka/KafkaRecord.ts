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
 * The remaining members (`key`, `offset`, `partition`, `headers`) are modelled for realism/parity —
 * the C# package's getters don't currently read them (its headers getter is always-empty), so they're
 * optional here and unused by the port.
 */
export interface KafkaRecord {
  /** The Kafka topic the record was published to. Drives Benzene routing. */
  topic: string;

  /** The record value (payload) as raw bytes, UTF-8 decoded to the message body. C# `byte[]`. */
  value?: Uint8Array;

  /** The record key, if any. Modelled for parity; not read by the port. */
  key?: string;

  /** The record's offset within its partition. Modelled for parity; not read by the port. */
  offset?: number;

  /** The partition the record came from. Modelled for parity; not read by the port. */
  partition?: number;

  /** The record's headers. Modelled for parity; the C# headers getter is always-empty. */
  headers?: Record<string, unknown>;
}

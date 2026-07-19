/** Port of Benzene.Azure.Function.Kafka.KafkaContext. */
import { IHasMessageResult, IMessageResult } from '@benzene/abstractions-message-handlers';
import { KafkaRecord } from './KafkaRecord';

/**
 * Provides the middleware pipeline context for a single Kafka event within an Azure Functions Kafka
 * trigger batch. Implements the already-ported `IHasMessageResult` so
 * `KafkaMessageMessageHandlerResultSetter` can record the handler outcome onto it.
 *
 * MESSAGE-TYPE ADAPTATION: .NET wraps `Microsoft.Azure.Functions.Worker`'s `KafkaRecord`; the Node
 * port wraps the locally-modelled `KafkaRecord` (see `KafkaRecord.ts` for why a first-class ecosystem
 * type isn't available). Field-name mapping: C# `KafkaEvent` -> `kafkaEvent`, C# `MessageResult` ->
 * `messageResult`.
 */
export class KafkaContext implements IHasMessageResult {
  /**
   * @param kafkaEvent The Kafka event data for this record.
   */
  constructor(kafkaEvent: KafkaRecord) {
    this.kafkaEvent = kafkaEvent;
  }

  /** The Kafka event data for this record. */
  readonly kafkaEvent: KafkaRecord;

  /**
   * The result of handling this record's message. Set by `KafkaMessageMessageHandlerResultSetter`;
   * unset (C# `null`) until a result has been recorded — `KafkaBatchApplication` reads it via optional
   * chaining, exactly as C# reads `MessageResult?.IsSuccessful`.
   */
  messageResult!: IMessageResult;
}

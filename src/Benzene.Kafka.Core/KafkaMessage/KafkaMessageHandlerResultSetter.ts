/** Port of Benzene.Kafka.Core.KafkaMessage.KafkaMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzenejs/core-message-handlers';
import { KafkaRecordContext } from './KafkaRecordContext';

/**
 * Records a message handler's outcome onto `KafkaRecordContext.messageResult`, which the worker reads
 * for `commitOnlyOnSuccess` gating.
 *
 * PORTING NOTE: C# writes `context.MessageResult = messageHandlerResult.BenzeneResult`; the port reuses
 * the shared `MessageMessageHandlerResultSetterBase` (as `EventHubConsumerMessageHandlerResultSetter`
 * does), which records the handler's pass/fail outcome onto the context.
 */
export class KafkaMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<KafkaRecordContext> {}

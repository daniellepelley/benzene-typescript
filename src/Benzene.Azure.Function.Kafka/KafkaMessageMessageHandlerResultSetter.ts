/** Port of Benzene.Azure.Function.Kafka.KafkaMessageMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { KafkaContext } from './KafkaContext';

/**
 * Records a message handler's outcome onto `KafkaContext.messageResult`. The Kafka trigger has no
 * platform-level per-record acknowledgement to report back to, but `KafkaBatchApplication` reads this
 * to support `KafkaOptions.raiseOnFailureStatus`.
 *
 * C# `KafkaMessageMessageHandlerResultSetter : MessageMessageHandlerResultSetterBase<KafkaContext>`
 * (an empty body) ports to a trivial subclass of the already-ported base.
 */
export class KafkaMessageMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<KafkaContext> {}

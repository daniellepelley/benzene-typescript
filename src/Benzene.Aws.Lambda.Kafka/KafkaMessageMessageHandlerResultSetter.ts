/** Port of Benzene.Aws.Lambda.Kafka.KafkaMessageMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { KafkaContext } from './KafkaContext';

/**
 * Records a message handler's outcome onto `KafkaContext.messageResult`.
 *
 * C# `KafkaMessageMessageHandlerResultSetter : MessageMessageHandlerResultSetterBase<KafkaContext>` (an
 * empty body) ports to a trivial subclass of the already-ported base.
 */
export class KafkaMessageMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<KafkaContext> {}

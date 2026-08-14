/** Port of Benzene.RabbitMq.RabbitMqMessage.RabbitMqMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzenejs/core-message-handlers';
import { RabbitMqContext } from './RabbitMqContext';

/**
 * Records a message handler's outcome onto `RabbitMqContext.messageResult`, which `RabbitMqWorker` reads
 * to decide ack vs nack under `RabbitMqAckMode.Explicit`.
 *
 * PORTING NOTE: C# subclasses `MessageHandlerResultSetterBase`; the port has a single equivalent base,
 * `MessageMessageHandlerResultSetterBase` (both write the handler's result onto the context's
 * `messageResult`), so this extends it — same as the other consumer packages.
 */
export class RabbitMqMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<RabbitMqContext> {}

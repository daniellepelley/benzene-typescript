/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumerMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { SqsConsumerMessageContext } from './SqsConsumerMessageContext';

/**
 * Records a message handler's outcome onto `SqsConsumerMessageContext.messageResult` (via the shared
 * `IHasMessageResult` base), read by `SqsConsumerApplication` to support `SqsConsumerAckMode.PerMessage`.
 */
export class SqsConsumerMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<SqsConsumerMessageContext> {}

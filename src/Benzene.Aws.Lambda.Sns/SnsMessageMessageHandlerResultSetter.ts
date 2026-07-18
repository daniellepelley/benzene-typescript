/** Port of Benzene.Aws.Lambda.Sns.SnsMessageMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { SnsRecordContext } from './SnsRecordContext';

/**
 * Records a message handler's outcome onto `SnsRecordContext.messageResult`, so `SnsApplication` can
 * honor `SnsOptions.raiseOnFailureStatus` (escalate a non-exception failure into a thrown exception so
 * SNS's subscription retry policy applies).
 *
 * C# `SnsMessageMessageHandlerResultSetter : MessageMessageHandlerResultSetterBase<SnsRecordContext>`
 * (an empty body: `... : Base;`) ports to a trivial subclass of the already-ported base.
 */
export class SnsMessageMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<SnsRecordContext> {}

/** Port of Benzene.Aws.Lambda.S3.S3MessageMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { S3RecordContext } from './S3RecordContext';

/**
 * Records a message handler's outcome onto `S3RecordContext.messageResult`. S3 events are fire-and-forget,
 * so the result is recorded for diagnostics rather than written back to a response.
 *
 * C# `S3MessageMessageHandlerResultSetter : MessageMessageHandlerResultSetterBase<S3RecordContext>` (an
 * empty body) ports to a trivial subclass of the already-ported base.
 */
export class S3MessageMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<S3RecordContext> {}

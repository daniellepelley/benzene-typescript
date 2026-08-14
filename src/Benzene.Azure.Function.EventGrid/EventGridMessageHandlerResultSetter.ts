/** Port of Benzene.Azure.Function.EventGrid.EventGridMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzenejs/core-message-handlers';
import { EventGridContext } from './EventGridContext';

/**
 * Records a message handler's outcome onto `EventGridContext.messageResult`. Event Grid has no per-event
 * settlement from inside the handler (a thrown exception is what drives its retry/dead-letter
 * machinery), so the result is recorded for middleware/diagnostics — but `EventGridBatchApplication`
 * reads it to support `EventGridOptions.raiseOnFailureStatus`.
 *
 * C# `MessageHandlerResultSetterBase<EventGridContext>` (an empty body: `... : Base;`) ports to a
 * trivial subclass of the already-ported `MessageMessageHandlerResultSetterBase`.
 */
export class EventGridMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<EventGridContext> {}

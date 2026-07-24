import { IResponseHandlerContainer } from '@benzene/abstractions-message-handlers';
import { ResponseMessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { ExpressContext } from './ExpressContext';

/**
 * Writes a handler's result back as an HTTP response by running the registered
 * `IResponseHandler<ExpressContext>` chain (status code, JSON body, headers), via the shared
 * `ResponseMessageMessageHandlerResultSetterBase`. Registered by `addExpress`. The doubled "Message" in
 * the name is deliberate (see the base type). Express analog of
 * `Benzene.AspNet.Core.AspMessageHandlerResultSetter`.
 */
export class ExpressMessageMessageHandlerResultSetter extends ResponseMessageMessageHandlerResultSetterBase<ExpressContext> {
  constructor(responseHandlerContainer: IResponseHandlerContainer<ExpressContext>) {
    super(responseHandlerContainer);
  }
}

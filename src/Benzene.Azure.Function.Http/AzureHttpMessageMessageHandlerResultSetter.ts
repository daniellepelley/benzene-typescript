import { IResponseHandlerContainer } from '@benzene/abstractions-message-handlers';
import { ResponseMessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { AzureHttpContext } from './AzureHttpContext';

/**
 * Port of Benzene.Azure.Function.AspNet.AspNetMessageMessageHandlerResultSetter.
 *
 * Writes a handler's result back as an HTTP response by running the registered
 * `IResponseHandler<AzureHttpContext>` chain (status code, JSON body, headers), via the shared
 * `ResponseMessageMessageHandlerResultSetterBase<AzureHttpContext>` behavior. The doubled "Message" in
 * the name is deliberate (it mirrors the C# type name). Registered by `addAzureHttp`.
 */
export class AzureHttpMessageMessageHandlerResultSetter extends ResponseMessageMessageHandlerResultSetterBase<AzureHttpContext> {
  constructor(responseHandlerContainer: IResponseHandlerContainer<AzureHttpContext>) {
    super(responseHandlerContainer);
  }
}

import { IResponseHandlerContainer } from '@benzene/abstractions-message-handlers';
import { ResponseMessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { ApiGatewayContext } from './ApiGatewayContext';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayMessageMessageHandlerResultSetter.
 *
 * Writes a handler's result back as an HTTP response by running the registered
 * `IResponseHandler<ApiGatewayContext>` chain (status code, JSON body, headers), via the shared
 * `ResponseMessageMessageHandlerResultSetterBase<ApiGatewayContext>` behavior. The doubled "Message"
 * in the name is deliberate (see the base type). Registered by `addApiGateway`.
 */
export class ApiGatewayMessageMessageHandlerResultSetter extends ResponseMessageMessageHandlerResultSetterBase<ApiGatewayContext> {
  constructor(responseHandlerContainer: IResponseHandlerContainer<ApiGatewayContext>) {
    super(responseHandlerContainer);
  }
}

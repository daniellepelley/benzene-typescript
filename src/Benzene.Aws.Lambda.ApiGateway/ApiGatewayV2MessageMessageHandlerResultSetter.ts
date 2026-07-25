import { IResponseHandlerContainer } from '@benzene/abstractions-message-handlers';
import { ResponseMessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { ApiGatewayV2Context } from './ApiGatewayV2Context';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayV2MessageHandlerResultSetter.
 *
 * Writes a handler's result back as an HTTP response by running the registered
 * `IResponseHandler<ApiGatewayV2Context>` chain, via the shared
 * `ResponseMessageMessageHandlerResultSetterBase<ApiGatewayV2Context>`. Registered by `addApiGatewayV2`.
 */
export class ApiGatewayV2MessageMessageHandlerResultSetter extends ResponseMessageMessageHandlerResultSetterBase<ApiGatewayV2Context> {
  constructor(responseHandlerContainer: IResponseHandlerContainer<ApiGatewayV2Context>) {
    super(responseHandlerContainer);
  }
}

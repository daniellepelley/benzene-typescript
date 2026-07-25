import { HttpRequest, IHttpRequestAdapter } from '@benzene/http';
import { ApiGatewayV2Context } from './ApiGatewayV2Context';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayV2HttpRequestAdapter.
 *
 * Adapts an `ApiGatewayV2Context` into Benzene's transport-agnostic `HttpRequest`, reading the method
 * and path from `requestContext.http` and folding the v2 cookies array into the headers.
 */
export class ApiGatewayV2HttpRequestAdapter implements IHttpRequestAdapter<ApiGatewayV2Context> {
  map(context: ApiGatewayV2Context): HttpRequest {
    const httpRequest = new HttpRequest();
    httpRequest.path = context.path ?? '';
    httpRequest.method = context.method ?? '';
    httpRequest.headers = context.combinedHeaders();
    return httpRequest;
  }
}

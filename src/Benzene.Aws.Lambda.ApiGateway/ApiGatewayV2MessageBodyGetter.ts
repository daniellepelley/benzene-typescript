import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { ApiGatewayV2Context } from './ApiGatewayV2Context';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayV2MessageBodyGetter.
 *
 * Extracts the body string from an API Gateway HTTP API v2 request, decoding it when API Gateway
 * base64-encoded it (`isBase64Encoded`, which API Gateway sets for binary media types or any payload it
 * can't treat as text) so the handler never sees base64; a normal text body is returned unchanged.
 */
export class ApiGatewayV2MessageBodyGetter implements IMessageBodyGetter<ApiGatewayV2Context> {
  getBody(context: ApiGatewayV2Context): string | undefined {
    const request = context.apiGatewayProxyRequest;
    if (request.body === undefined || request.body === '') {
      return undefined;
    }

    return request.isBase64Encoded
      ? Buffer.from(request.body, 'base64').toString('utf8')
      : request.body;
  }
}

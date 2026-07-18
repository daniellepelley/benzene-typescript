import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { ApiGatewayContext } from './ApiGatewayContext';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayMessageBodyGetter.
 *
 * Extracts the raw body string from an API Gateway request. .NET-PascalCase -> Node-camelCase:
 * C# `ApiGatewayProxyRequest.Body` becomes `apiGatewayProxyRequest.body` (typed `string | null` in
 * `@types/aws-lambda`, so `null` maps to `undefined`).
 */
export class ApiGatewayMessageBodyGetter implements IMessageBodyGetter<ApiGatewayContext> {
  getBody(context: ApiGatewayContext): string | undefined {
    return context.apiGatewayProxyRequest.body ?? undefined;
  }
}

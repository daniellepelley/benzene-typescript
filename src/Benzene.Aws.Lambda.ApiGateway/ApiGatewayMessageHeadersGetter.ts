import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { DictionaryUtils } from '@benzene/core';
import { IHttpHeaderMappings } from '@benzene/http';
import { ApiGatewayContext } from './ApiGatewayContext';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayMessageHeadersGetter.
 *
 * Extracts headers from an API Gateway request, applying the configured `IHttpHeaderMappings` (which
 * rename header names to their mapped values) via `DictionaryUtils.replace`.
 *
 * .NET-PascalCase -> Node-camelCase: C# `ApiGatewayProxyRequest.Headers` becomes
 * `apiGatewayProxyRequest.headers`. `@types/aws-lambda` types header values as `string | undefined`,
 * so entries with an undefined value are dropped before mapping (C# `IDictionary<string, string>`
 * has non-null values).
 */
export class ApiGatewayMessageHeadersGetter implements IMessageHeadersGetter<ApiGatewayContext> {
  constructor(private readonly httpHeaderMappings: IHttpHeaderMappings) {}

  getHeaders(context: ApiGatewayContext): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(context.apiGatewayProxyRequest.headers ?? {})) {
      if (value !== undefined) {
        headers[key] = value;
      }
    }
    return DictionaryUtils.replace(headers, this.httpHeaderMappings.getMappings());
  }
}

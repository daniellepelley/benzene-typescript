import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { DictionaryUtils } from '@benzene/core';
import { IHttpHeaderMappings } from '@benzene/http';
import { ApiGatewayV2Context } from './ApiGatewayV2Context';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayV2MessageHeadersGetter.
 *
 * Extracts headers from an API Gateway HTTP API v2 request (cookies folded in via
 * `context.combinedHeaders()`), applying the configured `IHttpHeaderMappings` via `DictionaryUtils.replace`.
 */
export class ApiGatewayV2MessageHeadersGetter implements IMessageHeadersGetter<ApiGatewayV2Context> {
  constructor(private readonly httpHeaderMappings: IHttpHeaderMappings) {}

  getHeaders(context: ApiGatewayV2Context): Record<string, string> {
    return DictionaryUtils.replace(context.combinedHeaders(), this.httpHeaderMappings.getMappings());
  }
}

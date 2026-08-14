import { IRequestEnricher } from '@benzenejs/abstractions-message-handlers';
import { DictionaryUtils } from '@benzenejs/core';
import { IHttpHeaderMappings, IRouteFinder } from '@benzenejs/http';
import { ApiGatewayV2Context } from './ApiGatewayV2Context';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayV2RequestEnricher.
 *
 * Enriches the deserialized request with values that don't come from the body — query-string
 * parameters, path parameters, mapped headers (cookies folded in), and route parameters — layered on
 * with `DictionaryUtils.mapOnto` (first value wins). Returns an empty object when no route matches.
 */
export class ApiGatewayV2RequestEnricher implements IRequestEnricher<ApiGatewayV2Context> {
  constructor(
    private readonly routeFinder: IRouteFinder,
    private readonly httpHeaderMappings: IHttpHeaderMappings,
  ) {}

  enrich<TRequest>(_request: TRequest, context: ApiGatewayV2Context): Record<string, unknown> {
    const route = this.routeFinder.find(context.method ?? '', context.path ?? '');

    if (route === undefined) {
      return {};
    }

    const dictionary: Record<string, unknown> = {};
    const request = context.apiGatewayProxyRequest;

    DictionaryUtils.mapOnto(
      dictionary,
      (request.queryStringParameters ?? undefined) as Record<string, unknown> | undefined,
    );
    DictionaryUtils.mapOnto(
      dictionary,
      (request.pathParameters ?? undefined) as Record<string, unknown> | undefined,
    );

    DictionaryUtils.mapOnto<unknown>(
      dictionary,
      DictionaryUtils.filterAndReplace(context.combinedHeaders(), this.httpHeaderMappings.getMappings()),
    );

    DictionaryUtils.mapOnto(dictionary, ApiGatewayV2RequestEnricher.cleanUp(route.parameters));

    return dictionary;
  }

  private static cleanUp(source: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (!String(value).startsWith('{')) {
        output[key] = value;
      }
    }
    return output;
  }
}

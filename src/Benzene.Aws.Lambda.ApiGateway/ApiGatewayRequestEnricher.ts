import { IRequestEnricher } from '@benzenejs/abstractions-message-handlers';
import { DictionaryUtils } from '@benzenejs/core';
import { IHttpHeaderMappings, IRouteFinder } from '@benzenejs/http';
import { ApiGatewayContext } from './ApiGatewayContext';
import { QueryStringFirstWinsMapper } from './QueryStringFirstWinsMapper';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayRequestEnricher.
 *
 * Enriches the deserialized request with values pulled out of the HTTP request that don't come from
 * the body — query-string parameters, path parameters, mapped headers, and route parameters —
 * layered on with `DictionaryUtils.mapOnto` (first value wins per key). Returns an empty object when
 * no route matches.
 *
 * A repeated query-string key resolves FIRST-value-wins (.NET R7-10 #90) via
 * `QueryStringFirstWinsMapper.forV1` — the multi-value map's first value per key, falling back to
 * the single-value map — matching the Express adapter and the v2 enricher.
 *
 * .NET-PascalCase -> Node-camelCase: `apiGatewayProxyRequest.queryStringParameters` / `.pathParameters`
 * / `.headers`. `@types/aws-lambda` types these as `{ [name]: string | undefined }`, so header
 * entries with an undefined value are dropped before `filterAndReplace`. `CleanUp` (drop route
 * parameters whose value still looks like an unfilled `{token}`) is preserved.
 */
export class ApiGatewayRequestEnricher implements IRequestEnricher<ApiGatewayContext> {
  constructor(
    private readonly routeFinder: IRouteFinder,
    private readonly httpHeaderMappings: IHttpHeaderMappings,
  ) {}

  enrich<TRequest>(_request: TRequest, context: ApiGatewayContext): Record<string, unknown> {
    const request = context.apiGatewayProxyRequest;
    const route = this.routeFinder.find(request.httpMethod, request.path);

    if (route === undefined) {
      return {};
    }

    const dictionary: Record<string, unknown> = {};

    // First-value-wins for a repeated query key, matching the Express adapter — see
    // QueryStringFirstWinsMapper.
    DictionaryUtils.mapOnto(
      dictionary,
      QueryStringFirstWinsMapper.forV1(request) as Record<string, unknown> | undefined,
    );
    DictionaryUtils.mapOnto(
      dictionary,
      (request.pathParameters ?? undefined) as Record<string, unknown> | undefined,
    );

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers ?? {})) {
      if (value !== undefined) {
        headers[key] = value;
      }
    }
    DictionaryUtils.mapOnto<unknown>(
      dictionary,
      DictionaryUtils.filterAndReplace(headers, this.httpHeaderMappings.getMappings()),
    );

    DictionaryUtils.mapOnto(dictionary, ApiGatewayRequestEnricher.cleanUp(route.parameters));

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

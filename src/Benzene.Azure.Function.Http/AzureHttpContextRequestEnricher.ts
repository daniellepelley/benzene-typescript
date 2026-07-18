import { IRequestEnricher } from '@benzene/abstractions-message-handlers';
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { DictionaryUtils } from '@benzene/core';
import { IRouteFinder } from '@benzene/http';
import { AzureHttpContext, azureHttpRequestPath } from './AzureHttpContext';
import { AzureHttpHeadersToBodyGetter } from './AzureHttpHeadersToBodyGetter';

/**
 * Port of Benzene.Azure.Function.AspNet.AspNetContextRequestEnricher.
 *
 * Enriches the deserialized request with values pulled out of the HTTP request that don't come from
 * the body — query-string parameters, mapped headers (via `AzureHttpHeadersToBodyGetter`), and matched
 * route parameters — layered on with `DictionaryUtils.mapOnto` (first value wins per key). Returns an
 * empty object when no route matches.
 *
 * FIELD MAPPING: C# `HttpRequest.Query` (`IQueryCollection`) -> `@azure/functions`
 * `HttpRequest.query` (a `URLSearchParams`), converted to a record; method + path via
 * `httpRequest.method` + `azureHttpRequestPath(...)`. `CleanUp` is preserved as an identity copy
 * (the `{token}`-dropping filter is commented out in the C# source, so it is a straight copy there too).
 */
export class AzureHttpContextRequestEnricher implements IRequestEnricher<AzureHttpContext> {
  private readonly headersToBodyGetter: IMessageHeadersGetter<AzureHttpContext> =
    new AzureHttpHeadersToBodyGetter();

  constructor(private readonly routeFinder: IRouteFinder) {}

  enrich<TRequest>(_request: TRequest, context: AzureHttpContext): Record<string, unknown> {
    const route = this.routeFinder.find(
      context.httpRequest.method,
      azureHttpRequestPath(context.httpRequest),
    );

    if (route === undefined) {
      return {};
    }

    const dictionary: Record<string, unknown> = {};

    DictionaryUtils.mapOnto<unknown>(
      dictionary,
      AzureHttpContextRequestEnricher.queryToRecord(context.httpRequest.query),
    );
    DictionaryUtils.mapOnto<unknown>(dictionary, this.headersToBodyGetter.getHeaders(context));
    DictionaryUtils.mapOnto(dictionary, AzureHttpContextRequestEnricher.cleanUp(route.parameters));

    return dictionary;
  }

  private static queryToRecord(query: URLSearchParams): Record<string, string> {
    const output: Record<string, string> = {};
    query.forEach((value, key) => {
      if (!(key in output)) {
        output[key] = value;
      }
    });
    return output;
  }

  private static cleanUp(source: Record<string, unknown>): Record<string, unknown> {
    return { ...source };
  }
}

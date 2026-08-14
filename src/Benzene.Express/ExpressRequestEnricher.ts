import { IRequestEnricher } from '@benzenejs/abstractions-message-handlers';
import { DictionaryUtils } from '@benzenejs/core';
import { IHttpHeaderMappings, IRouteFinder } from '@benzenejs/http';
import { ExpressContext } from './ExpressContext';

/**
 * Enriches the deserialized request with values that don't come from the body - query-string parameters,
 * route (path) parameters, and mapped headers - layered on with `DictionaryUtils.mapOnto` (first value
 * wins per key). Returns an empty object when no route matches.
 * Express analog of `Benzene.AspNet.Core.AspNetRequestEnricher`.
 */
export class ExpressRequestEnricher implements IRequestEnricher<ExpressContext> {
  constructor(
    private readonly routeFinder: IRouteFinder,
    private readonly httpHeaderMappings: IHttpHeaderMappings,
  ) {}

  enrich<TRequest>(_request: TRequest, context: ExpressContext): Record<string, unknown> {
    const route = this.routeFinder.find(context.method, context.path);
    if (route === undefined) {
      return {};
    }

    const dictionary: Record<string, unknown> = {};

    DictionaryUtils.mapOnto<unknown>(dictionary, context.query);
    DictionaryUtils.mapOnto<unknown>(
      dictionary,
      DictionaryUtils.filterAndReplace(context.headers, this.httpHeaderMappings.getMappings()),
    );
    DictionaryUtils.mapOnto(dictionary, ExpressRequestEnricher.cleanUp(route.parameters));

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

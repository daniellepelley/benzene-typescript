import { IRequestEnricher, IRequestMapper } from '@benzenejs/abstractions-message-handlers';
import { DictionaryUtils } from '../Helper/DictionaryUtils';

/**
 * Decorates another `IRequestMapper<TContext>`, applying every registered `IRequestEnricher<TContext>`
 * onto the mapped request afterwards, so out-of-band values (route parameters, headers, claims, ...)
 * can populate request properties that don't come from the message body.
 * Port of Benzene.Core.MessageHandlers.Request.EnrichingRequestMapper&lt;TContext&gt;.
 *
 * If the inner mapper returns nothing, enrichment is skipped. Enrichers are folded onto an
 * accumulator dictionary in registration order, and a fold step only fills in a key still missing or
 * default — so it's earlier enrichers that take precedence for a given property.
 */
export class EnrichingRequestMapper<TContext> implements IRequestMapper<TContext> {
  private readonly enrichers: IRequestEnricher<TContext>[];

  constructor(
    private readonly requestMapper: IRequestMapper<TContext>,
    enrichers: Iterable<IRequestEnricher<TContext>>,
  ) {
    this.enrichers = Array.from(enrichers);
  }

  getBody<TRequest>(context: TContext): TRequest | undefined {
    const request = this.requestMapper.getBody<TRequest>(context);

    if (request === undefined || request === null || this.enrichers.length === 0) {
      return request;
    }

    // A bodyless (or empty-object) request has no properties for `enrich` to match by name: C# fills a
    // default instance of TRequest's declared properties, but TypeScript erases TRequest, so here the
    // enrichment IS the request. This is what lets `GET /benzene/spec?type=…` reach the handler as
    // `{ type }` (contract-document.md §7), and `GET /orders/{id}` as `{ id }`.
    // Earlier enrichers win, as in the fold below; keys keep their case (the fold lower-cases them).
    if (typeof request === 'object' && Object.keys(request as object).length === 0) {
      const target = request as Record<string, unknown>;
      for (const enricher of this.enrichers) {
        for (const [key, value] of Object.entries(enricher.enrich(request, context))) {
          const taken = Object.keys(target).some((k) => k.toLowerCase() === key.toLowerCase());
          if (value !== undefined && value !== null && !taken) {
            target[key] = value;
          }
        }
      }
      return request;
    }

    let dictionary: Record<string, unknown> = {};
    for (const enricher of this.enrichers) {
      dictionary = DictionaryUtils.mapOnto(dictionary, enricher.enrich(request, context));
    }

    return DictionaryUtils.enrich(request, dictionary);
  }
}

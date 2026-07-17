import { IRequestEnricher, IRequestMapper } from '@benzene/abstractions-message-handlers';
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

    let dictionary: Record<string, unknown> = {};
    for (const enricher of this.enrichers) {
      dictionary = DictionaryUtils.mapOnto(dictionary, enricher.enrich(request, context));
    }

    return DictionaryUtils.enrich(request, dictionary);
  }
}

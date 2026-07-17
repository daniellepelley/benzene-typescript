import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Supplies out-of-band values (route parameters, headers, auth claims, ...) to be applied onto the
 * already-deserialized request, so request properties that don't come from the message body can
 * still be populated. An `EnrichingRequestMapper<TContext>` maps the returned dictionary's entries
 * onto the request's properties by matching key to property name (case-insensitively).
 * Port of Benzene.Abstractions.MessageHandlers.Request.IRequestEnricher&lt;TContext&gt;
 * (C# `IDictionary<string, object>` maps to `Record<string, unknown>`).
 */
export interface IRequestEnricher<TContext> {
  /** Derives additional values to apply onto the deserialized request. Port of C# `Enrich<TRequest>`. */
  enrich<TRequest>(request: TRequest, context: TContext): Record<string, unknown>;
}

export const IRequestEnricher: ServiceToken<IRequestEnricher<unknown>> =
  serviceToken<IRequestEnricher<unknown>>('IRequestEnricher');

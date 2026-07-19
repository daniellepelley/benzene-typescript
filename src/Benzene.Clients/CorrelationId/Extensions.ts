import { ClientBuilder } from '../ClientBuilder';
import { CorrelationIdBenzeneMessageClientWrapper } from './CorrelationIdBenzeneMessageClientWrapper';

/**
 * Port of Benzene.Clients.CorrelationId.Extensions.
 *
 * C# extension method `WithCorrelationId(this ClientBuilder)` -> a free function taking the builder,
 * adding the `CorrelationIdBenzeneMessageClientWrapper` decorator. Returns the builder for chaining.
 */
export function withCorrelationId(source: ClientBuilder): ClientBuilder {
  return source.withDependencyWrapper(new CorrelationIdBenzeneMessageClientWrapper());
}

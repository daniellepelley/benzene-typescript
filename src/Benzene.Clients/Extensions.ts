import { ClientBuilder } from './ClientBuilder';
import { RetryBenzeneMessageClientWrapper } from './RetryBenzeneMessageClientWrapper';

/**
 * Port of Benzene.Clients.Extensions.
 *
 * C# extension method `WithRetry(this ClientBuilder, int numberOfRetries)` -> a free function taking
 * the builder, adding the `RetryBenzeneMessageClientWrapper` decorator. Returns the builder for
 * chaining.
 */
export function withRetry(source: ClientBuilder, numberOfRetries: number): ClientBuilder {
  return source.withDependencyWrapper(new RetryBenzeneMessageClientWrapper(numberOfRetries));
}

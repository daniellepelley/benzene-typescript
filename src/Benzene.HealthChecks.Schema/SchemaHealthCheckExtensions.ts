/** Port of Benzene.HealthChecks.Schema.SchemaHealthCheckExtensions. */
import { IHealthCheckBuilder } from '@benzenejs/health-checks-core';
import { SchemaHealthCheck } from './SchemaHealthCheck';

/**
 * Adds a {@link SchemaHealthCheck} to the health-check pipeline: it reports the served Contract Document's
 * `contractHash`, resolving the spec feeds from the container when the check runs.
 *
 * PORTING NOTES: C#'s `AddSchemaHealthCheck` uses the `AddHealthCheck(Func<IServiceResolver, ...>)`
 * overload, which the port splits out as `addHealthCheckFn` (a class constructor and a resolver
 * function are indistinguishable once TypeScript erases their types).
 */
export function addSchemaHealthCheck(source: IHealthCheckBuilder): IHealthCheckBuilder {
  return source.addHealthCheckFn((resolver) => new SchemaHealthCheck(resolver));
}

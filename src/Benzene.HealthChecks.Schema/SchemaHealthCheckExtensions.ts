/** Port of Benzene.HealthChecks.Schema.SchemaHealthCheckExtensions. */
import { IMessageHandlerDefinitionLookUp } from '@benzenejs/abstractions-message-handlers';
import { ITypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import { IHealthCheckBuilder } from '@benzenejs/health-checks-core';
import { SchemaHealthCheck } from './SchemaHealthCheck';

/**
 * Adds a {@link SchemaHealthCheck} to the health-check pipeline, resolving the handler lookup and the
 * registered JSON-schema sources from the container when the check runs.
 *
 * PORTING NOTES: C#'s `AddSchemaHealthCheck` uses the `AddHealthCheck(Func<IServiceResolver, ...>)`
 * overload, which the port splits out as `addHealthCheckFn` (a class constructor and a resolver
 * function are indistinguishable once TypeScript erases their types). The `ITypeJsonSchemaSource`s are
 * resolved here for the same reason `SpecBuilder` pulls them from the resolver — TS sources schemas from
 * the validators rather than CLR reflection (see {@link SchemaHealthCheck}).
 */
export function addSchemaHealthCheck(source: IHealthCheckBuilder): IHealthCheckBuilder {
  return source.addHealthCheckFn(
    (resolver) =>
      new SchemaHealthCheck(
        resolver.getService(IMessageHandlerDefinitionLookUp),
        resolver.getServices(ITypeJsonSchemaSource),
      ),
  );
}

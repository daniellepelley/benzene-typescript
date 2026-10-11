import { describe, expect, it } from 'vitest';
import { Constructor, IServiceResolver } from '@benzenejs/abstractions';
import { IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { ITypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import {
  HealthCheckResponse,
  HealthCheckResult,
  SchemaHealthCheckConstants,
} from '@benzenejs/health-checks-core';
import { ClientHashMatch, ClientHealthCheckProcessor } from '@benzenejs/clients-health-checks';
import { applyTopicScope, parseContractDocument } from '@benzenejs/codegen-client';
import { addMessageHandlers, MessageHandlerDefinition, setApplicationInfo } from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { SpecBuilder, SpecRequest } from '@benzenejs/schema-openapi';
import { SchemaHealthCheck } from '@benzenejs/health-checks-schema';

/**
 * Ports Benzene.Test.HealthChecks.SchemaHealthCheckTest: the provider publishes the `contractHash` of the
 * Contract Document it serves (contract-document.md §6.1), and a client generated from that same served
 * document embeds the same value - so the provider `SchemaHealthCheck` and the consumer
 * `ClientHealthCheckProcessor` form a drift loop: matching hashes report a match, a changed contract
 * reports drift.
 */

class CreateThing {}
class ThingCreated {}
class NoopHandler {}

/** A source that returns a fixed schema per type name - the runtime stand-in for reflected schemas. */
function sourceOf(schemas: Record<string, Record<string, unknown>>): ITypeJsonSchemaSource {
  return { getJsonSchema: (type: Constructor<unknown>) => schemas[type.name] };
}

const sources = [
  sourceOf({
    CreateThing: { type: 'object', properties: { name: { type: 'string' } } },
    ThingCreated: { type: 'object', properties: { id: { type: 'string' } } },
  }),
];

function serviceWith(topics: string[], schemaSources: ITypeJsonSchemaSource[] = sources): IServiceResolver {
  const container = new DefaultBenzeneServiceContainer();
  addMessageHandlers(container);
  setApplicationInfo(container, 'things', '1.0.0', '');
  for (const source of schemaSources) {
    container.addSingletonInstance(ITypeJsonSchemaSource, source);
  }
  for (const topic of topics) {
    container.addSingletonInstance(
      IMessageHandlerDefinition,
      MessageHandlerDefinition.createInstance(topic, '', CreateThing, ThingCreated, NoopHandler),
    );
  }
  return container.createServiceResolverFactory().createScope();
}

/** What a default generated client embeds: the contractHash of the served document, no include-list. */
function clientBakedHash(resolver: IServiceResolver): string {
  const served = parseContractDocument(new SpecBuilder().createSpec(resolver, new SpecRequest('benzene', 'json')));
  return applyTopicScope(served, {}).contractHash!;
}

function match(schemaResult: HealthCheckResult, clientHash: string): ClientHashMatch {
  const providerResponse = new HealthCheckResponse(true, { [SchemaHealthCheckConstants.type]: schemaResult });
  const processed = ClientHealthCheckProcessor.process(providerResponse, clientHash);
  return processed.healthChecks[SchemaHealthCheckConstants.type]!.data[SchemaHealthCheckConstants.matchKey] as ClientHashMatch;
}

describe('SchemaHealthCheck', () => {
  it("publishes the served document's contractHash", async () => {
    const resolver = serviceWith(['thing:create']);
    const served = JSON.parse(new SpecBuilder().createSpec(resolver, new SpecRequest())) as { contractHash: string };

    const result = await new SchemaHealthCheck(resolver).executeAsync();

    expect(result.type).toBe(SchemaHealthCheckConstants.type);
    expect(result.status).toBe('ok');
    expect(result.data[SchemaHealthCheckConstants.hashCodeKey]).toBe(served.contractHash);
    expect(served.contractHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('reflects the resolved schema shape, not just the topic set', async () => {
    const withSchemas = await new SchemaHealthCheck(serviceWith(['thing:create'])).executeAsync();
    const withoutSchemas = await new SchemaHealthCheck(serviceWith(['thing:create'], [])).executeAsync();

    expect(withSchemas.data[SchemaHealthCheckConstants.hashCodeKey]).not.toBe(
      withoutSchemas.data[SchemaHealthCheckConstants.hashCodeKey],
    );
  });

  it('end to end: a client generated from the served document reports a match', async () => {
    const resolver = serviceWith(['thing:create']);
    const schemaResult = (await new SchemaHealthCheck(resolver).executeAsync()) as HealthCheckResult;

    expect(match(schemaResult, clientBakedHash(resolver)).isMatch).toBe(true);
  });

  it('end to end: a client generated from an older contract reports drift', async () => {
    const clientHash = clientBakedHash(serviceWith(['thing:create']));

    // The provider now exposes an extra handler.
    const schemaResult = (await new SchemaHealthCheck(
      serviceWith(['thing:create', 'thing:delete']),
    ).executeAsync()) as HealthCheckResult;

    expect(match(schemaResult, clientHash).isMatch).toBe(false);
  });
});

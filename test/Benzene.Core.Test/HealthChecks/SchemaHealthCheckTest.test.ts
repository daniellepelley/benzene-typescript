import { describe, expect, it } from 'vitest';
import { Constructor } from '@benzene/abstractions';
import {
  IMessageHandlerDefinition,
  IMessageHandlerDefinitionLookUp,
} from '@benzene/abstractions-message-handlers';
import { ITypeJsonSchemaSource } from '@benzene/abstractions-validation';
import {
  HealthCheckResponse,
  HealthCheckResult,
  SchemaHealthCheckConstants,
} from '@benzene/health-checks-core';
import { ClientHashMatch, ClientHealthCheckProcessor } from '@benzene/clients-health-checks';
import { MeshHashing } from '@benzene/mesh-contracts';
import { EventServiceDocumentBuilder, SchemaBuilder } from '@benzene/schema-openapi';
import { SchemaHealthCheck } from '@benzene/health-checks-schema';

/**
 * Ports Benzene.Test.HealthChecks.SchemaHealthCheckTest: the provider publishes exactly the canonical
 * contract hash a client compares against, so the provider `SchemaHealthCheck` and the consumer
 * `ClientHealthCheckProcessor` form a drift loop — matching hashes report a match, a changed contract
 * reports drift.
 *
 * PORT DIVERGENCE (see SchemaHealthCheck): TS resolves each payload schema from `ITypeJsonSchemaSource`s
 * rather than reflecting the type, so the check takes the sources and the hash reflects the resolved
 * schema shape.
 */

// Simple request/response types so the schema sources have something to key on.
class CreateThing {}
class ThingCreated {}

/** A source that returns a fixed schema per type name — the runtime stand-in for reflected schemas. */
function sourceOf(schemas: Record<string, Record<string, unknown>>): ITypeJsonSchemaSource {
  return {
    getJsonSchema: (type: Constructor<unknown>) => schemas[type.name],
  };
}

function handlerDef(topic: string, requestType: unknown, responseType: unknown): IMessageHandlerDefinition {
  return {
    topic: { id: topic, version: '' },
    requestType,
    responseType,
    handlerType: class {},
  } as unknown as IMessageHandlerDefinition;
}

function lookUpOf(...defs: IMessageHandlerDefinition[]): IMessageHandlerDefinitionLookUp {
  return {
    getAllHandlers: () => defs,
    findHandler: (t) => defs.find((d) => d.topic.id === t.id),
  };
}

const sources = [
  sourceOf({
    CreateThing: { type: 'object', properties: { name: { type: 'string' } } },
    ThingCreated: { type: 'object', properties: { id: { type: 'string' } } },
  }),
];

const handlers = () => [handlerDef('thing:create', CreateThing, ThingCreated)];

/** The canonical contract hash the same way the check computes it — build handlers-only, hash. */
function contractHash(defs: IMessageHandlerDefinition[], srcs: ITypeJsonSchemaSource[]): string {
  const json = new EventServiceDocumentBuilder(new SchemaBuilder(srcs))
    .addMessageHandlerDefinitions(defs)
    .generateJson();
  return MeshHashing.computeHash(json);
}

describe('SchemaHealthCheck', () => {
  it('publishes the canonical contract hash', async () => {
    const result = await new SchemaHealthCheck(lookUpOf(...handlers()), sources).executeAsync();

    expect(result.type).toBe(SchemaHealthCheckConstants.type);
    expect(result.status).toBe('ok');
    expect(result.data[SchemaHealthCheckConstants.hashCodeKey]).toBe(contractHash(handlers(), sources));
  });

  it('reflects the resolved schema shape, not just the topic set', async () => {
    const withSchemas = await new SchemaHealthCheck(lookUpOf(...handlers()), sources).executeAsync();
    const withoutSchemas = await new SchemaHealthCheck(lookUpOf(...handlers())).executeAsync();

    // Same handlers, different resolved schemas -> different hash (schemas are in the hash).
    expect(withSchemas.data[SchemaHealthCheckConstants.hashCodeKey]).not.toBe(
      withoutSchemas.data[SchemaHealthCheckConstants.hashCodeKey],
    );
  });

  it('end to end: a client baked against the current contract reports a match', async () => {
    const clientBakedHash = contractHash(handlers(), sources);

    const schemaResult = (await new SchemaHealthCheck(lookUpOf(...handlers()), sources).executeAsync()) as HealthCheckResult;
    const providerResponse = new HealthCheckResponse(true, { [SchemaHealthCheckConstants.type]: schemaResult });

    const processed = ClientHealthCheckProcessor.process(providerResponse, clientBakedHash);

    const match = processed.healthChecks[SchemaHealthCheckConstants.type]!.data[
      SchemaHealthCheckConstants.matchKey
    ] as ClientHashMatch;
    expect(match.isMatch).toBe(true);
  });

  it('end to end: a client baked against an old contract reports drift', async () => {
    // The client was generated against the original single-handler contract...
    const clientBakedHash = contractHash(handlers(), sources);

    // ...but the provider now exposes an extra handler.
    const changed = [
      handlerDef('thing:create', CreateThing, ThingCreated),
      handlerDef('thing:delete', CreateThing, ThingCreated),
    ];
    const schemaResult = (await new SchemaHealthCheck(lookUpOf(...changed), sources).executeAsync()) as HealthCheckResult;
    const providerResponse = new HealthCheckResponse(true, { [SchemaHealthCheckConstants.type]: schemaResult });

    const processed = ClientHealthCheckProcessor.process(providerResponse, clientBakedHash);

    const match = processed.healthChecks[SchemaHealthCheckConstants.type]!.data[
      SchemaHealthCheckConstants.matchKey
    ] as ClientHashMatch;
    expect(match.isMatch).toBe(false);
  });
});

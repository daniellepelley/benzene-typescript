import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { VoidResult } from '@benzenejs/abstractions';
import { ITopic } from '@benzenejs/abstractions-messages';
import {
  IMessageHandlerDefinition,
  IMessageHandlerDefinitionLookUp,
} from '@benzenejs/abstractions-message-handlers';
import { MapTypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import { registerZodSchema, ZodJsonSchemaSource } from '@benzenejs/zod';
import { MeshDescriptorFactory, MeshServiceInfo, ValidationMeshSchemaProvider } from '@benzenejs/mesh-wire';

/**
 * `ValidationMeshSchemaProvider` derives a topic's request/response payload schemas from the registered
 * validation schemas (here Zod) — the runtime replacement for .NET reflecting over the CLR type. Verifies
 * the provider resolves schemas by topic, omits `VoidResult` payloads, ignores unknown topics, and that the
 * schemas flow through `MeshDescriptorFactory` onto the descriptor's topics.
 */
class CreateOrder {
  customerId?: string;
}
class OrderConfirmation {
  orderId?: string;
}

registerZodSchema(CreateOrder, z.object({ customerId: z.string() }));
registerZodSchema(OrderConfirmation, z.object({ orderId: z.string() }));

function topic(id: string): ITopic {
  return { id, version: '' };
}

function definition(
  id: string,
  requestType: unknown,
  responseType: unknown,
): IMessageHandlerDefinition {
  return {
    topic: topic(id),
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

describe('ValidationMeshSchemaProvider', () => {
  it('resolves request and response schemas from the registered Zod schemas', () => {
    const provider = new ValidationMeshSchemaProvider(
      lookUpOf(definition('orders:create', CreateOrder, OrderConfirmation)),
      [new ZodJsonSchemaSource()],
    );

    const schemas = provider.getSchemas(topic('orders:create'));

    expect(schemas.request).toMatchObject({ type: 'object', properties: { customerId: { type: 'string' } } });
    expect(schemas.response).toMatchObject({ type: 'object', properties: { orderId: { type: 'string' } } });
  });

  it('omits a schema for a VoidResult payload', () => {
    const provider = new ValidationMeshSchemaProvider(
      lookUpOf(definition('order:placed', CreateOrder, VoidResult)),
      [new ZodJsonSchemaSource()],
    );

    const schemas = provider.getSchemas(topic('order:placed'));

    expect(schemas.request).toBeDefined();
    expect(schemas.response).toBeUndefined();
  });

  it('returns {} for a topic with no matching handler', () => {
    const provider = new ValidationMeshSchemaProvider(lookUpOf(), [new ZodJsonSchemaSource()]);
    expect(provider.getSchemas(topic('unknown'))).toEqual({});
  });

  it('lets a bring-your-own MapTypeJsonSchemaSource win over the validator source (registration order)', () => {
    const byo = new MapTypeJsonSchemaSource([[CreateOrder, { type: 'object', title: 'HandAuthored' }]]);
    const provider = new ValidationMeshSchemaProvider(
      lookUpOf(definition('orders:create', CreateOrder, OrderConfirmation)),
      [byo, new ZodJsonSchemaSource()],
    );

    // BYO covers CreateOrder → its curated schema wins; the response falls through to the Zod source.
    const schemas = provider.getSchemas(topic('orders:create'));
    expect(schemas.request).toEqual({ type: 'object', title: 'HandAuthored' });
    expect(schemas.response).toMatchObject({ type: 'object', properties: { orderId: { type: 'string' } } });
  });

  it('flows schemas onto the descriptor built by MeshDescriptorFactory', () => {
    const provider = new ValidationMeshSchemaProvider(
      lookUpOf(definition('orders:create', CreateOrder, OrderConfirmation)),
      [new ZodJsonSchemaSource()],
    );
    const descriptor = MeshDescriptorFactory.create(
      lookUpOf(definition('orders:create', CreateOrder, OrderConfirmation)),
      new MeshServiceInfo('orders'),
      provider,
    );

    const orders = descriptor.topics.find((t) => t.id === 'orders:create');
    expect(orders?.requestSchema).toMatchObject({ type: 'object', properties: { customerId: { type: 'string' } } });
    expect(orders?.responseSchema).toMatchObject({ type: 'object', properties: { orderId: { type: 'string' } } });
  });
});

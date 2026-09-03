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
import { MeshDescriptorFactory, MeshJson, MeshServiceInfo, ValidationMeshSchemaProvider } from '@benzenejs/mesh-wire';

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

  it('yields identical descriptors and descriptorHash for zod schemas declaring the same properties in different orders', () => {
    // W2.1 acceptance: .NET's MeshSchemaGenerator sorts `required` ordinally so the same contract always
    // derives the same descriptor (and hash); the zod seam must match, or property-declaration order —
    // which carries no contract semantics — would flap the descriptorHash.
    class OrderedRequest {}
    class ReorderedRequest {}
    registerZodSchema(OrderedRequest, z.object({ zebra: z.string(), apple: z.string(), mango: z.string() }));
    registerZodSchema(ReorderedRequest, z.object({ apple: z.string(), mango: z.string(), zebra: z.string() }));

    const descriptorOf = (requestType: unknown) =>
      MeshDescriptorFactory.create(
        lookUpOf(definition('orders:create', requestType, VoidResult)),
        new MeshServiceInfo('orders'),
        new ValidationMeshSchemaProvider(
          lookUpOf(definition('orders:create', requestType, VoidResult)),
          [new ZodJsonSchemaSource()],
        ),
      );

    const first = descriptorOf(OrderedRequest);
    const second = descriptorOf(ReorderedRequest);

    expect(first.topics[0]!.requestSchema!['required']).toEqual(['apple', 'mango', 'zebra']);
    // Identical descriptors: key-order-insensitive for objects (JSON object members are unordered — .NET's
    // own `properties` JsonObject follows reflection order), order-sensitive for arrays (so this bites if
    // `required` ever stops being sorted). The hash equality below is the strict canonical-bytes check.
    expect(JSON.parse(MeshJson.serialize(second))).toEqual(JSON.parse(MeshJson.serialize(first)));
    expect(first.descriptorHash).toBe(second.descriptorHash);
  });

  it('hashes a provider-supplied schema with an unsorted required identically to the sorted one', () => {
    // The canonicalization seam, independent of any adapter: a bring-your-own source may emit `required`
    // in any order, and the §2.2 canonical form must absorb it (sort exactly the `required` member — other
    // arrays, like `enum`, keep their semantic order and stay hash-significant).
    const descriptorWith = (schema: Record<string, unknown>) =>
      MeshDescriptorFactory.create(
        lookUpOf(definition('orders:create', CreateOrder, VoidResult)),
        new MeshServiceInfo('orders'),
        new ValidationMeshSchemaProvider(
          lookUpOf(definition('orders:create', CreateOrder, VoidResult)),
          [new MapTypeJsonSchemaSource([[CreateOrder, schema]])],
        ),
      );

    const unsorted = descriptorWith({ type: 'object', required: ['zebra', 'apple'], properties: {} });
    const sorted = descriptorWith({ type: 'object', required: ['apple', 'zebra'], properties: {} });
    expect(unsorted.descriptorHash).toBe(sorted.descriptorHash);

    // An order-significant array is NOT normalized: reordering an enum still changes the hash.
    const enumFirst = descriptorWith({ type: 'string', enum: ['new', 'paid'] });
    const enumReordered = descriptorWith({ type: 'string', enum: ['paid', 'new'] });
    expect(enumFirst.descriptorHash).not.toBe(enumReordered.descriptorHash);
  });
});

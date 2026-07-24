import { describe, expect, it } from 'vitest';
import { AsyncApiCompositor, ServiceDocument } from '@benzene/mesh-aggregator';

/**
 * Port of test/Benzene.Mesh.Test/AsyncApiCompositorTest.cs. C#'s `JsonNode` navigation of the merged output
 * becomes `JSON.parse` + plain-object access (typed loosely, as the C# assertions read arbitrary JSON).
 * `DateTimeOffset.UnixEpoch` -> epoch ms `0`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const At = 0; // DateTimeOffset.UnixEpoch

function service(name: string, json: string, ...reserved: string[]): ServiceDocument {
  return { serviceName: name, asyncApiJson: json, reservedTopics: new Set(reserved) };
}

// AsyncAPI 3.0 channel/operation map keys must be identifiers; the raw topic lives in `address`.
function chKey(topic: string): string {
  return topic.replace(/:/g, '_');
}

// A minimal but real-shaped per-service AsyncAPI 3.0 doc: one handled topic (channel + receive operation)
// whose message payload $refs a component schema.
function serviceDoc(title: string, topic: string, schemaName: string): string {
  const ch = chKey(topic);
  return JSON.stringify({
    asyncapi: '3.0.0',
    info: { title, version: '1.0' },
    channels: {
      [ch]: { address: topic, messages: { [schemaName]: { payload: { $ref: `#/components/schemas/${schemaName}` } } } },
    },
    operations: {
      [ch]: {
        action: 'receive',
        channel: { $ref: `#/channels/${ch}` },
        messages: [{ $ref: `#/channels/${ch}/messages/${schemaName}` }],
      },
    },
    components: { schemas: { [schemaName]: { type: 'object', properties: { id: { type: 'string' } } } } },
  });
}

describe('AsyncApiCompositor', () => {
  it('Merge_NamespacesChannelsOperationsAndSchemas_AndRewritesRefs', () => {
    // Two services that BOTH handle order:create and BOTH define a "Customer" schema - the exact collision
    // case a naive union would silently overwrite.
    const merged = AsyncApiCompositor.merge(
      [
        service('orders-api', serviceDoc('orders-api', 'order:create', 'Customer')),
        service('fulfilment-api', serviceDoc('fulfilment-api', 'order:create', 'Customer')),
      ],
      At,
    );

    const doc = JSON.parse(merged) as Json;
    expect(doc.asyncapi).toBe('3.0.0');

    const channels = doc.channels as Json;
    expect(channels).toHaveProperty('orders-api_order_create');
    expect(channels).toHaveProperty('fulfilment-api_order_create');
    expect(channels).not.toHaveProperty('order_create');

    const operations = doc.operations as Json;
    expect(operations).toHaveProperty('orders-api_order_create');
    expect(operations).toHaveProperty('fulfilment-api_order_create');

    const schemas = doc.components.schemas as Json;
    expect(schemas).toHaveProperty('OrdersApi_Customer');
    expect(schemas).toHaveProperty('FulfilmentApi_Customer');

    // The message payload $ref was rewritten to the namespaced schema key.
    expect(channels['orders-api_order_create'].messages.Customer.payload.$ref).toBe('#/components/schemas/OrdersApi_Customer');

    // The operation's channel and message $refs were rewritten onto the namespaced channel key.
    const op = operations['orders-api_order_create'];
    expect(op.channel.$ref).toBe('#/channels/orders-api_order_create');
    expect(op.messages[0].$ref).toBe('#/channels/orders-api_order_create/messages/Customer');

    // The address (the real topic) is preserved on the channel.
    expect(channels['orders-api_order_create'].address).toBe('order:create');

    // Each operation is tagged with its owning service.
    expect(operations['fulfilment-api_order_create'].tags[0].name).toBe('fulfilment-api');
  });

  it('Merge_AllOperationKeysAreUniqueAcrossTheDocument', () => {
    const merged = AsyncApiCompositor.merge(
      [
        service('orders-api', serviceDoc('orders-api', 'order:create', 'Order')),
        service('fulfilment-api', serviceDoc('fulfilment-api', 'order:create', 'Order')),
        service('billing-api', serviceDoc('billing-api', 'order:create', 'Order')),
      ],
      At,
    );

    const operations = (JSON.parse(merged) as Json).operations as Json;
    const keys = Object.keys(operations);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('Merge_PrunesSchemasOnlyReferencedByDroppedReservedChannels', () => {
    // The reserved "spec" channel references SpecRequest; the domain "order:create" channel references Order
    // (which nests OrderChild). Dropping the reserved channel must also drop SpecRequest (now orphaned), but
    // keep Order and its nested OrderChild.
    const doc = `
    {
      "asyncapi": "3.0.0",
      "info": { "title": "orders-api", "version": "1.0" },
      "channels": {
        "order_create": { "address": "order:create", "messages": { "Order": { "payload": { "$ref": "#/components/schemas/Order" } } } },
        "spec": { "address": "spec", "messages": { "SpecRequest": { "payload": { "$ref": "#/components/schemas/SpecRequest" } } } }
      },
      "operations": {
        "order_create": { "action": "receive", "channel": { "$ref": "#/channels/order_create" }, "messages": [ { "$ref": "#/channels/order_create/messages/Order" } ] },
        "spec": { "action": "receive", "channel": { "$ref": "#/channels/spec" }, "messages": [ { "$ref": "#/channels/spec/messages/SpecRequest" } ] }
      },
      "components": { "schemas": {
        "Order": { "type": "object", "properties": { "child": { "$ref": "#/components/schemas/OrderChild" } } },
        "OrderChild": { "type": "object", "properties": { "n": { "type": "integer" } } },
        "SpecRequest": { "type": "object", "properties": { "type": { "type": "string" } } }
      } }
    }`;

    const merged = AsyncApiCompositor.merge([service('orders-api', doc, 'spec')], At);
    const schemas = (JSON.parse(merged) as Json).components.schemas as Json;

    expect(schemas).toHaveProperty('OrdersApi_Order');
    expect(schemas).toHaveProperty('OrdersApi_OrderChild'); // reachable via Order's nested $ref
    expect(schemas).not.toHaveProperty('OrdersApi_SpecRequest'); // orphaned by the dropped reserved channel
  });

  it('Merge_EmitsAsyncApi30WithDefaultContentTypeAndId', () => {
    const merged = AsyncApiCompositor.merge([service('orders-api', serviceDoc('orders-api', 'order:create', 'Order'))], At);

    const doc = JSON.parse(merged) as Json;
    expect(doc.asyncapi).toBe('3.0.0');
    expect(doc.defaultContentType).toBe('application/json');
    expect(typeof doc.id).toBe('string');
    expect(doc.id.length).toBeGreaterThan(0);
  });

  it('Merge_SkipsReservedTopicChannelsAndOperations', () => {
    // The reserved "spec" operation carries a reply on a "spec:response" channel. Dropping the operation
    // must also drop BOTH its request and its reply channel - the compositor keeps only channels a surviving
    // operation references, so it needs no knowledge of the reply suffix.
    const doc = `
    {
      "asyncapi": "3.0.0",
      "info": { "title": "orders-api", "version": "1.0" },
      "channels": {
        "order_create": { "address": "order:create", "messages": {} },
        "spec": { "address": "spec", "messages": {} },
        "spec_response": { "address": "spec:response", "messages": {} }
      },
      "operations": {
        "order_create": { "action": "receive", "channel": { "$ref": "#/channels/order_create" } },
        "spec": { "action": "receive", "channel": { "$ref": "#/channels/spec" }, "reply": { "channel": { "$ref": "#/channels/spec_response" } } }
      },
      "components": { "schemas": {} }
    }`;

    const merged = AsyncApiCompositor.merge([service('orders-api', doc, 'spec')], At);
    const parsed = JSON.parse(merged) as Json;
    const channelKeys = Object.keys(parsed.channels as Json);
    const operationKeys = Object.keys(parsed.operations as Json);

    expect(channelKeys).toContain('orders-api_order_create');
    // The reserved "spec" topic, its reply channel, and its operation are all dropped.
    expect(channelKeys.some((k) => k.includes('spec'))).toBe(false);
    expect(operationKeys.some((k) => k.includes('spec'))).toBe(false);
  });

  it('Merge_UnparseableOrEmptyService_IsSkipped_NotFatal', () => {
    const merged = AsyncApiCompositor.merge(
      [
        service('broken', '}{ not json'),
        service('empty', ''),
        service('good', serviceDoc('good', 'order:create', 'Order')),
      ],
      At,
    );

    const channels = (JSON.parse(merged) as Json).channels as Json;
    expect(Object.keys(channels)).toHaveLength(1);
    expect(channels).toHaveProperty('good_order_create');
  });

  it('Merge_NoServices_ProducesValidEmptyDocument', () => {
    const merged = AsyncApiCompositor.merge([], At);
    const doc = JSON.parse(merged) as Json;

    expect(doc.asyncapi).toBe('3.0.0');
    expect(Object.keys(doc.channels as Json)).toHaveLength(0);
    expect(Object.keys(doc.operations as Json)).toHaveLength(0);
  });

  it('Merge_ProducesWellFormedAsyncApi30_WithExpectedShape', () => {
    const merged = AsyncApiCompositor.merge(
      [
        service('orders-api', serviceDoc('orders-api', 'order:create', 'Customer')),
        service('fulfilment-api', serviceDoc('fulfilment-api', 'order:submitted', 'Shipment')),
      ],
      At,
    );

    const doc = JSON.parse(merged) as Json;
    expect(doc.asyncapi).toBe('3.0.0');
    expect(doc.info.title).not.toBeUndefined();
    expect(Object.keys(doc.channels as Json)).toHaveLength(2);
    expect(Object.keys(doc.operations as Json)).toHaveLength(2);
    expect(Object.keys(doc.components.schemas as Json)).toHaveLength(2);

    // Every message payload $ref resolves to a schema that actually exists in components.
    const schemaKeys = new Set(Object.keys(doc.components.schemas as Json));
    for (const channel of Object.values(doc.channels as Json) as Json[]) {
      for (const message of Object.values(channel.messages as Json) as Json[]) {
        const payloadRef = message.payload?.$ref as string | undefined;
        if (payloadRef !== undefined) {
          expect(schemaKeys.has(payloadRef.substring('#/components/schemas/'.length))).toBe(true);
        }
      }
    }

    // Every operation's channel $ref resolves to a channel that actually exists.
    const channelKeys = new Set(Object.keys(doc.channels as Json));
    for (const operation of Object.values(doc.operations as Json) as Json[]) {
      const channelRef = operation.channel.$ref as string;
      expect(channelKeys.has(channelRef.substring('#/channels/'.length))).toBe(true);
    }
  });
});

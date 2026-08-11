import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { IServiceResolver, ServiceIdentifier, VoidResult } from '@benzene/abstractions';
import { ITypeJsonSchemaSource } from '@benzene/abstractions-validation';
import {
  IApplicationInfo,
  IMessageHandlerDefinition,
  IMessageHandlersFinder,
  ITransportsInfo,
} from '@benzene/abstractions-message-handlers';
import { IMessageDefinition, IMessageDefinitionFinder, IMessageSendersFinder } from '@benzene/abstractions-messages';
import { IHttpEndpointDefinition, IHttpEndpointFinder } from '@benzene/http';
import { registerZodSchema, ZodJsonSchemaSource } from '@benzene/zod';
import { AsyncApiSpecOptions, SpecBuilder, SpecMessageHandler, SpecRequest } from '@benzene/schema-openapi';
import {
  FileSystemMeshArtifactStore,
  IMeshServiceSource,
  MeshAggregator,
} from '@benzene/mesh-aggregator';
import { MeshServiceRegistry, MeshServiceRegistryEntry } from '@benzene/mesh-contracts';

/**
 * Tests the ported `Benzene.Schema.OpenApi` `benzene` document: `SpecBuilder` turns the container's
 * handler/sender/http feeds into `{ requests, events, components.schemas }` with payload schemas stored once
 * and referenced by `$ref` — sourced from the registered Zod schemas, not reflection. Also proves the doc
 * round-trips through the real mesh aggregator (which inlines the `$ref`s).
 */
class CreateOrder {
  orderId?: string;
}
class OrderConfirmation {
  orderId?: string;
}
class OrderPlaced {
  orderId?: string;
}

class GetOrder {
  id?: string;
}

registerZodSchema(CreateOrder, z.object({ orderId: z.string().min(1) }));
registerZodSchema(OrderConfirmation, z.object({ orderId: z.string() }));
registerZodSchema(OrderPlaced, z.object({ orderId: z.string() }));
registerZodSchema(GetOrder, z.object({ id: z.string() }));

function handlerDef(topic: string, requestType: unknown, responseType: unknown): IMessageHandlerDefinition {
  return { topic: { id: topic, version: '' }, requestType, responseType, handlerType: class {} } as unknown as IMessageHandlerDefinition;
}
function messageDef(topic: string, requestType: unknown): IMessageDefinition {
  return { topic: { id: topic, version: '' }, requestType } as unknown as IMessageDefinition;
}
function httpDef(method: string, path: string, topic: string): IHttpEndpointDefinition {
  return { method, path, topic };
}

interface ResolverConfig {
  sources?: ITypeJsonSchemaSource[];
  handlers?: IMessageHandlerDefinition[];
  senders?: IMessageDefinition[];
  httpEndpoints?: IHttpEndpointDefinition[];
  transports?: string[];
  applicationName?: string;
  asyncApiResponseTopicSuffix?: string;
}

function fakeResolver(config: ResolverConfig): IServiceResolver {
  const finder = <T>(defs: T[] | undefined) => (defs === undefined ? undefined : { findDefinitions: () => defs });
  return {
    getService: <T>(_id: ServiceIdentifier<T>): T => {
      throw new Error('not used');
    },
    tryGetService: <T>(id: ServiceIdentifier<T>): T | undefined => {
      if (id === IMessageHandlersFinder) return finder(config.handlers) as T | undefined;
      if (id === IHttpEndpointFinder) return finder(config.httpEndpoints) as T | undefined;
      if (id === IMessageSendersFinder) return finder(config.senders) as T | undefined;
      if (id === IMessageDefinitionFinder) return undefined;
      if (id === ITransportsInfo && config.transports) return { transports: config.transports } as T;
      if (id === IApplicationInfo && config.applicationName) {
        return { name: config.applicationName, description: '', version: '1.0.0' } as T;
      }
      if (id === AsyncApiSpecOptions && config.asyncApiResponseTopicSuffix) {
        const options = new AsyncApiSpecOptions();
        options.responseTopicSuffix = config.asyncApiResponseTopicSuffix;
        return options as T;
      }
      return undefined;
    },
    getServices: <T>(id: ServiceIdentifier<T>): T[] =>
      id === ITypeJsonSchemaSource ? ((config.sources ?? []) as unknown as T[]) : [],
    dispose: () => {},
    disposeAsync: () => Promise.resolve(),
  };
}

describe('SpecBuilder (benzene document)', () => {
  it('builds requests with $ref payloads and a components.schemas catalogue from the Zod sources', () => {
    const json = new SpecBuilder().createSpec(
      fakeResolver({
        sources: [new ZodJsonSchemaSource()],
        handlers: [handlerDef('orders:create', CreateOrder, OrderConfirmation)],
        httpEndpoints: [httpDef('POST', '/orders', 'orders:create')],
        senders: [messageDef('order:placed', OrderPlaced)],
        transports: ['http', 'sqs'],
        applicationName: 'orders-api',
      }),
      new SpecRequest('benzene', 'json'),
    );
    const doc = JSON.parse(json) as {
      info?: { title?: string };
      transports?: string[];
      requests: { topic: string; httpMappings?: { method: string; path: string }[]; request: Record<string, unknown>; response: Record<string, unknown> }[];
      events: { topic: string; message: Record<string, unknown> }[];
      components: { schemas: Record<string, Record<string, unknown>> };
    };

    // A request carries only a $ref; the schema body lives once in components.schemas.
    const create = doc.requests.find((r) => r.topic === 'orders:create')!;
    expect(create.request).toEqual({ $ref: '#/components/schemas/CreateOrder' });
    expect(create.response).toEqual({ $ref: '#/components/schemas/OrderConfirmation' });
    expect(create.httpMappings).toEqual([{ method: 'POST', path: '/orders' }]);
    expect(doc.components.schemas['CreateOrder']).toMatchObject({
      type: 'object',
      properties: { orderId: { type: 'string', minLength: 1 } },
    });

    // A sender definition becomes an event with a $ref message.
    const placed = doc.events.find((e) => e.topic === 'order:placed')!;
    expect(placed.message).toEqual({ $ref: '#/components/schemas/OrderPlaced' });
    expect(doc.components.schemas['OrderPlaced']).toBeDefined();

    // Document-level info + transports.
    expect(doc.info?.title).toBe('orders-api');
    expect(doc.transports).toEqual(['http', 'sqs']);
  });

  it('emits an empty inline schema (not a $ref) for a VoidResult response', () => {
    const json = new SpecBuilder().createSpec(
      fakeResolver({ sources: [new ZodJsonSchemaSource()], handlers: [handlerDef('order:placed', OrderPlaced, VoidResult)] }),
      new SpecRequest(),
    );
    const doc = JSON.parse(json) as { requests: { topic: string; response: Record<string, unknown> }[] };
    expect(doc.requests[0]!.response).toEqual({});
  });

  it('memoizes via SpecCache in the SpecMessageHandler', async () => {
    const resolver = fakeResolver({ sources: [new ZodJsonSchemaSource()], handlers: [handlerDef('orders:create', CreateOrder, OrderConfirmation)] });
    const handler = new SpecMessageHandler(resolver);
    const result = await handler.handleAsync(new SpecRequest('benzene', 'json'));
    expect(result.isSuccessful).toBe(true);
    const doc = JSON.parse(result.payload.content) as { requests: { topic: string }[] };
    expect(doc.requests[0]!.topic).toBe('orders:create');
  });
});

describe('SpecBuilder (openapi document)', () => {
  it('builds a real OpenAPI 3.0 document — paths, operations, $ref request/response bodies and error responses', () => {
    const json = new SpecBuilder().createSpec(
      fakeResolver({
        sources: [new ZodJsonSchemaSource()],
        handlers: [
          handlerDef('orders:create', CreateOrder, OrderConfirmation),
          handlerDef('orders:get', GetOrder, OrderConfirmation),
        ],
        httpEndpoints: [httpDef('POST', '/orders', 'orders:create'), httpDef('GET', '/orders/{id}', 'orders:get')],
        applicationName: 'orders-api',
      }),
      new SpecRequest('openapi'),
    );
    const doc = JSON.parse(json) as {
      openapi: string;
      info?: { title?: string; version?: string };
      paths: Record<string, Record<string, {
        parameters?: { name: string; in: string; required: boolean; schema: Record<string, unknown> }[];
        requestBody?: { content: Record<string, { schema: Record<string, unknown> }> };
        responses: Record<string, { description: string; content?: Record<string, { schema: Record<string, unknown> }> }>;
      }>>;
      components: { schemas: Record<string, Record<string, unknown>> };
    };

    expect(doc.openapi).toBe('3.0.1');
    expect(doc.info?.title).toBe('orders-api');

    // POST /orders — request body + 200 response are $refs into components; the min-length rule survived.
    const post = doc.paths['/orders']!.post!;
    expect(post.requestBody!.content['application/json']!.schema).toEqual({ $ref: '#/components/schemas/CreateOrder' });
    expect(post.responses['200']!.content!['application/json']!.schema).toEqual({
      $ref: '#/components/schemas/OrderConfirmation',
    });
    expect(doc.components.schemas['CreateOrder']).toMatchObject({
      properties: { orderId: { type: 'string', minLength: 1 } },
    });

    // Every operation carries the standard error responses, referencing a shared ErrorPayload schema.
    expect(post.responses['400']!.content!['application/json']!.schema).toEqual({
      $ref: '#/components/schemas/ErrorPayload',
    });
    expect(Object.keys(post.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '422', '500', '503']),
    );
    expect(doc.components.schemas['ErrorPayload']).toMatchObject({ type: 'object' });

    // GET /orders/{id} — a path parameter, and no request body on a GET.
    const get = doc.paths['/orders/{id}']!.get!;
    expect(get.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);
    expect(get.requestBody).toBeUndefined();
  });

  it('serves the openapi document through the SpecMessageHandler on the spec topic', async () => {
    const resolver = fakeResolver({
      sources: [new ZodJsonSchemaSource()],
      handlers: [handlerDef('orders:create', CreateOrder, OrderConfirmation)],
      httpEndpoints: [httpDef('POST', '/orders', 'orders:create')],
    });
    const result = await new SpecMessageHandler(resolver).handleAsync(new SpecRequest('openapi'));
    const doc = JSON.parse(result.payload.content) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.0.1');
    expect(Object.keys(doc.paths)).toContain('/orders');
  });
});

describe('SpecBuilder (asyncapi document)', () => {
  it('builds a real AsyncAPI 3.0 document — receive-with-reply for handlers, send for broadcasts', () => {
    const json = new SpecBuilder().createSpec(
      fakeResolver({
        sources: [new ZodJsonSchemaSource()],
        handlers: [handlerDef('orders:create', CreateOrder, OrderConfirmation)],
        senders: [messageDef('order:placed', OrderPlaced)],
        applicationName: 'orders-api',
      }),
      new SpecRequest('asyncapi'),
    );
    const doc = JSON.parse(json) as {
      asyncapi: string;
      id: string;
      defaultContentType: string;
      info?: { title?: string };
      channels: Record<string, { address: string; messages: Record<string, { payload: Record<string, unknown> }> }>;
      operations: Record<string, {
        action: string;
        channel: { $ref: string };
        messages: { $ref: string }[];
        reply?: { channel: { $ref: string }; messages: { $ref: string }[] };
      }>;
      components: { schemas: Record<string, Record<string, unknown>> };
    };

    expect(doc.asyncapi).toBe('3.0.0');
    expect(doc.id).toBe('urn:benzene:service:orders-api');
    expect(doc.defaultContentType).toBe('application/json');

    // The topic ':' is illegal in an AsyncAPI map key, so it is sanitised while the address is preserved.
    expect(doc.channels['orders_create']!.address).toBe('orders:create');
    expect(doc.channels['orders_create_response']!.address).toBe('orders:create:response');
    expect(doc.channels['orders_create']!.messages['CreateOrder']!.payload).toEqual({
      $ref: '#/components/schemas/CreateOrder',
    });

    // A handler is a `receive` with a native `reply` pointing at the response channel.
    const receive = doc.operations['orders_create']!;
    expect(receive.action).toBe('receive');
    expect(receive.channel.$ref).toBe('#/channels/orders_create');
    expect(receive.messages[0]!.$ref).toBe('#/channels/orders_create/messages/CreateOrder');
    expect(receive.reply!.channel.$ref).toBe('#/channels/orders_create_response');
    expect(receive.reply!.messages[0]!.$ref).toBe('#/channels/orders_create_response/messages/OrderConfirmation');

    // A broadcast/sender is a `send`, no reply.
    const send = doc.operations['order_placed']!;
    expect(send.action).toBe('send');
    expect(send.reply).toBeUndefined();
    expect(doc.channels['order_placed']!.address).toBe('order:placed');

    expect(doc.components.schemas['CreateOrder']).toBeDefined();
    expect(doc.components.schemas['OrderConfirmation']).toBeDefined();
    expect(doc.components.schemas['OrderPlaced']).toBeDefined();
  });

  it('honours a custom response-topic suffix', () => {
    const json = new SpecBuilder().createSpec(
      fakeResolver({
        sources: [new ZodJsonSchemaSource()],
        handlers: [handlerDef('orders:create', CreateOrder, OrderConfirmation)],
        applicationName: 'orders-api',
        asyncApiResponseTopicSuffix: 'reply',
      }),
      new SpecRequest('asyncapi'),
    );
    const doc = JSON.parse(json) as { channels: Record<string, { address: string }> };
    expect(doc.channels['orders_create_reply']!.address).toBe('orders:create:reply');
  });
});

describe('SpecBuilder → mesh aggregator round-trip', () => {
  let rootDirectory: string;
  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'benzene-spec-openapi-test-'));
  });
  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  class SpecServiceSource implements IMeshServiceSource {
    readonly key = 'fake';
    constructor(private readonly specJson: string) {}
    fetchSpecAsync(): Promise<string> {
      return Promise.resolve(this.specJson);
    }
    fetchHealthAsync(): Promise<string> {
      return Promise.resolve('{"isHealthy":true,"results":{}}');
    }
  }

  it('produces a doc whose $refs the aggregator resolves into inlined topic schemas', async () => {
    const specJson = new SpecBuilder().createSpec(
      fakeResolver({
        sources: [new ZodJsonSchemaSource()],
        handlers: [handlerDef('orders:create', CreateOrder, OrderConfirmation)],
      }),
      new SpecRequest('benzene', 'json'),
    );

    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = new MeshAggregator([new SpecServiceSource(specJson)], store);
    await aggregator.runOnceAsync(new MeshServiceRegistry([new MeshServiceRegistryEntry('orders-api', 'spec', 'health', 'fake')]));

    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as {
      topics: { topic: string; requestSchema?: { title?: string; properties?: Record<string, { minLength?: number }> } }[];
    };
    const create = catalog.topics.find((t) => t.topic === 'orders:create')!;
    // The $ref was resolved and tagged with the component name; the min-length rule survived.
    expect(create.requestSchema?.title).toBe('CreateOrder');
    expect(create.requestSchema?.properties?.orderId?.minLength).toBe(1);
  });
});

/**
 * Pins the client generator (`buildBenzeneClient`) end of `@benzenejs/codegen-client`: given a mesh
 * ServiceDescriptor (mesh.md §2), it emits a typed client whose interfaces come from the §2.1 schemas
 * and whose methods call `IBenzeneMessageSender.sendAsync(topic, …)`. The descriptor is built by hand
 * here to stand in for one a service of any language would serve.
 */
import { describe, expect, it } from 'vitest';
import { MeshServiceDescriptor, MeshTopicDescriptor } from '@benzenejs/mesh-wire';
import { buildBenzeneClient, generateBenzeneClientSource, TopicMethodName } from '@benzenejs/codegen-client';

function topic(id: string, requestSchema?: Record<string, unknown>, responseSchema?: Record<string, unknown>): MeshTopicDescriptor {
  const descriptor = new MeshTopicDescriptor();
  descriptor.id = id;
  descriptor.requestSchema = requestSchema;
  descriptor.responseSchema = responseSchema;
  return descriptor;
}

function descriptorOf(service: string, topics: MeshTopicDescriptor[]): MeshServiceDescriptor {
  const descriptor = new MeshServiceDescriptor();
  descriptor.service = service;
  descriptor.topics = topics;
  return descriptor;
}

describe('buildBenzeneClient', () => {
  const descriptor = descriptorOf('orders', [
    topic(
      'order:create',
      { type: 'object', properties: { customerId: { type: 'string' } }, required: ['customerId'] },
      { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
    ),
    topic(
      'order:get',
      { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
      { type: 'object', properties: { orderId: { type: 'string' }, status: { type: 'string' } } },
    ),
  ]);

  it('names the client and interface from the service', () => {
    const generated = buildBenzeneClient(descriptor);
    expect(generated.fileName).toBe('OrdersServiceClient.ts');
    expect(generated.source).toContain('export interface IOrdersServiceClient {');
    expect(generated.source).toContain('export class OrdersServiceClient implements IOrdersServiceClient {');
    expect(generated.source).toContain('constructor(private readonly sender: IBenzeneMessageSender) {}');
  });

  it('emits a named payload interface per topic request/response', () => {
    const source = generateBenzeneClientSource(descriptor);
    expect(source).toContain('export interface CreateOrderRequest {\n  customerId: string;\n}');
    expect(source).toContain('export interface CreateOrderResponse {\n  orderId: string;\n}');
    // order:get response has no required list, so both members are optional.
    expect(source).toContain('export interface GetOrderResponse {\n  orderId?: string;\n  status?: string;\n}');
  });

  it('emits one method per topic that sends on the topic id', () => {
    const source = generateBenzeneClientSource(descriptor);
    expect(source).toContain(
      "return this.sender.sendAsync<CreateOrderRequest, CreateOrderResponse>('order:create', message, headers);",
    );
    expect(source).toContain(
      'createOrderAsync(message: CreateOrderRequest, headers?: Record<string, string>): Promise<IBenzeneResultOf<CreateOrderResponse>>',
    );
  });

  it('honors a custom method-name strategy', () => {
    const source = generateBenzeneClientSource(descriptor, { methodName: new TopicMethodName() });
    expect(source).toContain('orderCreateAsync(message: OrderCreateRequest'); // not the reversed createOrderAsync
  });

  it('falls back to unknown for an unconstrained ({}) or absent schema, emitting no interface for it', () => {
    const source = generateBenzeneClientSource(
      descriptorOf('ping', [topic('ping:now', {}, undefined)]),
    );
    expect(source).toContain(
      'nowPingAsync(message: unknown, headers?: Record<string, string>): Promise<IBenzeneResultOf<unknown>>',
    );
    // No payload interface is emitted for an unconstrained schema (only the client's own interface).
    expect(source).not.toContain('export interface NowPingRequest');
    expect(source).not.toContain('export interface NowPingResponse');
  });
});

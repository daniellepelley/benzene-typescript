import { Metadata } from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';
import { createServerUnaryCall } from '@benzene/grpc-test-helpers';
import { GrpcContext, GrpcMessageHeadersGetter } from '@benzene/grpc';

/**
 * Covers the `@benzene/grpc-test-helpers` fake-call factory (the port of C#'s `TestServerCallContext`): the
 * members Benzene reads are populated, the defaults are the idle-call defaults, and the fake drives a real
 * `GrpcContext` + a real bridge getter end-to-end with no live gRPC server.
 */
describe('createServerUnaryCall', () => {
  it('defaults to an idle call with empty metadata and no deadline', () => {
    const call = createServerUnaryCall();

    expect(call.request).toBeUndefined();
    expect(call.metadata.getMap()).toEqual({});
    expect(call.cancelled).toBe(false);
    expect(call.getDeadline()).toBe(Infinity);
    expect(call.getPath()).toBe('/benzene.test.TestService/Echo');
  });

  it('surfaces the supplied request, metadata, cancellation, method and deadline', () => {
    const metadata = new Metadata();
    metadata.add('x-correlation-id', 'abc-123');
    const deadline = new Date('2030-01-01T00:00:00Z');

    const call = createServerUnaryCall<{ name: string }, unknown>({
      request: { name: 'world' },
      metadata,
      method: '/pkg.Svc/DoThing',
      cancelled: true,
      deadline,
    });

    expect(call.request).toEqual({ name: 'world' });
    expect(call.metadata.get('x-correlation-id')).toEqual(['abc-123']);
    expect(call.cancelled).toBe(true);
    expect(call.getPath()).toBe('/pkg.Svc/DoThing');
    expect(call.getDeadline()).toBe(deadline);
  });

  it('drives a real GrpcContext + bridge getter (metadata → headers) with no live server', () => {
    const metadata = new Metadata();
    metadata.add('x-trace-id', 'trace-456');
    const context = new GrpcContext('topic', createServerUnaryCall({ metadata }));

    const headers = new GrpcMessageHeadersGetter().getHeaders(context);

    expect(headers['x-trace-id']).toBe('trace-456');
  });
});

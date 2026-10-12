import { Client, credentials, Metadata, Server, ServerCredentials, ServiceDefinition, status } from '@grpc/grpc-js';
import { AddressInfo, createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { JsonGrpcMessageAdapter } from '@benzenejs/grpc';
import {
  DefaultGrpcStatusReverseMapper,
  GrpcBenzeneMessageClient,
  GrpcClientMiddleware,
  GrpcClientRouteRegistry,
  GrpcSendMessageContext,
} from '@benzenejs/grpc-client';
import { BenzeneResultStatus } from '@benzenejs/results';

/**
 * transport-bindings.md §1 (spec 1.1): a call that fails before any reply arrives yields a result, not an
 * exception - `timeout` when the client's own deadline elapsed, otherwise `service-unavailable`. The gRPC
 * client already did this before the rule was written: grpc-js reports a dead peer as `UNAVAILABLE` and an
 * elapsed deadline as `DEADLINE_EXCEEDED`, `GrpcClientMiddleware` captures the call error as a status, and the
 * reverse table (wire-contracts §4.2) maps them; anything that still throws is caught as service-unavailable.
 * These pin that over real grpc-js calls.
 */

const HANG = '/benzene.test.SlowService/Hang';
const TOPIC = 'grpc-transport-failure';

const jsonCodec = {
  serialize: (value: unknown): Buffer => Buffer.from(JSON.stringify(value ?? null), 'utf8'),
  deserialize: (bytes: Buffer): unknown => JSON.parse(bytes.toString('utf8')) as unknown,
};

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('gRPC client: a call that fails before any reply', () => {
  it('no listener is service-unavailable, not an exception', async () => {
    const port = await closedPort();
    const rawClient = new Client(`127.0.0.1:${port}`, credentials.createInsecure());
    try {
      const client = new GrpcBenzeneMessageClient(rawClient, new GrpcClientRouteRegistry().add(TOPIC, HANG));
      const result = await client.sendMessageAsync({ topic: TOPIC, message: {}, headers: {} });

      expect(result.isSuccessful).toBe(false);
      expect(result.status).toBe(BenzeneResultStatus.serviceUnavailable);
    } finally {
      rawClient.close();
    }
  });

  it("the client's own deadline elapsing is timeout", async () => {
    const server = new Server();
    const hang: ServiceDefinition = {
      hang: {
        path: HANG,
        requestStream: false,
        responseStream: false,
        requestSerialize: jsonCodec.serialize,
        requestDeserialize: jsonCodec.deserialize,
        responseSerialize: jsonCodec.serialize,
        responseDeserialize: jsonCodec.deserialize,
      } as ServiceDefinition[string],
    };
    server.addService(hang, { hang: () => undefined }); // never answers
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, bound) => (error ? reject(error) : resolve(bound))),
    );
    const rawClient = new Client(`127.0.0.1:${port}`, credentials.createInsecure());
    try {
      const context = new GrpcSendMessageContext(TOPIC, {}, new Metadata(), new Date(Date.now() + 100));
      await new GrpcClientMiddleware(rawClient, new GrpcClientRouteRegistry().add(TOPIC, HANG), new JsonGrpcMessageAdapter()).handleAsync(
        context,
        () => Promise.resolve(),
      );

      expect(context.status.code).toBe(status.DEADLINE_EXCEEDED);
      expect(new DefaultGrpcStatusReverseMapper().map(context.status.code, context.responseTrailers)).toBe(BenzeneResultStatus.timeout);
    } finally {
      rawClient.close();
      server.forceShutdown();
    }
  });
});

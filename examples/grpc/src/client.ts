/**
 * The outbound gRPC client, ported from the .NET example's `Benzene.Example.Grpc.Client`. A caller sends a
 * Benzene message by TOPIC (`say_hello`) and the client maps it to the gRPC method, performs the unary
 * call, and maps the gRPC status back to a Benzene result — the caller never sees grpc-js.
 *
 * SCOPE: `@benzene/grpc-client` ports the UNARY send side only (streaming client calls are a deferred,
 * separable concern — see the package's `index.ts`). The example's streaming RPCs are therefore driven in
 * the component test with grpc-js's own low-level streaming client methods; the *unary* path is the one
 * that goes through Benzene end-to-end here.
 */
import { Client, credentials } from '@grpc/grpc-js';
import { IBenzeneMessageClient } from '@benzene/clients';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { addGrpcClient } from '@benzene/grpc-client';
import { GreeterMethods } from './greeter';

/**
 * Wires a Benzene {@link IBenzeneMessageClient} that sends the `say_hello` topic over gRPC to `address`.
 * Mirrors the .NET client's `AddGrpcClient` wiring: a grpc-js `Client` is created for the address and the
 * topic → method route is registered. Returns the resolved message client plus the underlying grpc-js
 * `Client` so the caller can `close()` it.
 */
export function createGreeterClient(address: string): {
  messageClient: IBenzeneMessageClient;
  grpcClient: Client;
} {
  const grpcClient = new Client(address, credentials.createInsecure());

  const container = new DefaultBenzeneServiceContainer();
  addGrpcClient(container, grpcClient, (routes) => {
    routes.add('say_hello', GreeterMethods.sayHello);
  });

  const messageClient = container
    .createServiceResolverFactory()
    .createScope()
    .getService(IBenzeneMessageClient);

  return { messageClient, grpcClient };
}

/**
 * Test helpers for `@benzenejs/grpc`: a hand-rolled grpc-js {@link createServerUnaryCall | ServerUnaryCall}
 * for unit-testing a Benzene gRPC handler/pipeline without a live server or socket — drive it through
 * `new GrpcContext(topic, createServerUnaryCall({ request, metadata, ... }))`, exactly how the port's own
 * gRPC tests (and every other transport worker) exercise the bridge against a fake.
 *
 * Port of Benzene.Grpc.TestHelpers.
 *
 * NON-PORT (`GrpcTestHost` / `BuildGrpcHost` — the live in-memory host): the C# project also ships a
 * `GrpcTestHost` that boots an ASP.NET Core `TestServer`, wires the Benzene ASP.NET pipeline
 * (`Benzene.AspNet.Core` + `Benzene.Grpc.AspNet`), maps gRPC endpoints, and hands back a real
 * `GrpcChannel`. That whole mechanism is .NET-and-ASP.NET-specific: `@benzenejs/grpc` deliberately replaced
 * the interceptor + ASP.NET hosting with a grpc-js `Server` (see the README), and the TypeScript port tests
 * the bridge with the fake call above rather than binding a real socket — so there is no `GrpcTestHost`
 * counterpart. A caller who wants a live end-to-end gRPC test binds a grpc-js `Server` to an ephemeral
 * loopback port themselves; the Benzene-facing seam this package supports is the fake-call unit test.
 */
export * from './TestServerCallContext';

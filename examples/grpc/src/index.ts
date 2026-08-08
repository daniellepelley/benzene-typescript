/**
 * `@benzene-example/grpc` — the greeter domain hosted on gRPC (all four RPC shapes: unary,
 * server-streaming, client-streaming, bidirectional), plus a Benzene gRPC message client. Ported from the
 * .NET `Benzene.Example.Grpc` (server + client + component test). See `README.md`.
 */
export * from './handlers';
export * from './greeter';
export * from './server';
export * from './client';

/**
 * Port of Benzene.Grpc.IGrpcMethodDefinition.
 *
 * Binds a gRPC method path (e.g. `/package.Service/Method`) to the Benzene topic that serves it.
 */
export interface IGrpcMethodDefinition {
  /** The fully-qualified gRPC method path, e.g. `/package.Service/Method`. */
  readonly method: string;

  /** The Benzene topic the method routes to. */
  readonly topic: string;
}

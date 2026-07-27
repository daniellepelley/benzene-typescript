import { IGrpcMethodDefinition } from './IGrpcMethodDefinition';
import { IGrpcMethodFinder } from './IGrpcMethodFinder';
import { IGrpcRouteFinder } from './IGrpcRouteFinder';

/**
 * Port of Benzene.Grpc.GrpcRouteFinder.
 *
 * Builds a case-insensitive gRPC method-path → definition map ONCE from {@link IGrpcMethodFinder}
 * (`StringComparer.OrdinalIgnoreCase` → keys lower-cased on insert and on lookup) and resolves a
 * method path to its {@link IGrpcMethodDefinition}, or `undefined` when nothing matches.
 */
export class GrpcRouteFinder implements IGrpcRouteFinder {
  static readonly inject = [IGrpcMethodFinder] as const;

  private readonly definitionsByMethod = new Map<string, IGrpcMethodDefinition>();

  constructor(grpcMethodFinder: IGrpcMethodFinder) {
    for (const definition of grpcMethodFinder.findDefinitions()) {
      this.definitionsByMethod.set(definition.method.toLowerCase(), definition);
    }
  }

  find(method: string): IGrpcMethodDefinition | undefined {
    return this.definitionsByMethod.get(method.toLowerCase());
  }
}

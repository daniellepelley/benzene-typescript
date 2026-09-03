import { BenzeneException } from '@benzenejs/core';
import {
  IMessageHandlerDefinition,
  IMessageHandlersFinder,
} from '@benzenejs/abstractions-message-handlers';
import { getGrpcMethods } from './GrpcMethodAttribute';
import { GrpcMethodDefinition } from './GrpcMethodDefinition';
import { IGrpcMethodDefinition } from './IGrpcMethodDefinition';
import { IGrpcMethodFinder } from './IGrpcMethodFinder';

/**
 * Port of Benzene.Grpc.ReflectionGrpcMethodFinder.
 *
 * Discovers `@grpcMethod`-decorated handlers by walking the message-handler definitions from
 * {@link IMessageHandlersFinder} (the same extension point .NET uses) and reading each handler class's
 * `@grpcMethod` metadata to bind its method path(s) to the handler's topic. Throws if the same gRPC
 * method is claimed by more than one handler.
 *
 * ERASURE BEND: .NET reads the attribute via `HandlerType.GetCustomAttributes<GrpcMethodAttribute>()`;
 * TypeScript has no attribute reflection, so `getGrpcMethods(handlerType)` reads the `WeakMap` the
 * `@grpcMethod` decorator populated — the same "annotate-then-discover" flow the `@message` decorator
 * uses. Same discovery pipeline, TS-native metadata source.
 */
export class ReflectionGrpcMethodFinder implements IGrpcMethodFinder {
  static readonly inject = [IMessageHandlersFinder] as const;

  private readonly messageHandlersFinder: IMessageHandlersFinder;

  constructor(messageHandlersFinder: IMessageHandlersFinder) {
    this.messageHandlersFinder = messageHandlersFinder;
  }

  findDefinitions(): IGrpcMethodDefinition[] {
    const definitions = this.messageHandlersFinder
      .findDefinitions()
      .flatMap((definition) => ReflectionGrpcMethodFinder.mapHandlers(definition));

    // The duplicate check must use the SAME case-insensitive comparison as the GrpcRouteFinder route
    // table, which is built lower-cased from this same source (.NET #261). Without this, a case-variant
    // duplicate ('/pkg.Svc/Echo' vs '/pkg.svc/echo') would pass here and then silently lose a route in
    // the map (last-in wins) instead of failing fast with the clear BenzeneException below.
    const seen = new Set<string>();
    for (const definition of definitions) {
      const key = definition.method.toLowerCase();
      if (seen.has(key)) {
        throw new BenzeneException(
          `Grpc method '${definition.method}' has been assigned to more than one message handler, this is not permitted`,
        );
      }
      seen.add(key);
    }

    return definitions;
  }

  private static mapHandlers(
    messageHandlerDefinition: IMessageHandlerDefinition,
  ): IGrpcMethodDefinition[] {
    return getGrpcMethods(messageHandlerDefinition.handlerType).map(
      (method) => new GrpcMethodDefinition(method, messageHandlerDefinition.topic.id),
    );
  }
}

import { BenzeneException } from '@benzene/core';
import {
  IMessageHandlerDefinition,
  IMessageHandlersFinder,
} from '@benzene/abstractions-message-handlers';
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

    const seen = new Set<string>();
    for (const definition of definitions) {
      if (seen.has(definition.method)) {
        throw new BenzeneException(
          `Grpc method '${definition.method}' has been assigned to more than one message handler, this is not permitted`,
        );
      }
      seen.add(definition.method);
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

import { Constructor } from '@benzenejs/abstractions';

/**
 * Port of Benzene.Grpc.GrpcMethodAttribute.
 *
 * The C# `[GrpcMethod("/package.Service/Method")]` attribute (`AttributeUsage(AllowMultiple = true)`)
 * becomes the `@grpcMethod('/package.Service/Method')` class decorator. It records the gRPC method
 * path(s) a handler serves; because .NET allows the attribute multiple times, the metadata is an
 * accumulated array.
 *
 * PAIRING: exactly as in .NET, `@grpcMethod` does NOT itself discover the handler — it is applied
 * *alongside* `@message('topic')`, which self-registers the class with the `MessageHandlersRegistry`.
 * {@link ReflectionGrpcMethodFinder} then walks the message-handler definitions and reads the
 * `@grpcMethod` metadata off each handler class to build the method-path → topic map. So `@grpcMethod`
 * only annotates; the topic comes from `@message`.
 *
 * Works as a plain function too, for environments without decorator syntax:
 * `grpcMethod('/pkg.Svc/Method')(MyHandler)`.
 */
const metadataStore = new WeakMap<Constructor<unknown>, string[]>();

export function grpcMethod(
  method: string,
): <T extends Constructor<unknown>>(target: T, context?: ClassDecoratorContext) => T {
  return (target) => {
    const existing = metadataStore.get(target);
    if (existing === undefined) {
      metadataStore.set(target, [method]);
    } else {
      existing.push(method);
    }
    return target;
  };
}

/** Reads the gRPC method paths recorded by `@grpcMethod`, or an empty array if the class has none. */
export function getGrpcMethods(handlerType: Constructor<unknown>): readonly string[] {
  return metadataStore.get(handlerType) ?? [];
}

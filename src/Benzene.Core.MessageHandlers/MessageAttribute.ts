import { Constructor, ServiceIdentifier, VoidResult } from '@benzene/abstractions';
import { MessageHandlersRegistry } from './MessageHandlersRegistry';

/**
 * Port of Benzene.Core.MessageHandlers.MessageAttribute.
 *
 * The C# `[Message("topic", "v1")]` attribute becomes the `@message('topic', 'v1')`
 * class decorator. In .NET, reflection reads the attribute and the handler's
 * generic interface arguments; JavaScript erases both, so the decorator records
 * the metadata itself and registers the class with the global
 * MessageHandlersRegistry as a side effect of the module being loaded. Request
 * and response type references (used for serialization, code generation and
 * clients) can be supplied via the options form; they default to `VoidResult`,
 * mirroring C# `typeof(Void)`.
 *
 * The decorator also works as a plain function for environments without
 * decorator syntax: `message('topic')(MyHandler)`.
 */
export interface MessageOptions {
  version?: string;
  requestType?: ServiceIdentifier<unknown>;
  responseType?: ServiceIdentifier<unknown>;
  /** Register with a specific registry instead of MessageHandlersRegistry.global. */
  registry?: MessageHandlersRegistry;
}

export interface MessageMetadata {
  readonly topic: string;
  readonly version: string;
  readonly requestType: ServiceIdentifier<unknown>;
  readonly responseType: ServiceIdentifier<unknown>;
}

const metadataStore = new WeakMap<Constructor<unknown>, MessageMetadata>();

export function message(
  topic: string,
  versionOrOptions: string | MessageOptions = '',
): <T extends Constructor<unknown>>(target: T, context?: ClassDecoratorContext) => T {
  const options: MessageOptions =
    typeof versionOrOptions === 'string' ? { version: versionOrOptions } : versionOrOptions;

  return (target) => {
    metadataStore.set(target, {
      topic,
      version: options.version ?? '',
      requestType: options.requestType ?? VoidResult,
      responseType: options.responseType ?? VoidResult,
    });
    (options.registry ?? MessageHandlersRegistry.global).register(target);
    return target;
  };
}

/** Reads the metadata recorded by the `message` decorator, if any. */
export function getMessageMetadata(handlerType: Constructor<unknown>): MessageMetadata | undefined {
  return metadataStore.get(handlerType);
}

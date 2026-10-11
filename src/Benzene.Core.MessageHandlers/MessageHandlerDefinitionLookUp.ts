import { ITopic } from '@benzenejs/abstractions-messages';
import {
  IMessageHandlerDefinition,
  IMessageHandlerDefinitionLookUp,
  IPayloadCastLookUp,
  IVersionSelector,
} from '@benzenejs/abstractions-message-handlers';
import { MessageHandlerDefinitionIndex } from './MessageHandlerDefinitionIndex';

/**
 * Port of Benzene.Core.MessageHandlers.MessageHandlerDefinitionLookUp.
 *
 * Finds the handler for a (topic, version) by the spec's selection rule (core-concepts §2), delegating the
 * choice to the registered {@link IVersionSelector}. It supplies the selector with the topic's **default
 * version** (the unversioned handler, else the one declared `isDefault`) and the versions the requested
 * version can be **cast** to (via the optional {@link IPayloadCastLookUp} that `usePayloadVersionCasting`
 * registers). `undefined` means no handler serves the message, which the router answers `not-found`.
 *
 * DIVERGENCE: the C# lookup fast-paths a topic with exactly one handler to that handler whatever version
 * was requested. That contradicts the selection rule (a version sent to a topic with only an unversioned
 * handler is `not-found`), so the port always selects.
 */
export class MessageHandlerDefinitionLookUp implements IMessageHandlerDefinitionLookUp {
  constructor(
    private readonly index: MessageHandlerDefinitionIndex,
    private readonly versionSelector: IVersionSelector,
    private readonly payloadCastLookUp?: IPayloadCastLookUp,
  ) {}

  findHandler(topic: ITopic): IMessageHandlerDefinition | undefined {
    const handlers = this.index.getByTopicId(topic.id);
    if (handlers.length === 0) {
      return undefined;
    }

    const requestedVersion = topic.version ?? '';
    const castLookUp = this.payloadCastLookUp;
    const castableVersions =
      requestedVersion === '' || castLookUp === undefined
        ? []
        : handlers
            .filter((handler) => castLookUp.canCast(topic.id, requestedVersion, handler.requestType))
            .map((handler) => handler.topic.version);

    const selectedVersion = this.versionSelector.select(
      requestedVersion,
      handlers.map((handler) => handler.topic.version),
      { defaultVersion: defaultVersionOf(handlers), castableVersions },
    );

    return selectedVersion === undefined
      ? undefined
      : handlers.find((handler) => handler.topic.version === selectedVersion);
  }

  getAllHandlers(): IMessageHandlerDefinition[] {
    return this.index.getAll();
  }
}

/**
 * The version of a topic's default handler (core-concepts §2): `''` when an unversioned handler is
 * registered, otherwise the version of the handler declared default, otherwise `undefined`.
 */
export function defaultVersionOf(handlers: readonly IMessageHandlerDefinition[]): string | undefined {
  if (handlers.some((handler) => handler.topic.version === '')) {
    return '';
  }
  return handlers.find((handler) => handler.isDefault === true)?.topic.version;
}

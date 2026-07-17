import { ServiceIdentifier, ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Maps a request type to the topic it should be published on.
 * Port of Benzene.Abstractions.Messages.BenzeneClient.IGetTopic.
 *
 * Deviation: C# calls `GetTopic(typeof(TRequest))`, but TypeScript erases the generic request type
 * at the `MessageSender` call site, so the runtime `Type` argument has no faithful equivalent — the
 * parameter is optional and `MessageSender` passes `undefined`. The default `DefaultGetTopic` ignores
 * it anyway; a custom `IGetTopic` that genuinely needs the request type must obtain it another way.
 */
export interface IGetTopic {
  /** Port of C# `string GetTopic(Type type)`. */
  getTopic(type?: ServiceIdentifier<unknown>): string;
}

export const IGetTopic: ServiceToken<IGetTopic> = serviceToken<IGetTopic>('IGetTopic');

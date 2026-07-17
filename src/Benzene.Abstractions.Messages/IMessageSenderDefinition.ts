import { ServiceIdentifier, ServiceToken, serviceToken } from '@benzene/abstractions';
import { IRequestResponseMessageDefinition } from './IRequestResponseMessageDefinition';

/**
 * Describes an outbound sender: its topic, request/response types and the sender's own type.
 * Port of Benzene.Abstractions.Messages.IMessageSenderDefinition
 * (C# `Type SenderType` maps to a runtime service identifier).
 */
export interface IMessageSenderDefinition extends IRequestResponseMessageDefinition {
  readonly senderType: ServiceIdentifier<unknown>;
}

/**
 * Token used to register sender definitions with the container so an `IMessageSendersFinder` can
 * collect them (the port of C# `IEnumerable<IMessageSenderDefinition>` constructor injection),
 * mirroring `IMessageHandlerDefinition`.
 */
export const IMessageSenderDefinition: ServiceToken<IMessageSenderDefinition> =
  serviceToken<IMessageSenderDefinition>('IMessageSenderDefinition');

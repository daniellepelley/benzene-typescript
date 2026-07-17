import { Constructor, ServiceToken, serviceToken } from '@benzene/abstractions';
import { IRequestResponseMessageDefinition } from '@benzene/abstractions-messages';

/**
 * Describes a message handler: its topic, request/response types and handler class.
 * Port of Benzene.Abstractions.MessageHandlers.IMessageHandlerDefinition
 * (C# `Type HandlerType` maps to the handler's class constructor).
 */
export interface IMessageHandlerDefinition extends IRequestResponseMessageDefinition {
  readonly handlerType: Constructor<unknown>;
}

/**
 * Token used to register definitions with the container so
 * DependencyMessageHandlersFinder can collect them (the port of C#
 * `IEnumerable<IMessageHandlerDefinition>` constructor injection).
 */
export const IMessageHandlerDefinition: ServiceToken<IMessageHandlerDefinition> =
  serviceToken<IMessageHandlerDefinition>('IMessageHandlerDefinition');

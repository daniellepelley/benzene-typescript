import { Constructor, ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { IRequestResponseMessageDefinition } from '@benzenejs/abstractions-messages';

/**
 * Describes a message handler: its topic, request/response types and handler class.
 * Port of Benzene.Abstractions.MessageHandlers.IMessageHandlerDefinition
 * (C# `Type HandlerType` maps to the handler's class constructor).
 */
export interface IMessageHandlerDefinition extends IRequestResponseMessageDefinition {
  readonly handlerType: Constructor<unknown>;

  /**
   * Whether the application declared this handler the topic's **default handler** — the one a message
   * carrying no version goes to when the topic has no unversioned handler (core-concepts §2). Set with
   * `@message(topic, { version, isDefault: true })`. Absent means `false`.
   */
  readonly isDefault?: boolean;
}

/**
 * Token used to register definitions with the container so
 * DependencyMessageHandlersFinder can collect them (the port of C#
 * `IEnumerable<IMessageHandlerDefinition>` constructor injection).
 */
export const IMessageHandlerDefinition: ServiceToken<IMessageHandlerDefinition> =
  serviceToken<IMessageHandlerDefinition>('IMessageHandlerDefinition');

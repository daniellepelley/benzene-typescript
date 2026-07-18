/** Port of Benzene.Azure.Function.ServiceBus.ServiceBusContext. */
import { ServiceBusReceivedMessage } from '@azure/service-bus';
import { IHasMessageResult, IMessageResult } from '@benzene/abstractions-message-handlers';

/**
 * Provides the middleware pipeline context for a single Service Bus message within an Azure Functions
 * Service Bus trigger invocation. Implements the already-ported `IHasMessageResult` so
 * `ServiceBusMessageMessageHandlerResultSetter` can record the handler outcome onto it.
 *
 * MESSAGE-TYPE ADAPTATION: .NET wraps `Azure.Messaging.ServiceBus.ServiceBusReceivedMessage`. The
 * Node ecosystem-native equivalent is the SAME conceptual type from `@azure/service-bus`
 * (`ServiceBusReceivedMessage`), so the port depends on it directly rather than modelling a bespoke
 * shape. Field-name mapping used by the getters (.NET PascalCase -> Node camelCase):
 *   - C# `Message.Body` (`BinaryData`)          -> `message.body` (`any`; decoded per contentType)
 *   - C# `Message.ApplicationProperties`         -> `message.applicationProperties`
 *   - C# `Message.MessageId`                      -> `message.messageId`
 */
export class ServiceBusContext implements IHasMessageResult {
  /**
   * @param message The Service Bus message.
   */
  constructor(message: ServiceBusReceivedMessage) {
    this.message = message;
  }

  /** The Service Bus message. */
  readonly message: ServiceBusReceivedMessage;

  /**
   * The result of handling this message. Set by `ServiceBusMessageMessageHandlerResultSetter`; unset
   * (C# `null`) until a result has been recorded — `ServiceBusBatchApplication` reads it via optional
   * chaining, exactly as C# reads `MessageResult?.IsSuccessful`.
   */
  messageResult!: IMessageResult;
}

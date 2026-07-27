/** Port of Benzene.Azure.ServiceBus.ServiceBusConsumerContext. */
import { ServiceBusReceivedMessage } from '@azure/service-bus';
import { IHasMessageResult, IMessageResult } from '@benzene/abstractions-message-handlers';

/**
 * Provides the middleware pipeline context for a single Service Bus message received by the
 * self-hosted consumer ({@link BenzeneServiceBusWorker}).
 *
 * MESSAGE-TYPE ADAPTATION: .NET wraps `Azure.Messaging.ServiceBus.ServiceBusReceivedMessage`; the
 * Node ecosystem-native equivalent is the same conceptual type from `@azure/service-bus`, so the
 * port depends on it directly (same as `@benzene/azure-function-service-bus`). Field-name mapping used
 * by the getters (.NET PascalCase → Node camelCase): `Message.Body`→`message.body`,
 * `Message.ApplicationProperties`→`message.applicationProperties`, `Message.MessageId`→`message.messageId`.
 */
export class ServiceBusConsumerContext implements IHasMessageResult {
  private constructor(readonly message: ServiceBusReceivedMessage) {}

  /** Creates a new context for a received Service Bus message. Port of C# `CreateInstance`. */
  static createInstance(message: ServiceBusReceivedMessage): ServiceBusConsumerContext {
    return new ServiceBusConsumerContext(message);
  }

  /**
   * The result of handling this message. Set by `ServiceBusConsumerMessageHandlerResultSetter`; read by
   * `ServiceBusConsumerApplication` to build the settlement decision. `undefined` (C# `null`) until a
   * result has been recorded — e.g. a pipeline that short-circuited without setting one.
   */
  messageResult!: IMessageResult;
}

/** Port of Benzene.Azure.Function.ServiceBus.ServiceBusMessageProcessingException. */

/**
 * Thrown by `ServiceBusBatchApplication` when `ServiceBusOptions.raiseOnFailureStatus` is enabled and a
 * message handler reported an unsuccessful result without itself throwing — escalating the failure into
 * an exception so it's treated the same as an unhandled exception for retry purposes. C# `Exception`
 * maps to `Error`.
 */
export class ServiceBusMessageProcessingException extends Error {
  /** The Service Bus message ID that the handler reported a failure for. */
  readonly messageId: string;

  constructor(messageId: string) {
    super(`Message handler reported an unsuccessful result for Service Bus message ${messageId}.`);
    this.name = 'ServiceBusMessageProcessingException';
    this.messageId = messageId;
  }
}

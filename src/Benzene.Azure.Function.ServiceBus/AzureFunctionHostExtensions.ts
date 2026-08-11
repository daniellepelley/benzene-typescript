import { ServiceBusReceivedMessage } from '@azure/service-bus';
import { BenzeneStartUp } from '@benzene/abstractions-middleware';
import { AzureFunctionHost } from '@benzene/azure-function-core';
import { handleServiceBusMessages } from './Extensions';

/**
 * The Service Bus-trigger handler an `app.serviceBusQueue(name, { cardinality: 'many', handler })`
 * registration expects: a batch of received messages (fire-and-forget). `context` is optional so the
 * getter's result is also callable as `host.serviceBusFunction(messages)` in a test.
 */
export type AzureServiceBusFunction = (
  messages: ServiceBusReceivedMessage[],
  context?: unknown,
) => Promise<void>;

/**
 * Adds the `.serviceBusFunction` getter to {@link AzureFunctionHost} — the Service Bus counterpart of
 * `.httpFunction`. Returns the handler to register with
 * `app.serviceBusQueue(name, { …, handler: host.serviceBusFunction })`. Same `declare module` + prototype
 * pattern and rationale as the HTTP getter (see `@benzene/azure-function-http`'s `AzureFunctionHostExtensions`).
 */
declare module '@benzene/azure-function-core' {
  interface AzureFunctionHost<TStartUp extends BenzeneStartUp> {
    /** The Service Bus-trigger handler to register with `app.serviceBusQueue(name, { handler })`. */
    readonly serviceBusFunction: AzureServiceBusFunction;
  }
}

Object.defineProperty(AzureFunctionHost.prototype, 'serviceBusFunction', {
  configurable: true,
  get(this: AzureFunctionHost<BenzeneStartUp>): AzureServiceBusFunction {
    return (messages) => handleServiceBusMessages(this.app, ...messages);
  },
});

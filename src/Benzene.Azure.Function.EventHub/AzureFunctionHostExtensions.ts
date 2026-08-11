import { ReceivedEventData } from '@azure/event-hubs';
import { BenzeneStartUp } from '@benzene/abstractions-middleware';
import { AzureFunctionHost } from '@benzene/azure-function-core';
import { handleEventHub } from './Extensions';

/**
 * The Event Hub-trigger handler an `app.eventHub(name, { cardinality: 'many', handler })` registration
 * expects: a batch of received events (fire-and-forget). `context` is optional so the getter's result is
 * also callable as `host.eventHubFunction(events)` in a test.
 */
export type AzureEventHubFunction = (
  events: ReceivedEventData[],
  context?: unknown,
) => Promise<void>;

/**
 * Adds the `.eventHubFunction` getter to {@link AzureFunctionHost} — the Event Hub counterpart of
 * `.httpFunction`. Returns the handler to register with
 * `app.eventHub(name, { …, handler: host.eventHubFunction })`. Same `declare module` + prototype pattern
 * and rationale as the HTTP getter (see `@benzene/azure-function-http`'s `AzureFunctionHostExtensions`).
 */
declare module '@benzene/azure-function-core' {
  interface AzureFunctionHost<TStartUp extends BenzeneStartUp> {
    /** The Event Hub-trigger handler to register with `app.eventHub(name, { handler })`. */
    readonly eventHubFunction: AzureEventHubFunction;
  }
}

Object.defineProperty(AzureFunctionHost.prototype, 'eventHubFunction', {
  configurable: true,
  get(this: AzureFunctionHost<BenzeneStartUp>): AzureEventHubFunction {
    return (events) => handleEventHub(this.app, ...events);
  },
});

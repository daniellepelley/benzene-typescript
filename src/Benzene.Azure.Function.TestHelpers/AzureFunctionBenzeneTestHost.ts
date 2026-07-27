import { HttpRequest } from '@azure/functions';
import { IAzureFunctionApp } from '@benzene/azure-function-core';
import { handleHttpRequest } from '@benzene/azure-function-http';

/**
 * In-memory Azure Functions test host — the Azure counterpart of `AwsLambdaBenzeneTestHost`. Wraps a
 * built {@link IAzureFunctionApp} and pushes native trigger payloads (built by the `as*` builders in this
 * package) in through the front door via a single `sendEventAsync`, so a test reads identically to the AWS
 * one bar the payload builder name.
 *
 * DISPATCH: the built app exposes two entry paths — `handleAsyncWithResult` (a trigger that returns a
 * response, e.g. HTTP) and `handleAsync` (fire-and-forget, e.g. Service Bus / Event Hub / Kafka).
 * `sendEventAsync` picks the right one from the payload it is given: an `@azure/functions` `HttpRequest`
 * goes through the HTTP entry point and returns an `HttpResponseInit`; anything else is dispatched
 * fire-and-forget (a single message is wrapped in a one-element batch, matching the `handle*` helpers'
 * `params`/rest-array shape) and resolves to `void` — assert egress via a faked client. This mirrors the
 * .NET split between `SendEventAsync<TResponse>` and the fire-and-forget `SendPubSubAsync`/
 * `HandleServiceBusMessages`.
 */
export class AzureFunctionBenzeneTestHost {
  constructor(private readonly app: IAzureFunctionApp) {}

  /**
   * Sends a native Azure trigger payload through the pipeline. Returns the native response for
   * request/response triggers (HTTP → `HttpResponseInit`), or resolves to `void` for fire-and-forget
   * triggers (Service Bus / Event Hub / Kafka).
   * @param event The native trigger payload (typically built by an `as*` builder in this package).
   */
  async sendEventAsync<TResponse = void>(event: unknown): Promise<TResponse> {
    if (event instanceof HttpRequest) {
      return (await handleHttpRequest(this.app, event)) as TResponse;
    }

    const messages = Array.isArray(event) ? event : [event];
    await this.app.handleAsync(messages);
    return undefined as TResponse;
  }
}

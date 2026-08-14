/**
 * The composition roots — one `BenzeneStartUp` per trigger, the SAME canonical shape as the AWS Lambda
 * example's (`configureServices` registers the service graph, `configure` wires the transport pipeline on
 * the unified `IBenzeneApplicationBuilder`). Only the transport verb differs from AWS:
 * `useAzureFunctions(app, az => …)` selects Azure exactly as `useAwsLambda(app, aws => …)` selects AWS.
 *
 * Each startup is booted once, at module load, into its own `AzureFunctionHost` in `functions.ts`. The
 * port's one-transport-per-container rule means each trigger is its own host/app.
 */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useAzureFunctions } from '@benzenejs/azure-function-core';
import { useAzureHttp } from '@benzenejs/azure-function-http';
import { useServiceBus } from '@benzenejs/azure-function-service-bus';
import { useBenzeneMessage, useEventHub } from '@benzenejs/azure-function-event-hub';
import { NotifyWarehouseHandler, PlaceOrderHandler } from './handlers';

/** HTTP trigger (request/response): `POST /orders` returns an order confirmation. */
export class HttpStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _configuration: BenzeneConfiguration): void {
    useAzureFunctions(app, (az) => useAzureHttp(az, (http) => useMessageHandlers(http, PlaceOrderHandler)));
  }
}

/** Service Bus trigger (batched): each message routes by its `topic` application property. */
export class ServiceBusStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _configuration: BenzeneConfiguration): void {
    useAzureFunctions(app, (az) => useServiceBus(az, (sb) => useMessageHandlers(sb, NotifyWarehouseHandler)));
  }
}

/** Event Hub trigger (batched): each event carries a serialized BenzeneMessage envelope; route on its topic. */
export class EventHubStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _configuration: BenzeneConfiguration): void {
    useAzureFunctions(app, (az) =>
      useEventHub(az, (eh) => useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, NotifyWarehouseHandler))),
    );
  }
}

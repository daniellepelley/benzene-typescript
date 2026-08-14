/**
 * The three trigger handlers the Azure Functions host invokes, one per trigger — each the native-trigger
 * getter of an `AzureFunctionHost` booted once, at module load, from its `BenzeneStartUp` in `startUp.ts`.
 * This is the one-liner boot: `new AzureFunctionHost(StartUp).httpFunction` replaces the hand-built
 * `azureApp(...)` assembly, reading identically to the AWS example's `new AwsLambdaHost(StartUp).lambdaHandler`.
 *
 * The idiomatic `app.http(...)`/`app.serviceBusQueue(...)`/`app.eventHub(...)` registrations that bind
 * these to real triggers live in `registrations.ts`.
 */
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
// Importing the transport packages lights up the host's native-trigger getters
// (`.httpFunction`/`.serviceBusFunction`/`.eventHubFunction`) — the same import each trigger needs anyway
// for its `use*` wiring in `startUp.ts`.
import '@benzenejs/azure-function-http';
import '@benzenejs/azure-function-service-bus';
import '@benzenejs/azure-function-event-hub';
import { EventHubStartUp, HttpStartUp, ServiceBusStartUp } from './startUp';

/** HTTP trigger (request/response): `POST /orders` returns an order confirmation. */
export const placeOrderHttp = new AzureFunctionHost(HttpStartUp).httpFunction;

/** Service Bus trigger (batched): each message routes by its `topic` application property. */
export const orderPlacedServiceBus = new AzureFunctionHost(ServiceBusStartUp).serviceBusFunction;

/** Event Hub trigger (batched): each event routes by its embedded topic. */
export const orderPlacedEventHub = new AzureFunctionHost(EventHubStartUp).eventHubFunction;

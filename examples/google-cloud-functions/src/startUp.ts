/**
 * The one platform-neutral application definition, ported from the .NET `Benzene.Examples.Google`
 * `Startup`. It wires the order handlers onto HTTP and never references Cloud Run or Cloud Functions
 * directly — the same `StartUp` is booted by the Cloud Functions Gen2 deploy entry (`function.ts`, via
 * `GoogleCloudFunctionHost`) and by the component test (`buildGoogleCloudFunctionHost(benzeneTestHost(...))`).
 */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import {
  GoogleCloudFunctionApplicationBuilder,
  GoogleCloudFunctionStartUp,
  useHttp,
} from '@benzene/google-cloud-functions-http';
import { CreateOrderHandler, ListOrdersHandler } from './handlers';
import { IOrderStore, InMemoryOrderStore } from './orderStore';

export class GoogleCloudOrdersStartUp implements GoogleCloudFunctionStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    services.addSingleton(IOrderStore, InMemoryOrderStore);
    // The Benzene baseline is ensured idempotently by useMessageHandlers (in `configure`).
  }

  configure(app: GoogleCloudFunctionApplicationBuilder): void {
    useHttp(app, (http) => useMessageHandlers(http, CreateOrderHandler, ListOrdersHandler));
  }
}

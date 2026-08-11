/**
 * The one platform-neutral application definition, ported from the .NET `Benzene.Examples.Google`
 * `Startup`. It wires the order handlers onto HTTP and never references Cloud Run or Cloud Functions
 * directly — the same `StartUp` is booted by the Cloud Functions Gen2 deploy entry (`function.ts`, via
 * `GoogleCloudFunctionHost`) and by the component test (`buildGoogleCloudFunctionHost(benzeneTestHost(...))`).
 *
 * This is the SAME unified `BenzeneStartUp` shape an AWS or Azure service ships (see
 * `examples/aws-lambda-functions` / `examples/azure-functions`): `getConfiguration` /
 * `configureServices` / `configure(app: IBenzeneApplicationBuilder, config)`. The ONLY cloud-specific line
 * is the `use<Cloud>` verb inside `configure` — here `useGoogleCloud(app, g => useHttp(g, …))`, exactly
 * where AWS writes `useAwsLambda(app, aws => …)` and Azure writes `useAzureFunctions(app, az => …)`.
 */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import {
  BenzeneConfiguration,
  BenzeneStartUp,
  IBenzeneApplicationBuilder,
} from '@benzene/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { useGoogleCloud } from '@benzene/google-cloud-functions-core';
import { useHttp } from '@benzene/google-cloud-functions-http';
import { CreateOrderHandler, ListOrdersHandler } from './handlers';
import { IOrderStore, InMemoryOrderStore } from './orderStore';

export class GoogleCloudOrdersStartUp implements BenzeneStartUp {
  getConfiguration(): BenzeneConfiguration {
    return { get: (key) => process.env[key] };
  }

  configureServices(services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {
    services.addSingleton(IOrderStore, InMemoryOrderStore);
    // `addBenzene` registers Benzene's baseline; `useMessageHandlers` (in `configure`) also ensures it
    // idempotently, so this is the explicit composition root.
    addBenzene(services);
  }

  // The one Google-specific line — swap `useGoogleCloud`/`useHttp` for `useAwsLambda`/`useApiGateway`
  // (or `useAzureFunctions`/`useAzureHttp`) to host the identical handlers on another cloud.
  configure(app: IBenzeneApplicationBuilder, _configuration: BenzeneConfiguration): void {
    useGoogleCloud(app, (g) =>
      useHttp(g, (http) => useMessageHandlers(http, CreateOrderHandler, ListOrdersHandler)),
    );
  }
}

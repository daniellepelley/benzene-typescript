/**
 * Shared app builder: wires Benzene onto the first-party container and hands the builder to a
 * per-trigger `configure` callback, returning the built `IAzureFunctionApp` the function callbacks
 * dispatch to via the `handle*` helpers.
 */
import { addBenzene } from '@benzene/core-message-handlers';
import {
  IAzureFunctionApp,
  IAzureFunctionAppBuilder,
  InlineAzureFunctionStartUp,
} from '@benzene/azure-function-core';

export function azureApp(configure: (app: IAzureFunctionAppBuilder) => void): IAzureFunctionApp {
  return new InlineAzureFunctionStartUp()
    .configureServices((services) => addBenzene(services))
    .configure(configure)
    .build();
}

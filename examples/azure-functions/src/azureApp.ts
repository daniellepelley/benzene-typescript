/**
 * Shared app builder: wires Benzene onto the first-party container and hands the builder to a
 * per-trigger `configure` callback, returning the built `IAzureFunctionApp` the function callbacks
 * dispatch to via the `handle*` helpers.
 */
import {
  IAzureFunctionApp,
  IAzureFunctionAppBuilder,
  InlineAzureFunctionStartUp,
} from '@benzene/azure-function-core';

export function azureApp(configure: (app: IAzureFunctionAppBuilder) => void): IAzureFunctionApp {
  // No `configureServices` needed: each trigger's `useMessageHandlers` registers the Benzene baseline
  // (`addBenzene`) idempotently, so the app is fully wired by `configure` alone.
  return new InlineAzureFunctionStartUp().configure(configure).build();
}

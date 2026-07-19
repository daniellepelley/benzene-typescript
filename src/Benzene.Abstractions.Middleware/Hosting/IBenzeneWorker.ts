import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Port of Benzene.Abstractions.Hosting.IBenzeneWorker.
 *
 * A long-running worker started/stopped by a host. Consumers are resolved from the container as a set
 * (`IEnumerable<IBenzeneWorker>` in C#), so it declares a merged `ServiceToken`.
 *
 * ADAPTATION — cancellation. C# `Task StartAsync/StopAsync(CancellationToken)` maps to
 * `Promise<void>` (C# `Task` → `Promise`) with an optional `AbortSignal`, the Node/web-standard
 * equivalent of `CancellationToken` (there is no prior use of either in the port; this establishes the
 * mapping). The signal is optional so callers with no cancellation source can omit it.
 */
export interface IBenzeneWorker {
  startAsync(cancellationToken?: AbortSignal): Promise<void>;
  stopAsync(cancellationToken?: AbortSignal): Promise<void>;
}

export const IBenzeneWorker: ServiceToken<IBenzeneWorker> =
  serviceToken<IBenzeneWorker>('IBenzeneWorker');

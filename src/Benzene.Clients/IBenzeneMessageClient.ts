import { IBenzeneResultOf, ServiceToken, serviceToken } from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';

/**
 * Port of Benzene.Clients.IBenzeneMessageClient.
 *
 * A transport-agnostic client that sends an outbound message (topic + payload + headers) to a
 * Benzene service and returns the typed result. C# `IDisposable.Dispose()` maps to `dispose()`.
 *
 * The C# `BenzeneMessageClientExtensions` static class in this file is empty, so nothing is ported
 * from it; the client's free-function helpers live in `ClientExtensions.ts`.
 */
export interface IBenzeneMessageClient {
  /** Port of C# `Task<IBenzeneResult<TResponse>> SendMessageAsync<TRequest, TResponse>(IBenzeneClientRequest<TRequest>)`. */
  sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>>;

  /** Port of C# `IDisposable.Dispose()`. */
  dispose(): void;
}

/**
 * Token for resolving the client from the container. C# registers `IBenzeneMessageClient` via
 * `AddScoped<IBenzeneMessageClient>(builder)` (see `SingleClientsBuilder`) and resolves it with
 * `GetService<IBenzeneMessageClient>()`, so per the port's service-resolution convention the
 * interface declares a merged `ServiceToken` of the same name.
 */
export const IBenzeneMessageClient: ServiceToken<IBenzeneMessageClient> =
  serviceToken<IBenzeneMessageClient>('IBenzeneMessageClient');

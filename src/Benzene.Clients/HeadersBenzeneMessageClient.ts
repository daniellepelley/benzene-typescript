import { IBenzeneResultOf } from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import { IBenzeneMessageClient } from './IBenzeneMessageClient';
import { IClientHeaders } from './IClientHeaders';
import { BenzeneClientRequest } from './BenzeneClientRequest';

/**
 * Port of Benzene.Clients.HeadersBenzeneMessageClient.
 *
 * Decorates an `IBenzeneMessageClient`, merging every header from an `IClientHeaders` bag onto each
 * outgoing request (bag values win on key collision) before delegating. C# mutates the request's
 * header dictionary in place; here the incoming headers are copied into a new record.
 *
 * Note: like `HeaderBenzeneMessageClient`, the .NET source has no `IDependencyWrapper` for this
 * decorator, so none is ported.
 */
export class HeadersBenzeneMessageClient implements IBenzeneMessageClient {
  constructor(
    private readonly inner: IBenzeneMessageClient,
    private readonly clientHeaders: IClientHeaders,
  ) {}

  dispose(): void {
    this.inner.dispose();
  }

  sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    const headers = HeadersBenzeneMessageClient.populateHeaders(request.headers, this.clientHeaders.get());
    return this.inner.sendMessageAsync<TRequest, TResponse>(
      new BenzeneClientRequest<TRequest>(request.topic, request.message, headers),
    );
  }

  private static populateHeaders(
    sourceHeaders: Record<string, string> | undefined,
    newHeaders: Record<string, string>,
  ): Record<string, string> {
    const result: Record<string, string> = { ...(sourceHeaders ?? {}) };
    for (const [key, value] of Object.entries(newHeaders)) {
      result[key] = value;
    }
    return result;
  }
}

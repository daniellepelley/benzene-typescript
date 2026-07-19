import { IBenzeneResultOf } from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import { IBenzeneMessageClient } from './IBenzeneMessageClient';
import { BenzeneClientRequest } from './BenzeneClientRequest';

/**
 * Port of Benzene.Clients.HeaderBenzeneMessageClient.
 *
 * Decorates an `IBenzeneMessageClient`, stamping a single fixed (key, value) header onto every
 * outgoing request before delegating. C# `null` headers -> a fresh record; here the ported
 * `IBenzeneClientRequest.headers` is a non-nullable `Record`, so the incoming headers are copied
 * (defensively defaulting to `{}`) rather than mutated in place.
 *
 * Note: the .NET source has no `HeaderBenzeneMessageClientWrapper` (no `IDependencyWrapper` for this
 * decorator), so none is ported. It is constructed directly (e.g. by a transport builder).
 */
export class HeaderBenzeneMessageClient implements IBenzeneMessageClient {
  constructor(
    private readonly inner: IBenzeneMessageClient,
    private readonly key: string,
    private readonly value: string,
  ) {}

  dispose(): void {
    this.inner.dispose();
  }

  sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    const headers = this.populateHeaders(request.headers);
    return this.inner.sendMessageAsync<TRequest, TResponse>(
      new BenzeneClientRequest<TRequest>(request.topic, request.message, headers),
    );
  }

  private populateHeaders(headers: Record<string, string> | undefined): Record<string, string> {
    const result: Record<string, string> = { ...(headers ?? {}) };
    result[this.key] = this.value;
    return result;
  }
}

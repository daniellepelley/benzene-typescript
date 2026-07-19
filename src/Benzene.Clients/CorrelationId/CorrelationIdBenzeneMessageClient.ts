import { IBenzeneResultOf, ICorrelationId } from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import { IBenzeneMessageClient } from '../IBenzeneMessageClient';
import { BenzeneClientRequest } from '../BenzeneClientRequest';

/**
 * Port of Benzene.Clients.CorrelationId.CorrelationIdBenzeneMessageClient.
 *
 * Decorates an `IBenzeneMessageClient`, stamping the current invocation's correlation id (from
 * `ICorrelationId.get()`) onto every outgoing request's headers under `correlationKey` (default
 * `"correlationId"`) before delegating. C# mutates the header dictionary in place; here the incoming
 * headers are copied into a new record.
 */
export class CorrelationIdBenzeneMessageClient implements IBenzeneMessageClient {
  constructor(
    private readonly inner: IBenzeneMessageClient,
    private readonly correlationId: ICorrelationId,
    private readonly correlationKey: string = 'correlationId',
  ) {}

  dispose(): void {
    this.inner.dispose();
  }

  sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    const matchingHeaders = this.populateHeaders(request.headers);
    return this.inner.sendMessageAsync<TRequest, TResponse>(
      new BenzeneClientRequest<TRequest>(request.topic, request.message, matchingHeaders),
    );
  }

  private populateHeaders(headers: Record<string, string> | undefined): Record<string, string> {
    const result: Record<string, string> = { ...(headers ?? {}) };
    result[this.correlationKey] = this.correlationId.get();
    return result;
  }
}

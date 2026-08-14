import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IBenzeneMessageSender } from '@benzenejs/clients';
import { BenzeneResult } from '@benzenejs/results';

/**
 * A structural fake for the outbound `IBenzeneMessageSender`: captures the topic/request/headers of the
 * last call instead of sending anywhere, so an end-to-end test can assert on what a service published
 * (egress) without a live queue/topic. Register it via `benzeneTestHost(...).withServices(services =>
 * services.addSingletonInstance(IBenzeneMessageSender, fake))`, which runs after the startup's own
 * `configureServices` (last-registration-wins).
 *
 * FIDELITY NOTE: in the .NET reference this fake is re-declared as a helper in each example test project
 * (each `examples` host's `Helpers/FakeBenzeneMessageSender.cs`). The port promotes it into `@benzenejs/testing` so
 * adopters get the egress test double first-party — the one small addition over the reference, recorded in
 * the README "Porting conventions" ledger. Behaviour matches the C# original: it returns `Accepted`.
 */
export class FakeBenzeneMessageSender implements IBenzeneMessageSender {
  lastTopic?: string;
  lastRequest?: unknown;
  lastHeaders?: Record<string, string>;

  sendAsync<TRequest, TResponse>(
    topic: string,
    request: TRequest,
    headers?: Record<string, string>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    this.lastTopic = topic;
    this.lastRequest = request;
    this.lastHeaders = headers;
    return Promise.resolve(BenzeneResult.accepted<TResponse>());
  }
}

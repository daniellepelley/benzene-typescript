/** Port of Benzene.Schema.OpenApi.SpecMessageHandler. */
import { IBenzeneResultOf, IServiceResolver } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { RawStringMessage } from '@benzenejs/core-messages';
import { BenzeneResult } from '@benzenejs/results';
import { SpecBuilder } from './SpecBuilder';
import { SpecCache } from './SpecCache';
import { SpecRequest } from './SpecRequest';

/**
 * Serves the spec document on the `spec` topic as a `RawStringMessage` (pre-serialized JSON delivered
 * as-is). Memoizes via the registered `SpecCache` — only the first request for each `(type, format)` pays
 * the build cost — falling back to a direct build when no cache is registered.
 */
export class SpecMessageHandler implements IMessageHandler<SpecRequest, RawStringMessage> {
  constructor(private readonly resolver: IServiceResolver) {}

  handleAsync(request: SpecRequest): Promise<IBenzeneResultOf<RawStringMessage>> {
    const specRequest = request ?? new SpecRequest('benzene', 'json');
    const cache = this.resolver.tryGetService(SpecCache);
    const output =
      cache !== undefined
        ? cache.getOrBuild(specRequest, (r) => new SpecBuilder().createSpec(this.resolver, r))
        : new SpecBuilder().createSpec(this.resolver, specRequest);
    return Promise.resolve(BenzeneResult.ok(new RawStringMessage(output)));
  }
}

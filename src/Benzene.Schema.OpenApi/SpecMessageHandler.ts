/** Port of Benzene.Schema.OpenApi.SpecMessageHandler. */
import { IBenzeneResultOf, IServiceResolver } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { RawStringMessage } from '@benzenejs/core-messages';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import { SpecBuilder } from './SpecBuilder';
import { SpecCache } from './SpecCache';
import { SpecRequest } from './SpecRequest';

/** The document types this port can produce for `benzene:spec` (`benzene` is the contract document). */
export const SupportedSpecTypes: readonly string[] = ['benzene', 'openapi', 'asyncapi'];

/** The formats this port can produce for `benzene:spec`. */
export const SupportedSpecFormats: readonly string[] = ['json'];

/**
 * Serves the spec document on the `benzene:spec` topic as a `RawStringMessage` (pre-serialized JSON delivered
 * as-is). Memoizes via the registered `SpecCache` — only the first request for each `(type, format)` pays
 * the build cost — falling back to a direct build when no cache is registered.
 *
 * Request handling (wire-contracts §7): an absent body, an empty body, `null` and `{}` all mean
 * `type: "benzene"`, `format: "json"` — the contract document. Values are compared case-insensitively. A
 * `type` or `format` this port does not produce is answered `not-implemented`, never with a different
 * document. `openapi` and `asyncapi` are this port's extensions; `json` is its only format.
 */
export class SpecMessageHandler implements IMessageHandler<SpecRequest, RawStringMessage> {
  constructor(private readonly resolver: IServiceResolver) {}

  handleAsync(request: SpecRequest): Promise<IBenzeneResultOf<RawStringMessage>> {
    const type = normalize(request?.type) ?? 'benzene';
    const format = normalize(request?.format) ?? 'json';

    if (!SupportedSpecTypes.includes(type)) {
      return Promise.resolve(
        BenzeneResult.setErrors<RawStringMessage>(
          BenzeneResultStatus.notImplemented,
          `Spec type '${type}' is not supported; supported types: ${SupportedSpecTypes.join(', ')}`,
        ),
      );
    }
    if (!SupportedSpecFormats.includes(format)) {
      return Promise.resolve(
        BenzeneResult.setErrors<RawStringMessage>(
          BenzeneResultStatus.notImplemented,
          `Spec format '${format}' is not supported; supported formats: ${SupportedSpecFormats.join(', ')}`,
        ),
      );
    }

    const specRequest = new SpecRequest(type, format);
    const cache = this.resolver.tryGetService(SpecCache);
    const output =
      cache !== undefined
        ? cache.getOrBuild(specRequest, (r) => new SpecBuilder().createSpec(this.resolver, r))
        : new SpecBuilder().createSpec(this.resolver, specRequest);
    return Promise.resolve(BenzeneResult.ok(new RawStringMessage(output)));
  }
}

function normalize(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = String(value).trim().toLowerCase();
  return trimmed === '' ? undefined : trimmed;
}

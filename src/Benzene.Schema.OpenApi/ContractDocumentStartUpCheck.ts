import { IServiceResolver, IStartUpCheck } from '@benzenejs/abstractions';
import { SpecBuilder } from './SpecBuilder';
import { SpecCache } from './SpecCache';
import { SpecRequest } from './SpecRequest';

/**
 * Derives the Contract Document once at start-up, so a derivation error fails the service before any
 * message is handled (contract-document.md §3.3, §4.1 rule 4) instead of on the first `benzene:spec` call:
 * a component name claimed by two different schemas (`ComponentNameCollisionError`), or a topic declared both
 * as an event and as a send. Registered by `useSpec`; obeys `BenzeneStartUpCheckOptions` like every check.
 *
 * The derived document is primed into the `SpecCache` when one is registered, so the first `benzene:spec`
 * call pays nothing extra.
 */
export class ContractDocumentStartUpCheck implements IStartUpCheck {
  readonly name = 'contract-document';

  check(resolver: IServiceResolver): void {
    const request = new SpecRequest('benzene', 'json');
    const build = (r: SpecRequest): string => new SpecBuilder().createSpec(resolver, r);
    const cache = resolver.tryGetService(SpecCache);
    if (cache !== undefined) {
      cache.getOrBuild(request, build);
    } else {
      build(request);
    }
  }
}

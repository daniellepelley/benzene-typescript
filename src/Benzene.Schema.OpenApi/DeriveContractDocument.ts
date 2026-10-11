import { IServiceResolver } from '@benzenejs/abstractions';
import { SpecBuilder } from './SpecBuilder';
import { SpecCache } from './SpecCache';
import { SpecRequest } from './SpecRequest';

/**
 * The service's Contract Document as JSON - the exact string `benzene:spec` serves for the default request
 * (`type: "benzene"`, `format: "json"`), memoized through the registered `SpecCache` when there is one, so every
 * reader of it (the spec topic, the start-up check, a mesh announcer registering it, mesh.md §2) shares one
 * derivation and one document.
 */
export function deriveContractDocument(resolver: IServiceResolver): string {
  const request = new SpecRequest('benzene', 'json');
  const build = (r: SpecRequest): string => new SpecBuilder().createSpec(resolver, r);
  const cache = resolver.tryGetService(SpecCache);
  return cache !== undefined ? cache.getOrBuild(request, build) : build(request);
}

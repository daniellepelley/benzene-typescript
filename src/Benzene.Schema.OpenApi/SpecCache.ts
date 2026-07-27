/** Port of Benzene.Schema.OpenApi.SpecCache. */
import { SpecRequest } from './SpecRequest';

/**
 * Memoizes the generated spec per `(type, format)` — the document is deterministic for the process lifetime,
 * so repeated polling (e.g. the mesh aggregator interrogating the `spec` topic) doesn't re-run the full
 * schema-generation build each time. Registered as a singleton by `useSpec`.
 */
export class SpecCache {
  private readonly cache = new Map<string, string>();

  getOrBuild(request: SpecRequest, build: (request: SpecRequest) => string): string {
    const key = `${request.type ?? ''}|${request.format ?? ''}`;
    let value = this.cache.get(key);
    if (value === undefined) {
      value = build(request);
      this.cache.set(key, value);
    }
    return value;
  }
}

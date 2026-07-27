/** Port of Benzene.Schema.OpenApi.EventService.HttpMapping. */

/** An HTTP method+path a topic is reachable at. */
export class HttpMapping {
  constructor(
    readonly method: string,
    readonly path: string,
  ) {}

  toJson(): Record<string, unknown> {
    return { method: this.method, path: this.path };
  }
}

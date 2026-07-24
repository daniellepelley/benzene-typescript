/** Port of Benzene.Mesh.Dispatch.MeshDispatchEnvelope (+ MeshDispatchResult). */

/** The message to dispatch to a target service (the standard Benzene message envelope). */
export class MeshDispatchEnvelope {
  constructor(
    readonly topic: string,
    readonly headers: Record<string, string>,
    readonly body: string,
  ) {}
}

/** The response a target service returned to a dispatched message. */
export class MeshDispatchResult {
  readonly headers: Record<string, string>;

  /**
   * @param statusCode The status the service returned (a Benzene result status, or an HTTP status for HTTP targets).
   * @param body The response body the service returned.
   */
  constructor(
    readonly statusCode: string,
    readonly body: string | undefined,
    headers?: Record<string, string>,
  ) {
    this.headers = headers ?? {};
  }
}

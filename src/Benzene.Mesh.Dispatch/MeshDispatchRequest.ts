/** Port of Benzene.Mesh.Dispatch.MeshDispatchRequest. */

/**
 * A request to dispatch a test message to one registered service (the `benzene:mesh:dispatch` body). Plain
 * settable fields (wire-deserialized input); `string?`/`Dictionary?` -> `| undefined`.
 */
export class MeshDispatchRequest {
  /** The target service's name (its key in the mesh registry). */
  service: string | undefined;

  /** The topic to invoke on the target service. */
  topic: string | undefined;

  /** Message headers to carry (optional). */
  headers: Record<string, string> | undefined;

  /** The serialized message body (optional). */
  body: string | undefined;

  /**
   * The caller's abort signal for this dispatch, if any — NOT part of the wire shape (JSON cannot
   * carry one, and the handler ignores anything that is not a real `AbortSignal`). Wave 1's
   * signal-rides-the-request convention, the port of .NET #185's ambient cancellation token: a
   * transport threads its client-gone signal onto the deserialized request (e.g. via a request
   * enricher copying `context.benzeneMessageRequest.signal`), or a direct caller sets it; the
   * handler passes it into `IMeshServiceDispatcher.dispatchAsync`.
   */
  signal?: AbortSignal;
}

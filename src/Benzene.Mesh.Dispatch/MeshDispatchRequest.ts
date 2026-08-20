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
}

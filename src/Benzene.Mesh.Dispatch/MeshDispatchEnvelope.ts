/** Port of Benzene.Mesh.Dispatch.MeshDispatchEnvelope (+ MeshDispatchResult). */
import { transportFailureResult } from '@benzenejs/results';

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

/**
 * The {@link MeshDispatchResult} for a dispatch that failed before the target service replied - no
 * connection, a refused or reset request, an aborted or timed-out call: `timeout` when the deadline elapsed,
 * otherwise `service-unavailable`, with the failure's message as the body (transport-bindings.md §1, spec 1.1:
 * a result, not an exception). A port addition shared by the HTTP and Lambda dispatchers.
 */
export function transportFailureDispatchResult(error: unknown): MeshDispatchResult {
  const result = transportFailureResult<unknown>(error);
  return new MeshDispatchResult(result.status, result.errors[0]?.message);
}

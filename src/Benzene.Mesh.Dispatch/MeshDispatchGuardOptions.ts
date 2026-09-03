/** Port of Benzene.Mesh.Dispatch.MeshDispatchGuardOptions. */
import { DispatchTopic } from './DispatchTopic';

/**
 * What the dispatch endpoint requires of a caller before a real handler is invoked with their payload.
 *
 * Every default here is a bound on ONE signed-in human iterating on a test payload — the only caller
 * this endpoint exists for. They are not sized for a service-to-service caller, because a service
 * that wants to send a message has a transport and does not need the mesh to relay it.
 *
 * C# consts → `static readonly` members; settable properties → instance fields.
 */
export class MeshDispatchGuardOptions {
  /**
   * The CSRF header, a fixed contract shared with the mesh UI exactly as `X-Benzene-Refresh` is. A
   * cross-site form cannot set a custom header, and a cross-origin fetch that sets one is
   * preflighted.
   */
  static readonly DefaultHeaderName = 'X-Benzene-Dispatch';

  /** Requests per minute one identity may dispatch. */
  static readonly DefaultMaxPerMinutePerIdentity = 10;

  /** Requests per minute all identities together may aim at one target service. */
  static readonly DefaultMaxPerMinutePerTarget = 30;

  /** The largest request body accepted, in bytes. */
  static readonly DefaultMaxRequestBytes = 131_072;

  /** The path this guard protects. Matched canonically, and by topic — see the middleware. */
  path = '/mesh/dispatch';

  /**
   * The dispatch topic, matched through the registered route finder as a second signal so a route
   * alias cannot slip past the path check. `undefined` narrows matching to the path alone.
   */
  topic: string | undefined = DispatchTopic;

  /** The required CSRF header name. See {@link MeshDispatchGuardOptions.DefaultHeaderName}. */
  headerName = MeshDispatchGuardOptions.DefaultHeaderName;

  /**
   * Requests per minute per identity. 0 disables the per-identity limit — which is a deliberate
   * operator choice, not a default.
   */
  maxPerMinutePerIdentity = MeshDispatchGuardOptions.DefaultMaxPerMinutePerIdentity;

  /**
   * Requests per minute aimed at one target service, across every identity. This is the bound that
   * matters for the target: ten people iterating politely still add up at the service.
   */
  maxPerMinutePerTarget = MeshDispatchGuardOptions.DefaultMaxPerMinutePerTarget;

  /**
   * Largest accepted request body. Enforced before any JSON is parsed, so an oversized payload
   * costs a length check rather than a deserialization.
   */
  maxRequestBytes = MeshDispatchGuardOptions.DefaultMaxRequestBytes;
}

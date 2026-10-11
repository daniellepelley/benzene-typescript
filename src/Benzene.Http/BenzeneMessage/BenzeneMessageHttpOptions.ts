/** Port of Benzene.Http.BenzeneMessage.BenzeneMessageHttpOptions. */

/**
 * Options for the BenzeneMessage-over-HTTP endpoint (see {@link useBenzeneMessage}).
 */
export class BenzeneMessageHttpOptions {
  /**
   * The default path the endpoint listens on: `/benzene/invoke`, the well-known envelope path
   * (design-principles §5.2). Configurable per service via {@link BenzeneMessageHttpOptions.path}.
   */
  static readonly defaultPath = '/benzene/invoke';

  /**
   * The path the endpoint listens on for POSTed BenzeneMessage envelopes.
   * Defaults to {@link BenzeneMessageHttpOptions.defaultPath}.
   */
  path: string = BenzeneMessageHttpOptions.defaultPath;

  /**
   * An optional topic allowlist predicate — the restriction the envelope endpoint MUST support
   * (transport-bindings §1, D21): the endpoint reaches every handler the service registers, including
   * topics with no HTTP route of their own. When set, an envelope whose topic the predicate rejects is
   * answered exactly as if no handler matched — a processed `not-found` envelope (HTTP 200) — instead of
   * being dispatched. When `undefined` (the default), every topic is dispatched.
   * Port of C# `Func<string, bool>? TopicFilter`.
   */
  topicFilter?: (topic: string) => boolean;
}

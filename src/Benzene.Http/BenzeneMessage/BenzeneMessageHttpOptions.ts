/** Port of Benzene.Http.BenzeneMessage.BenzeneMessageHttpOptions. */

/**
 * Options for the BenzeneMessage-over-HTTP endpoint (see {@link useBenzeneMessage}).
 */
export class BenzeneMessageHttpOptions {
  /** The default path the endpoint listens on. */
  static readonly defaultPath = '/benzene-message';

  /**
   * The path the endpoint listens on for POSTed BenzeneMessage envelopes.
   * Defaults to {@link BenzeneMessageHttpOptions.defaultPath}.
   */
  path: string = BenzeneMessageHttpOptions.defaultPath;

  /**
   * An optional topic allowlist predicate. When set, an envelope whose topic the predicate rejects is
   * answered with a `NotFound` envelope instead of being dispatched. When `undefined` (the default),
   * every topic is dispatched. Port of C# `Func<string, bool>? TopicFilter`.
   */
  topicFilter?: (topic: string) => boolean;
}

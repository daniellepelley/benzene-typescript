/**
 * The pipeline context for one outbound send: the topic being sent on, the request payload, and a
 * settable slot for the response - the outbound mirror of how inbound transport contexts carry a request
 * and a result. Deliberately non-generic (matching every other `IMiddleware<TContext>` in the codebase).
 * Port of Benzene.Clients.OutboundContext.
 */
export class OutboundContext {
  /** The topic this send was routed to. */
  readonly topic: string;

  /** The request payload being sent. */
  readonly request: unknown;

  /** The per-call headers supplied by the caller. */
  readonly headers: Record<string, string>;

  /**
   * The response, set by the outbound pipeline's transport middleware once the send completes. Read back
   * by {@link DefaultBenzeneMessageSender} after the pipeline finishes.
   */
  response: unknown;

  constructor(topic: string, request: unknown, headers?: Record<string, string>) {
    this.topic = topic;
    this.request = request;
    // Copy, don't alias: the outbound middleware (correlation id, trace context) write onto headers, so
    // holding the caller's own object would mutate it across sends and race concurrent sends sharing one.
    this.headers = headers === undefined ? {} : { ...headers };
  }
}

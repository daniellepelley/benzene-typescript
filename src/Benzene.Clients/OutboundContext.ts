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

  /**
   * The caller's abort signal for this send, if any. Transport context converters copy it onto their
   * transport send context and the terminal client middleware hands it to the underlying SDK call
   * where the SDK accepts one — so an aborted inbound request (or any caller-imposed bound) stops the
   * outbound call instead of running it to completion.
   *
   * PORTING NOTE: .NET threads the ambient `ICancellationTokenAccessor` into each client middleware's
   * constructor; this port has no ambient token accessor, so the signal rides the outbound context
   * instead — set it from a route middleware, or wherever the send is initiated, before the terminal
   * converter runs.
   */
  signal?: AbortSignal;

  constructor(topic: string, request: unknown, headers?: Record<string, string>) {
    this.topic = topic;
    this.request = request;
    // Copy, don't alias: the outbound middleware (correlation id, trace context) write onto headers, so
    // holding the caller's own object would mutate it across sends and race concurrent sends sharing one.
    this.headers = headers === undefined ? {} : { ...headers };
  }
}

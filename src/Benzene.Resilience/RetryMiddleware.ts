import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';

/** A function that delays for the given number of milliseconds. Port of C# `Func<TimeSpan, Task>`. */
export type DelayFunc = (delayMs: number) => Promise<void>;

/**
 * Options for {@link RetryMiddleware}. Mirrors the C# constructor's optional parameters;
 * `TimeSpan` maps to a millisecond `number`.
 */
export interface RetryOptions<TContext> {
  numberOfRetries?: number;
  /** Initial delay in milliseconds before the first retry (C# `TimeSpan? initialDelay`). */
  initialDelayMs?: number;
  backoffFactor?: number;
  shouldRetry?: (error: unknown) => boolean;
  shouldRetryContext?: (context: TContext) => boolean;
  delay?: DelayFunc;
  /**
   * The caller's own abort signal. Once it is aborted, no further retries are attempted — the last
   * error propagates (or, on the context-predicate path, the last result stands) — regardless of the
   * `shouldRetry`/`shouldRetryContext` predicates. When omitted, the middleware reads a `signal`
   * member structurally off the context (so a context that carries the inbound request's signal is
   * honoured per invocation).
   */
  signal?: AbortSignal;
}

const defaultDelay: DelayFunc = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

/**
 * Retries the rest of the pipeline on failure, with exponential backoff.
 * Port of Benzene.Resilience.RetryMiddleware&lt;TContext&gt;.
 *
 * Deviations: C# `TimeSpan` becomes a millisecond `number`; the C# `catch (ex) when (filter)`
 * exception filter becomes an explicit rethrow when the filter is not satisfied.
 *
 * CANCELLATION SEMANTICS (the .NET R16 #252/#256 rule, ported): "is this OUR cancellation?" is
 * decided by the caller's own signal, never by the error's type. The default predicate therefore
 * retries ANY error unless the caller's own `AbortSignal` (the `signal` option, or a `signal`
 * member read structurally off the context) is aborted — a foreign timeout-shaped error (e.g. a
 * per-request HTTP timeout throwing an `AbortError` without the caller's signal being aborted) is
 * a transient failure and IS retried, while an aborted caller signal stops retrying immediately
 * whatever the error looks like. The earlier `error instanceof OperationCanceledException` default
 * was exactly the type-based filter that rule replaces (an unrelated error dressed in that type
 * would have escaped retry; a genuine caller abort surfacing as any other type would have been
 * retried).
 */
export class RetryMiddleware<TContext> implements IMiddleware<TContext> {
  private readonly numberOfRetries: number;
  private readonly initialDelayMs: number;
  private readonly backoffFactor: number;
  private readonly shouldRetry: (error: unknown) => boolean;
  private readonly shouldRetryContext: (context: TContext) => boolean;
  private readonly delay: DelayFunc;
  private readonly signal?: AbortSignal;

  constructor(options: RetryOptions<TContext> = {}) {
    this.numberOfRetries = options.numberOfRetries ?? 3;
    this.initialDelayMs = options.initialDelayMs ?? 200;
    this.backoffFactor = options.backoffFactor ?? 2.0;
    this.shouldRetry = options.shouldRetry ?? (() => true);
    this.shouldRetryContext = options.shouldRetryContext ?? (() => false);
    this.delay = options.delay ?? defaultDelay;
    this.signal = options.signal;
  }

  readonly name = 'RetryMiddleware';

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    // The middleware's own signal wins; otherwise honour a signal the context carries (the inbound
    // request's, threaded by the transport binding).
    const signal = this.signal ?? signalOf(context);
    let attempt = 0;
    let delay = this.initialDelayMs;

    for (;;) {
      try {
        await next();

        if (attempt >= this.numberOfRetries || signal?.aborted === true || !this.shouldRetryContext(context)) {
          return;
        }
      } catch (error) {
        // Port of the C# `catch when (attempt < retries && shouldRetry(ex))` filter:
        // if the filter is not satisfied, the exception propagates unchanged. An aborted caller
        // signal always fails the filter — our own cancellation is never retried.
        if (!(attempt < this.numberOfRetries && signal?.aborted !== true && this.shouldRetry(error))) {
          throw error;
        }
      }

      attempt++;
      await this.delay(delay);
      delay = delay * this.backoffFactor;
    }
  }
}

/** Reads an `AbortSignal` structurally off a context that carries one as a `signal` member. */
function signalOf(context: unknown): AbortSignal | undefined {
  const candidate = (context as { signal?: unknown } | null | undefined)?.signal;
  return candidate instanceof AbortSignal ? candidate : undefined;
}

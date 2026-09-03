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
  /**
   * Caps the actual sleep duration each attempt, in milliseconds (C# `TimeSpan? maxDelay`; default
   * `undefined` = uncapped). The underlying exponential growth used to compute the NEXT attempt's
   * delay is left uncapped, so later attempts still compound off the true curve — matching AWS's
   * documented "full jitter" algorithm: `sleep = random(0, min(cap, base * factor^attempt))`.
   */
  maxDelayMs?: number;
  /**
   * Transforms the capped delay into the actual sleep duration, in milliseconds (C#
   * `Func<TimeSpan, TimeSpan>? jitter`; default identity = no jitter).
   * {@link RetryMiddleware.fullJitter} is a ready-made "full jitter" implementation
   * (`random(0, delay)`) you can pass straight in — it spreads out retries from many callers that
   * backed off at the same moment instead of them all retrying in lockstep.
   */
  jitter?: (delayMs: number) => number;
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

// Node's setTimeout treats a delay above 2^31-1 ms (~24.8 days) as overflowed and fires it after
// 1 ms. With no maxDelayMs set the uncapped exponential sleep crosses that ceiling around attempt
// ~25, so the actual sleep is clamped here — the port of .NET's `MaxSleep` clamp (Task.Delay
// *throws* above the same int.MaxValue-ms boundary; setTimeout's failure mode is a silent
// fire-immediately, which would turn the tail of a long backoff into a hot loop).
const maxSleepMs = 2_147_483_647;

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
  /**
   * The "full jitter" backoff algorithm (AWS's documented recommendation): returns a jitter function
   * yielding a random duration between zero and the input delay. Pass the result as the
   * {@link RetryOptions.jitter} option. Port of the C# non-generic companion
   * `RetryMiddleware.FullJitter(Random?)` — the injectable `random` (a `Math.random`-shaped source,
   * defaulting to `Math.random`) is the C# `Random` parameter, letting tests pin the sleep sequence
   * with a seeded/deterministic source.
   */
  static fullJitter(random: () => number = Math.random): (delayMs: number) => number {
    return (delayMs) => random() * delayMs;
  }

  private readonly numberOfRetries: number;
  private readonly initialDelayMs: number;
  private readonly backoffFactor: number;
  private readonly maxDelayMs?: number;
  private readonly jitter: (delayMs: number) => number;
  private readonly shouldRetry: (error: unknown) => boolean;
  private readonly shouldRetryContext: (context: TContext) => boolean;
  private readonly delay: DelayFunc;
  private readonly signal?: AbortSignal;

  constructor(options: RetryOptions<TContext> = {}) {
    this.numberOfRetries = options.numberOfRetries ?? 3;
    this.initialDelayMs = options.initialDelayMs ?? 200;
    this.backoffFactor = options.backoffFactor ?? 2.0;
    this.maxDelayMs = options.maxDelayMs;
    this.jitter = options.jitter ?? ((delayMs) => delayMs);
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

      // The max-delay cap and jitter apply only to the actual sleep - the exponential growth driving
      // `delay` itself is left uncapped/unjittered, so later attempts still compound off the true
      // exponential curve (matching AWS's documented "full jitter" algorithm:
      // sleep = random(0, min(cap, base * factor^attempt))). Unlike C#, the growth needs no overflow
      // clamp — a JS number saturates to Infinity, which compares fine and is always capped before
      // sleeping (by maxDelayMs when set, and by maxSleepMs regardless).
      const cappedDelay = this.maxDelayMs !== undefined && delay > this.maxDelayMs ? this.maxDelayMs : delay;
      const sleep = this.jitter(cappedDelay);
      await this.delay(sleep > maxSleepMs ? maxSleepMs : sleep);
      delay = delay * this.backoffFactor;
    }
  }
}

/** Reads an `AbortSignal` structurally off a context that carries one as a `signal` member. */
function signalOf(context: unknown): AbortSignal | undefined {
  const candidate = (context as { signal?: unknown } | null | undefined)?.signal;
  return candidate instanceof AbortSignal ? candidate : undefined;
}
